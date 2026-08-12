// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaginationFooter, paginationHandlers } from "../../src/components/PaginationFooter.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it("keeps the rows-per-page menu as narrow as its short numeric options", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const base = { top: 100, bottom: 130, height: 30, x: 0, y: 0, toJSON() {} };
      if (this.tagName === "BUTTON") return { ...base, left: 100, right: 167, width: 67 };
      return { ...base, left: 0, right: 0, width: 0 };
    });

    render(
      <PaginationFooter
        idPrefix="test"
        page={1}
        pageSize={25}
        totalPages={1}
        totalRows={7}
        pageSizeOptions={[25, 50, 100, 200]}
        onPageSizeChange={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rows per page, 25" }));

    expect(document.querySelector<HTMLElement>(".searchable-select__panel")?.style.width).toBe("72px");
  });
});
