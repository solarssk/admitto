import { describe, expect, it } from "vitest";
import { withSessionAdvisoryLock } from "../src/adapter.js";
import pg from "pg";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const url = process.env.DATABASE_URL!;
assertTestDatabaseUrl(url);
function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { waiting, release };
}
describe("session ownership", () => {
  it("excludes a contender without blocking unrelated work and releases on completion", async () => {
    const entered = gate(); const release = gate(); const key = "synthetic-session-owner";
    const first = withSessionAdvisoryLock(url, key, async (owned) => { await owned(); entered.release(); await release.waiting; return true; });
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
  it("refuses an outcome after the exact owning backend terminates", async () => {
    const control = new pg.Client({ connectionString: url });
    await control.connect();
    const key = "synthetic-terminated-owner";
    let writes = 0;
    try {
      await withSessionAdvisoryLock(url, key, async (owned) => {
        const result = await control.query<{ pid: number }>(`
          SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted
            AND classid = ((hashtextextended($1, 0) >> 32) & 4294967295)::oid
            AND objid = (hashtextextended($1, 0) & 4294967295)::oid
            AND objsubid = 1 AND pid <> pg_backend_pid()`, [key]);
        expect(result.rows).toHaveLength(1);
        await control.query("SELECT pg_terminate_backend($1)", [result.rows[0]!.pid]);
        await expect(owned()).rejects.toThrow("Delivery ownership connection lost");
        // A replacement owner can proceed; the failed session still cannot authorize a write.
        expect(await withSessionAdvisoryLock(url, key, async (replacementOwned) => { await replacementOwned(); return true; })).toBe(true);
        try { await owned(); writes++; } catch { /* No stale write. */ }
      });
      expect(writes).toBe(0);
    } finally { await control.end(); }
  });
});
