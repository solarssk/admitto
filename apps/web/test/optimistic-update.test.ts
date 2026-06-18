import { describe, expect, it, vi } from "vitest";
import {
  runOptimisticUpdate,
  staleWriteFromCount,
} from "../src/admin/optimistic-update.js";

describe("staleWriteFromCount", () => {
  it("returns stale_write when count is 0", () => {
    expect(staleWriteFromCount(0)).toEqual({ kind: "stale_write" });
  });

  it("returns null when count is exactly one", () => {
    expect(staleWriteFromCount(1)).toBeNull();
  });

  it("throws when count is greater than one", () => {
    expect(() => staleWriteFromCount(2)).toThrow(/expected exactly one/);
  });
});

describe("runOptimisticUpdate", () => {
  it("loads row when updateMany succeeds", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const loadUpdated = vi.fn().mockResolvedValue({ id: "a1", name: "Ada" });

    const result = await runOptimisticUpdate({ updateMany, loadUpdated });

    expect(result).toEqual({ ok: true, row: { id: "a1", name: "Ada" } });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(loadUpdated).toHaveBeenCalledOnce();
  });

  it("returns stale_write without loading when count is 0", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const loadUpdated = vi.fn();

    const result = await runOptimisticUpdate({ updateMany, loadUpdated });

    expect(result).toEqual({ kind: "stale_write" });
    expect(loadUpdated).not.toHaveBeenCalled();
  });
});
