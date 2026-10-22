import { randomInt } from "node:crypto";
import { Prisma } from "@admitto/db/client";
import { EventLockBusyError } from "./event-capacity.js";

/** Takes a place among the writes allowed at once: a release function, or null when `waitMs` ran out first. */
export type WriteGate = {
  acquire(waitMs: number): Promise<(() => void) | null>;
};

type Waiter = { grant: () => void };

/**
 * A counting semaphore, first come first served. A holder passes its place on when it releases, so the count of
 * holders never goes above `maxConcurrent`; a waiter that runs out of time leaves the line.
 */
class CountingWriteGate implements WriteGate {
  private holders = 0;
  private readonly line: Waiter[] = [];

  constructor(private readonly maxConcurrent: number) {}

  acquire(waitMs: number): Promise<(() => void) | null> {
    if (this.holders < this.maxConcurrent) {
      this.holders += 1;
      return Promise.resolve(this.placeFor());
    }
    if (waitMs <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve(this.placeFor());
        },
      };
      timer = setTimeout(() => {
        // Still in line: a grant takes the waiter out of it and clears this timer.
        this.line.splice(this.line.indexOf(waiter), 1);
        resolve(null);
      }, waitMs);
      this.line.push(waiter);
    });
  }

  /** A place that gives itself back once: to the first in line if there is one (the count stays), otherwise to the pool. */
  private placeFor(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.line.shift();
      if (next) next.grant();
      else this.holders -= 1;
    };
  }
}

export function createWriteGate(maxConcurrent: number): WriteGate {
  return new CountingWriteGate(maxConcurrent);
}

/**
 * What a guest's write may spend before it answers busy (docs/dev/attendee-erasure.md, "A request that must not
 * wait with a pooled connection"). The pool has 10 connections and a panel, a ticket page and a check-in share
 * them, so a burst of submissions behind a long import must not hold more than a few of them: at most
 * `maxConcurrent` writes try at once in this process, the others wait in memory for up to `permitWaitMs`, and a
 * write that finds a lock held pauses (without a connection) and tries again for up to `retryMs`.
 */
export const PUBLIC_WRITE_DEFAULTS = {
  maxConcurrent: 3,
  permitWaitMs: 1_000,
  retryMs: 2_000,
  pauseMs: [40, 120],
} as const;

const processGate = createWriteGate(PUBLIC_WRITE_DEFAULTS.maxConcurrent);

export type PublicWriteOptions = {
  /** The places among the writes allowed at once. The default is shared by every guest write of this process. */
  gate?: WriteGate;
  permitWaitMs?: number;
  retryMs?: number;
  /** The pause between two tries is drawn from this range (inclusive), so that waiting writes do not all return at once. */
  pauseMs?: readonly [min: number, max: number];
};

/** The outcome of a guest's write: what it returned, or that it gave up and wrote nothing. */
export type PublicWriteResult<T> = { busy: false; value: T } | { busy: true };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Prisma could not start the transaction in time (every connection busy): the same answer as a held lock. */
function isTransactionStartTimeout(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028";
}

function withDefaults(options: PublicWriteOptions) {
  return {
    gate: options.gate ?? processGate,
    permitWaitMs: options.permitWaitMs ?? PUBLIC_WRITE_DEFAULTS.permitWaitMs,
    retryMs: options.retryMs ?? PUBLIC_WRITE_DEFAULTS.retryMs,
    pauseMs: options.pauseMs ?? PUBLIC_WRITE_DEFAULTS.pauseMs,
  };
}

/**
 * Runs one guest's write without letting it hold a pooled connection while it waits. `attempt` opens one
 * transaction that takes its locks without waiting and throws EventLockBusyError when one is held (nothing is
 * written then). A place in the process-wide gate is held only while an attempt runs, never during the pause
 * between two. Once `retryMs` is spent, or no place came free within `permitWaitMs`, it answers busy and the
 * caller answers `503 try_again`; nothing has been written, and the link of a confirmation stays valid.
 *
 * A transaction that Prisma could not start in time counts as busy too. Any other error is the caller's.
 */
export async function runPublicWrite<T>(
  attempt: () => Promise<T>,
  options: PublicWriteOptions = {},
): Promise<PublicWriteResult<T>> {
  const { gate, permitWaitMs, retryMs, pauseMs } = withDefaults(options);
  const deadline = performance.now() + retryMs;
  for (;;) {
    const release = await gate.acquire(Math.min(permitWaitMs, deadline - performance.now())); // NOSONAR - the next try starts only after the pause
    if (release === null) return { busy: true };
    try {
      return { busy: false, value: await attempt() };
    } catch (error) {
      if (isTransactionStartTimeout(error)) return { busy: true };
      if (!(error instanceof EventLockBusyError)) throw error;
    } finally {
      release();
    }
    const left = deadline - performance.now();
    if (left <= 0) return { busy: true };
    await sleep(Math.min(left, randomInt(pauseMs[0], pauseMs[1] + 1))); // NOSONAR - the pause between two tries: the lock is still held
  }
}
