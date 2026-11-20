import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { Prisma } from "@admitto/db/client";
import { EventLockBusyError } from "../src/event-capacity.js";
import { PUBLIC_WRITE_DEFAULTS, createWriteGate, runPublicWrite } from "../src/public-write-gate.js";

describe("createWriteGate", () => {
  it("gives out as many places as it was made for, and hands a released place to the first in line", async () => {
    const gate = createWriteGate(2);
    const first = await gate.acquire(0);
    const second = await gate.acquire(0);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await gate.acquire(0)).toBeNull();

    const order: string[] = [];
    const third = gate.acquire(1_000).then((release) => {
      order.push("third");
      return release;
    });
    const fourth = gate.acquire(1_000).then((release) => {
      order.push("fourth");
      return release;
    });
    first?.();
    const thirdPlace = await third;
    expect(order).toEqual(["third"]);
    second?.();
    const fourthPlace = await fourth;
    expect(order).toEqual(["third", "fourth"]);
    thirdPlace?.();
    fourthPlace?.();
    // Every place is back: two can be taken again, a third cannot.
    const again = [await gate.acquire(0), await gate.acquire(0)];
    expect(again.every((place) => place !== null)).toBe(true);
    expect(await gate.acquire(0)).toBeNull();
  });

  it("lets a waiter that ran out of time leave the line, so the place goes to the next one", async () => {
    const gate = createWriteGate(1);
    const holder = await gate.acquire(0);
    const impatient = gate.acquire(20);
    const patient = gate.acquire(1_000);
    expect(await impatient).toBeNull();
    holder?.();
    const place = await patient;
    expect(place).not.toBeNull();
    place?.();
    expect(await gate.acquire(0)).not.toBeNull();
  });

  it("gives a place back only once, however often it is released", async () => {
    const gate = createWriteGate(1);
    const place = await gate.acquire(0);
    place?.();
    place?.();
    const first = await gate.acquire(0);
    expect(first).not.toBeNull();
    expect(await gate.acquire(0)).toBeNull();
    first?.();
  });

  it("never lets more than its limit run at once", async () => {
    const gate = createWriteGate(3);
    let running = 0;
    let highest = 0;
    await Promise.all(
      Array.from({ length: 30 }, async () => {
        const place = await gate.acquire(5_000);
        running += 1;
        highest = Math.max(highest, running);
        await delay(2);
        running -= 1;
        place?.();
      }),
    );
    expect(highest).toBe(3);
  });
});

describe("runPublicWrite", () => {
  const quick = { retryMs: 150, pauseMs: [10, 20] } as const;

  it("returns what the attempt returned, and gives its place back", async () => {
    const gate = createWriteGate(1);
    expect(await runPublicWrite(() => Promise.resolve("written"), { gate })).toEqual({ busy: false, value: "written" });
    expect(await gate.acquire(0)).not.toBeNull();
  });

  it("tries again while a lock is held, and holds no place during the pause between two tries", async () => {
    const gate = createWriteGate(1);
    let attempts = 0;
    const running = runPublicWrite(
      () => {
        attempts += 1;
        return attempts < 3 ? Promise.reject(new EventLockBusyError()) : Promise.resolve("written");
      },
      { gate, retryMs: 2_000, pauseMs: [60, 60] },
    );
    // The first try has failed by now and the write is pausing: its place is free for somebody else.
    await delay(20);
    const place = await gate.acquire(0);
    expect(place).not.toBeNull();
    place?.();
    expect(await running).toEqual({ busy: false, value: "written" });
    expect(attempts).toBe(3);
  });

  it("answers busy, having written nothing, once the lock has been held for as long as it may be waited for", async () => {
    let attempts = 0;
    const result = await runPublicWrite(() => {
      attempts += 1;
      return Promise.reject(new EventLockBusyError());
    }, { gate: createWriteGate(1), ...quick });
    expect(result).toEqual({ busy: true });
    expect(attempts).toBeGreaterThan(1);
  });

  it("answers busy when no place comes free in time, without trying", async () => {
    const gate = createWriteGate(1);
    const holder = await gate.acquire(0);
    let attempts = 0;
    const result = await runPublicWrite(
      () => {
        attempts += 1;
        return Promise.resolve("written");
      },
      { gate, permitWaitMs: 30, retryMs: 500 },
    );
    expect(result).toEqual({ busy: true });
    expect(attempts).toBe(0);
    holder?.();
  });

  it("answers busy, without a second try, when Prisma could not start the transaction in time", async () => {
    let attempts = 0;
    const result = await runPublicWrite(
      () => {
        attempts += 1;
        return Promise.reject(new Prisma.PrismaClientKnownRequestError("no connection", { code: "P2028", clientVersion: "7" }));
      },
      { gate: createWriteGate(1), ...quick },
    );
    expect(result).toEqual({ busy: true });
    expect(attempts).toBe(1);
  });

  it("passes any other error on, and gives its place back", async () => {
    const gate = createWriteGate(1);
    await expect(runPublicWrite(() => Promise.reject(new Error("synthetic failure")), { gate, ...quick })).rejects.toThrow(
      "synthetic failure",
    );
    expect(await gate.acquire(0)).not.toBeNull();
  });

  it("is made for a few writes at once, a second or so of waiting for a place, and about two seconds of trying", () => {
    expect(PUBLIC_WRITE_DEFAULTS).toEqual({ maxConcurrent: 3, permitWaitMs: 1_000, retryMs: 2_000, pauseMs: [40, 120] });
  });
});
