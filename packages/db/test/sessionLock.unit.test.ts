import { afterEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn(), on: vi.fn() }));
vi.mock("pg", () => ({ default: { Client: class {
  query = fake.query; connect = fake.connect; end = fake.end; on = fake.on;
} } }));
import { withSessionAdvisoryLock } from "../src/adapter.js";
afterEach(() => { vi.resetAllMocks(); });
describe("session ownership verification", () => {
  it("rejects missing lock ownership even without an error event", async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ owned: true, pid: 42 }] })
      .mockResolvedValueOnce({ rows: [{ owned: true }] })
      .mockResolvedValueOnce({ rows: [{ owned: false }] });
    let writes = 0;
    await expect(withSessionAdvisoryLock("synthetic", "key", async (owned) => {
      await owned(); writes++; return true;
    })).rejects.toThrow("Delivery ownership connection lost");
    expect(writes).toBe(0);
    expect(fake.query.mock.calls[2]?.[1]).toEqual(["key", 42]);
    expect(fake.end).toHaveBeenCalledOnce();
  });
  it("does not enter the operation if the initial ownership check fails", async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ owned: true, pid: 42 }] })
      .mockRejectedValueOnce(new Error("Synthetic connection failure"));
    const run = vi.fn();
    await expect(withSessionAdvisoryLock("synthetic", "key", run)).rejects.toThrow("Delivery ownership connection lost");
    expect(run).not.toHaveBeenCalled();
    expect(fake.end).toHaveBeenCalledOnce();
  });
});
