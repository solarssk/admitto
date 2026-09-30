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
  return {
    event: { findMany: vi.fn(async () => events) },
    walletPass: { updateMany: vi.fn(async () => ({ count })) },
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
    expect(db.walletPass.updateMany).toHaveBeenCalledWith({
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
    expect(db.walletPass.updateMany).not.toHaveBeenCalled();
  });

  it("expires one event's passes and defers another's in the same run", async () => {
    const db = makeDb([ENDED, ONGOING], 2);
    const result = await runWalletExpiry(db, NOW);
    expect(result).toEqual({ expired: 2, deferredEvents: 1 });
    expect(db.walletPass.updateMany).toHaveBeenCalledTimes(1);
  });

  it("defers an event whose date cannot be read instead of closing its passes", async () => {
    const db = makeDb([{ ...ENDED, date: new Date(Number.NaN) }]);
    await expect(runWalletExpiry(db, NOW)).resolves.toEqual({ expired: 0, deferredEvents: 1 });
    expect(db.walletPass.updateMany).not.toHaveBeenCalled();
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
