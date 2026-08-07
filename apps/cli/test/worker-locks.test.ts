import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const connect = vi.fn();
const end = vi.fn();

vi.mock("pg", () => ({
  default: {
    Client: class {
      query = query;
      connect = connect;
      end = end;
    },
  },
}));

const { openWorkerLockClient, WORKER_LOCK_KEYS } = await import("../src/commands/worker-locks.js");

describe("WORKER_LOCK_KEYS", () => {
  it("exposes stable per-job lock names", () => {
    expect(WORKER_LOCK_KEYS.bounce).toBe("admitto:worker:bounce");
    expect(WORKER_LOCK_KEYS.retention).toBe("admitto:worker:retention");
    expect(WORKER_LOCK_KEYS.mail_delivery).toBe("admitto:worker:mail_delivery");
    expect(WORKER_LOCK_KEYS.import).toBe("admitto:worker:import");
    expect(WORKER_LOCK_KEYS.export).toBe("admitto:worker:export");
  });
});

describe("openWorkerLockClient", () => {
  beforeEach(() => {
    query.mockReset();
    connect.mockReset();
    end.mockReset();
    connect.mockResolvedValue(undefined);
    end.mockResolvedValue(undefined);
  });

  it("acquires, skips duplicate release, and unlocks on close", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ lock_id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ ok: true }] })
      .mockResolvedValueOnce({ rows: [{ lock_id: 42 }] })
      .mockResolvedValueOnce({ rows: [] });

    const locks = await openWorkerLockClient("postgresql://example/db");
    expect(connect).toHaveBeenCalledOnce();

    await expect(locks.tryAcquire("bounce")).resolves.toBe(true);
    await locks.release("mail_delivery");
    await locks.release("bounce");
    await locks.close();

    expect(query.mock.calls.map((c) => c[0])).toEqual([
      "SELECT hashtext($1)::int AS lock_id",
      "SELECT pg_try_advisory_lock($1) AS ok",
      "SELECT hashtext($1)::int AS lock_id",
      "SELECT pg_advisory_unlock($1)",
    ]);
    expect(end).toHaveBeenCalledOnce();
  });

  it("returns false when the advisory lock is held elsewhere", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ lock_id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ ok: false }] });

    const locks = await openWorkerLockClient("postgresql://example/db");
    await expect(locks.tryAcquire("retention")).resolves.toBe(false);
    await locks.releaseAll();
    await locks.close();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("releaseAll unlocks every held job", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ lock_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ ok: true }] })
      .mockResolvedValueOnce({ rows: [{ lock_id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ ok: true }] })
      .mockResolvedValueOnce({ rows: [{ lock_id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ lock_id: 2 }] })
      .mockResolvedValueOnce({ rows: [] });

    const locks = await openWorkerLockClient("postgresql://example/db");
    await expect(locks.tryAcquire("bounce")).resolves.toBe(true);
    await expect(locks.tryAcquire("export")).resolves.toBe(true);
    await locks.releaseAll();
    await locks.close();

    const unlocks = query.mock.calls.filter((c) => c[0] === "SELECT pg_advisory_unlock($1)");
    expect(unlocks).toHaveLength(2);
  });

  it("throws when hashtext returns no row", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const locks = await openWorkerLockClient("postgresql://example/db");
    await expect(locks.tryAcquire("import")).rejects.toThrow(/hashtext failed/);
    await locks.close();
  });
});
