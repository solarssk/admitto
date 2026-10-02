// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaginationFooter, paginationHandlers } from "../../src/components/PaginationFooter.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pagerProps = {
  idPrefix: "test",
  pageSize: 25,
  totalRows: 60,
  pageSizeOptions: [25, 50, 100],
  onPageSizeChange: vi.fn(),
} as const;

function pager(props: { page: number; totalPages: number; onPrevious?: () => void; onNext?: () => void }) {
  return <PaginationFooter {...pagerProps} onPrevious={vi.fn()} onNext={vi.fn()} {...props} />;
}

describe("PaginationFooter edge buttons", () => {
  // `disabled` would make a browser drop the focus of the button that was just pressed (Next on the
  // second-to-last page becomes the last-page button on the same commit), so the edge buttons are
  // `aria-disabled` and Button swallows their click. jsdom keeps focus on a disabled button, so what
  // proves the fix here is the missing `disabled` attribute; the focus loss itself was measured in Chrome.
  it("keeps focus on Next when it becomes the last-page button, and does nothing when it is clicked", () => {
    const onNext = vi.fn();
    const { rerender } = render(pager({ page: 2, totalPages: 3, onNext }));
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    next.focus();
    expect(document.activeElement).toBe(next);
    expect(next.hasAttribute("aria-disabled")).toBe(false);

    rerender(pager({ page: 3, totalPages: 3, onNext }));

    expect(screen.getByRole("button", { name: "Next" })).toBe(next);
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("keeps focus on Previous when it becomes the first-page button, and does nothing when it is clicked", () => {
    const onPrevious = vi.fn();
    const { rerender } = render(pager({ page: 2, totalPages: 3, onPrevious }));
    const previous = screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement;
    previous.focus();
    expect(document.activeElement).toBe(previous);
    expect(previous.hasAttribute("aria-disabled")).toBe(false);

    rerender(pager({ page: 1, totalPages: 3, onPrevious }));

    expect(screen.getByRole("button", { name: "Previous" })).toBe(previous);
    expect(document.activeElement).toBe(previous);
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.disabled).toBe(false);
    fireEvent.click(previous);
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it("gives the click back once the button is off the edge again", () => {
    const onNext = vi.fn();
    const { rerender } = render(pager({ page: 3, totalPages: 3, onNext }));
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    next.focus();

    rerender(pager({ page: 2, totalPages: 3, onNext }));

    expect(document.activeElement).toBe(next);
    expect(next.hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("keeps both buttons inert, and not `disabled`, when everything fits on one page", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(pager({ page: 1, totalPages: 1, onPrevious, onNext }));

    for (const name of ["Previous", "Next"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
    }
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("leaves both buttons live on a middle page", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(pager({ page: 2, totalPages: 3, onPrevious, onNext }));

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("aria-disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("aria-disabled")).toBe(false);
  });
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
