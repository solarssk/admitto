// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { paginationHandlers } from "../../src/components/PaginationFooter.js";

describe("paginationHandlers", () => {
  it("resets to page 1 when the page size changes", () => {
    const setPage = vi.fn();
    const setPageSize = vi.fn();
    const { onPageSizeChange } = paginationHandlers(setPage, setPageSize, 5);

    onPageSizeChange(50);

    expect(setPageSize).toHaveBeenCalledWith(50);
    expect(setPage).toHaveBeenCalledWith(1);
  });

  it("clamps Previous at page 1", () => {
    const setPage = vi.fn();
    const { onPrevious } = paginationHandlers(setPage, vi.fn(), 5);

    onPrevious();
    const updater = setPage.mock.calls[0]![0] as (p: number) => number;

    expect(updater(1)).toBe(1);
    expect(updater(3)).toBe(2);
  });

  it("clamps Next at totalPages", () => {
    const setPage = vi.fn();
    const { onNext } = paginationHandlers(setPage, vi.fn(), 5);

    onNext();
    const updater = setPage.mock.calls[0]![0] as (p: number) => number;

    expect(updater(5)).toBe(5);
    expect(updater(3)).toBe(4);
  });
});
