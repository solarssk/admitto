import { describe, expect, it, vi } from "vitest";
import { runWalletExpiry } from "../src/expire-passes.js";

function makeDb(count: number) {
  return {
    walletPass: {
      updateMany: vi.fn(async () => ({ count })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const NOW = new Date("2026-10-01T12:00:00.000Z").getTime();

describe("runWalletExpiry", () => {
  it("flips active/voided passes whose canonical expires_at has passed to expired", async () => {
    const db = makeDb(3);
    const result = await runWalletExpiry(db, NOW);
    expect(result).toEqual({ expired: 3 });
    expect(db.walletPass.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ["active", "voided"] }, expires_at: { lte: new Date(NOW) } },
      data: { status: "expired" },
    });
  });

  it("reports zero when nothing is due", async () => {
    const db = makeDb(0);
    await expect(runWalletExpiry(db, NOW)).resolves.toEqual({ expired: 0 });
  });

  it("defaults to the current time when nowMs is omitted", async () => {
    const db = makeDb(0);
    await runWalletExpiry(db);
    const where = db.walletPass.updateMany.mock.calls[0][0].where;
    expect(where.expires_at.lte.getTime()).toBeCloseTo(Date.now(), -2);
  });
});
