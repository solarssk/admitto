import { describe, expect, it } from "vitest";
import { withSessionAdvisoryLock } from "../src/adapter.js";

const url = process.env.DATABASE_URL!;
function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { waiting, release };
}
describe("session ownership", () => {
  it("excludes a contender without blocking unrelated work and releases on completion", async () => {
    const entered = gate(); const release = gate(); const key = "synthetic-session-owner";
    const first = withSessionAdvisoryLock(url, key, async (owned) => { owned(); entered.release(); await release.waiting; return true; });
    await entered.waiting;
    try {
      expect(await withSessionAdvisoryLock(url, key, async () => "duplicate")).toBeUndefined();
      expect(await withSessionAdvisoryLock(url, "synthetic-independent-owner", async () => true)).toBe(true);
    } finally { release.release(); await first; }
    expect(await withSessionAdvisoryLock(url, key, async () => true)).toBe(true);
  });
  it("releases ownership when the protected operation fails", async () => {
    const key = "synthetic-throwing-owner";
    await expect(withSessionAdvisoryLock(url, key, async () => { throw new Error("Synthetic failure"); })).rejects.toThrow("Synthetic failure");
    expect(await withSessionAdvisoryLock(url, key, async () => true)).toBe(true);
  });
});
