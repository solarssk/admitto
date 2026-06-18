import { describe, expect, it, vi } from "vitest";
import {
  isStaleWrite,
  runOptimisticUpdate,
} from "../src/admin/optimistic-update.js";

describe("isStaleWrite", () => {
  it("detects stale_write results", () => {
    expect(isStaleWrite({ kind: "stale_write" })).toBe(true);
    expect(isStaleWrite({ ok: true, row: { id: "a1" } })).toBe(false);
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
    expect(isStaleWrite(result)).toBe(true);
    expect(loadUpdated).not.toHaveBeenCalled();
  });

  it("throws when count is greater than one", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const loadUpdated = vi.fn();

    await expect(runOptimisticUpdate({ updateMany, loadUpdated })).rejects.toThrow(
      /expected exactly one/,
    );
    expect(loadUpdated).not.toHaveBeenCalled();
  });
});
