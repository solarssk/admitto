import { describe, expect, it, vi } from "vitest";
import { runWalletExpiry } from "../src/expire-passes.js";

type EventRow = {
  id: string;
  date: Date;
  event_hours_start: string | null;
  event_hours_end: string | null;
  timezone: string;
};

function makeDb(events: EventRow[], count = 1) {
  // The sweep lists candidate ids on the client, then per event locks and re-reads the row inside
  // a transaction, so the transaction client is what carries the event lookup and the UPDATE.
  const tx = {
    $queryRaw: vi.fn(async () => []),
    event: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => events.find((e) => e.id === where.id) ?? null) },
    walletPass: { updateMany: vi.fn(async () => ({ count })) },
  };
  return {
    event: { findMany: vi.fn(async () => events.map(({ id }) => ({ id }))) },
    // Never expected to be called: the UPDATE has to run on the transaction client that holds the lock.
    walletPass: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown, _options?: unknown) => fn(tx)),
    tx,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const NOW = new Date("2026-10-01T12:00:00.000Z").getTime();
// Ended: 2026-09-30, 09:00-18:00 UTC, so over at 18:00 UTC the day before NOW.
const ENDED: EventRow = {
  id: "evt-ended",
  date: new Date("2026-09-30T12:00:00.000Z"),
  event_hours_start: "09:00",
  event_hours_end: "18:00",
  timezone: "UTC",
};
// Still going: today, ends 18:00 UTC, NOW is 12:00 UTC.
const ONGOING: EventRow = { ...ENDED, id: "evt-ongoing", date: new Date("2026-10-01T12:00:00.000Z") };

describe("runWalletExpiry", () => {
  it("flips due active/voided passes of an event that is over to expired", async () => {
    const db = makeDb([ENDED], 3);
    const result = await runWalletExpiry(db, NOW);
    expect(result).toEqual({ expired: 3, deferredEvents: 0 });
    // The UPDATE runs on the transaction client that holds the event lock, never on the plain client.
    expect(db.walletPass.updateMany).not.toHaveBeenCalled();
    expect(db.tx.walletPass.updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["active", "voided"] },
        expires_at: { lte: new Date(NOW) },
        attendee: { event_id: "evt-ended" },
      },
      data: { status: "expired" },
    });
  });

  it("looks only at events that have a due pass", async () => {
    const db = makeDb([]);
    await runWalletExpiry(db, NOW);
    expect(db.event.findMany.mock.calls[0][0].where).toEqual({
      attendees: {
        some: {
          wallet_pass: { is: { status: { in: ["active", "voided"] }, expires_at: { lte: new Date(NOW) } } },
        },
      },
    });
  });

  it("does not expire the passes of an event that is still going, even with a due expires_at", async () => {
    // The end time was moved later and the push carrying the new date never reached these passes.
    const db = makeDb([ONGOING]);
    const result = await runWalletExpiry(db, NOW);
    expect(result).toEqual({ expired: 0, deferredEvents: 1 });
    expect(db.tx.walletPass.updateMany).not.toHaveBeenCalled();
  });

  it("expires one event's passes and defers another's in the same run", async () => {
    const db = makeDb([ENDED, ONGOING], 2);
    const result = await runWalletExpiry(db, NOW);
    expect(result).toEqual({ expired: 2, deferredEvents: 1 });
    expect(db.tx.walletPass.updateMany).toHaveBeenCalledTimes(1);
  });

  it("defers an event whose date cannot be read instead of closing its passes", async () => {
    const db = makeDb([{ ...ENDED, date: new Date(Number.NaN) }]);
    await expect(runWalletExpiry(db, NOW)).resolves.toEqual({ expired: 0, deferredEvents: 1 });
    expect(db.tx.walletPass.updateMany).not.toHaveBeenCalled();
  });

  it("locks the event row before it reads the end time or updates the passes", async () => {
    const db = makeDb([ENDED]);
    await runWalletExpiry(db, NOW);
    const lock = db.tx.$queryRaw.mock.invocationCallOrder[0];
    expect(lock).toBeLessThan(db.tx.event.findUnique.mock.invocationCallOrder[0]);
    expect(lock).toBeLessThan(db.tx.walletPass.updateMany.mock.invocationCallOrder[0]);
    expect(db.tx.$queryRaw.mock.calls[0].join("")).toContain("FOR NO KEY UPDATE");
  });

  it("decides on the end time it reads under the lock, not on the one from the first lookup", async () => {
    // The event was over when the sweep listed it, but an admin moved its end later before the
    // sweep took the lock: the row read under the lock is the going event.
    const db = makeDb([ENDED]);
    db.tx.event.findUnique.mockResolvedValueOnce(ONGOING);
    const result = await runWalletExpiry(db, NOW);
    expect(result).toEqual({ expired: 0, deferredEvents: 1 });
    expect(db.tx.walletPass.updateMany).not.toHaveBeenCalled();
  });

  it("gives each event's transaction a longer budget than Prisma's 5 s default", async () => {
    const db = makeDb([ENDED]);
    await runWalletExpiry(db, NOW);
    expect(db.$transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 60_000 });
  });

  it("still tries the events after one whose transaction fails, then reports the failure", async () => {
    const other: EventRow = { ...ENDED, id: "evt-other" };
    const db = makeDb([ENDED, other], 2);
    const failure = new Error("Transaction API error: timeout");
    db.$transaction.mockRejectedValueOnce(failure);

    await expect(runWalletExpiry(db, NOW)).rejects.toBe(failure);

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.tx.walletPass.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ attendee: { event_id: "evt-other" } }) }),
    );
  });

  it("skips an event that was deleted between the lookup and the lock", async () => {
    const db = makeDb([ENDED]);
    db.tx.event.findUnique.mockResolvedValueOnce(null);
    await expect(runWalletExpiry(db, NOW)).resolves.toEqual({ expired: 0, deferredEvents: 0 });
    expect(db.tx.walletPass.updateMany).not.toHaveBeenCalled();
  });

  it("reports zero when nothing is due", async () => {
    const db = makeDb([]);
    await expect(runWalletExpiry(db, NOW)).resolves.toEqual({ expired: 0, deferredEvents: 0 });
  });

  it("defaults to the current time when nowMs is omitted", async () => {
    const db = makeDb([]);
    await runWalletExpiry(db);
    const where = db.event.findMany.mock.calls[0][0].where;
    expect(where.attendees.some.wallet_pass.is.expires_at.lte.getTime()).toBeCloseTo(Date.now(), -2);
  });
});
