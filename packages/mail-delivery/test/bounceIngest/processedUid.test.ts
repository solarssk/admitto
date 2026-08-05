import { describe, expect, it, vi } from "vitest";
import { pruneProcessedUidsOlderThan } from "../../src/bounceIngest/processedUid.js";

describe("pruneProcessedUidsOlderThan", () => {
  it("deletes markers older than the provided lookback boundary", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const db = { bounceIngestProcessedUid: { deleteMany } } as never;
    const since = new Date("2026-07-20T00:00:00.000Z");

    await expect(pruneProcessedUidsOlderThan(db, since)).resolves.toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { processed_at: { lt: since } },
    });
  });
});
