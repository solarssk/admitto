// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollFadeTabs } from "../../src/components/ScrollFadeTabs.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom does not implement scrollIntoView/scrollBy.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollBy = vi.fn();

const TABS = [
  { id: "general", label: "General" },
  { id: "branding", label: "Branding" },
  { id: "danger", label: "Danger zone" },
];

/** jsdom always reports 0 for these layout metrics; simulate real overflow. */
function mockScrollMetrics(
  el: HTMLElement,
  { scrollWidth, clientWidth, scrollLeft }: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
  el.scrollLeft = scrollLeft;
}

function getWrapper(container: HTMLElement) {
  return container.querySelector(".scroll-fade-tabs") as HTMLDivElement;
}

function getScrollEl(container: HTMLElement) {
  return container.querySelector(".scroll-fade-tabs__scroll") as HTMLDivElement;
}

describe("ScrollFadeTabs", () => {
  it("renders the wrapped Tabs unchanged (same tab buttons)", () => {
    render(<ScrollFadeTabs value="general" tabs={TABS} />);
    expect(screen.getByRole("tab", { name: "General" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Branding" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Danger zone" })).toBeTruthy();
  });

  it("applies both at-start and at-end modifier classes by default (no overflow measured)", () => {
    const { container } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
    const wrapper = getWrapper(container);
    expect(wrapper.className).toContain("scroll-fade-tabs--at-start");
    expect(wrapper.className).toContain("scroll-fade-tabs--at-end");
  });

  it("shows both fades (no modifier classes) when scrolled to the middle of overflowing content", () => {
    const { container } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
    const scrollEl = getScrollEl(container);
    mockScrollMetrics(scrollEl, { scrollWidth: 500, clientWidth: 100, scrollLeft: 200 });
    fireEvent.scroll(scrollEl);

    const wrapper = getWrapper(container);
    expect(wrapper.className).not.toContain("scroll-fade-tabs--at-start");
    expect(wrapper.className).not.toContain("scroll-fade-tabs--at-end");
  });

  it("hides only the left fade when scrolled fully to the start", () => {
    const { container } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
    const scrollEl = getScrollEl(container);
    mockScrollMetrics(scrollEl, { scrollWidth: 500, clientWidth: 100, scrollLeft: 0 });
    fireEvent.scroll(scrollEl);

    const wrapper = getWrapper(container);
    expect(wrapper.className).toContain("scroll-fade-tabs--at-start");
    expect(wrapper.className).not.toContain("scroll-fade-tabs--at-end");
  });

  it("hides only the right fade when scrolled fully to the end", () => {
    const { container } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
    const scrollEl = getScrollEl(container);
    mockScrollMetrics(scrollEl, { scrollWidth: 500, clientWidth: 100, scrollLeft: 400 });
    fireEvent.scroll(scrollEl);

    const wrapper = getWrapper(container);
    expect(wrapper.className).not.toContain("scroll-fade-tabs--at-start");
    expect(wrapper.className).toContain("scroll-fade-tabs--at-end");
  });

  it("re-measures when the tab count changes", () => {
    const { container, rerender } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
    const scrollEl = getScrollEl(container);
    mockScrollMetrics(scrollEl, { scrollWidth: 500, clientWidth: 100, scrollLeft: 200 });
    fireEvent.scroll(scrollEl);
    expect(getWrapper(container).className).not.toContain("scroll-fade-tabs--at-end");

    // Fewer tabs now fit without overflowing at all — re-render with a shorter
    // tab list and matching (non-overflowing) metrics, without firing a new
    // scroll event, to prove the effect re-ran off the tabCount change alone.
    mockScrollMetrics(scrollEl, { scrollWidth: 100, clientWidth: 100, scrollLeft: 0 });
    rerender(<ScrollFadeTabs value="general" tabs={[TABS[0]!]} />);

    const wrapper = getWrapper(container);
    expect(wrapper.className).toContain("scroll-fade-tabs--at-start");
    expect(wrapper.className).toContain("scroll-fade-tabs--at-end");
  });

  it("only renders an arrow on the side there's actually more to scroll to", () => {
    const { container } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
    const scrollEl = getScrollEl(container);
    mockScrollMetrics(scrollEl, { scrollWidth: 500, clientWidth: 100, scrollLeft: 200 });
    fireEvent.scroll(scrollEl);

    expect(screen.getByRole("button", { name: "Scroll tabs left" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scroll tabs right" })).toBeTruthy();
  });

  it("hides the left arrow at the start and the right arrow at the end", () => {
    const { container } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
    const scrollEl = getScrollEl(container);
    mockScrollMetrics(scrollEl, { scrollWidth: 500, clientWidth: 100, scrollLeft: 0 });
    fireEvent.scroll(scrollEl);
    expect(screen.queryByRole("button", { name: "Scroll tabs left" })).toBeNull();
    expect(screen.getByRole("button", { name: "Scroll tabs right" })).toBeTruthy();

    mockScrollMetrics(scrollEl, { scrollWidth: 500, clientWidth: 100, scrollLeft: 400 });
    fireEvent.scroll(scrollEl);
    expect(screen.getByRole("button", { name: "Scroll tabs left" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Scroll tabs right" })).toBeNull();
  });

  it("scrolls the strip when an arrow is clicked", () => {
    const { container } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
    const scrollEl = getScrollEl(container);
    mockScrollMetrics(scrollEl, { scrollWidth: 500, clientWidth: 100, scrollLeft: 200 });
    fireEvent.scroll(scrollEl);

    fireEvent.click(screen.getByRole("button", { name: "Scroll tabs right" }));
    expect(scrollEl.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.any(Number) }),
    );
    const rightCall = vi.mocked(scrollEl.scrollBy).mock.calls[0]![0] as { left: number };
    expect(rightCall.left).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Scroll tabs left" }));
    const leftCall = vi.mocked(scrollEl.scrollBy).mock.calls[1]![0] as { left: number };
    expect(leftCall.left).toBeLessThan(0);
  });

  it("scrolls the active tab into view when the active tab changes", () => {
    const { rerender } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    rerender(<ScrollFadeTabs value="danger" tabs={TABS} />);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "nearest", inline: "nearest" }),
    );
  });

  it("nudges past the right arrow's own overlay when scrollIntoView alone leaves the active tab just barely on-screen", () => {
    // Simulates exactly the bug report: landing straight on the last ("danger") tab (e.g. via a
    // deep-linked URL), its right edge (110) already technically inside the container's (right
    // edge 100) per scrollIntoView's own "nearest" - but only by 10px into the 28px zone the
    // right arrow's solid background sits on top of. Mocked by element identity (not render
    // order) since the "which element is the target" question only resolves once "danger"
    // actually has aria-selected="true", i.e. mid-effect, too late to spy on afterwards.
    const realRect = Element.prototype.getBoundingClientRect;
    const rect = (partial: Partial<DOMRect>): DOMRect =>
      ({ top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => "", ...partial }) as DOMRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains("scroll-fade-tabs__scroll")) return rect({ left: 0, right: 100, width: 100 });
      if (this.getAttribute("aria-selected") === "true") return rect({ left: 80, right: 110, width: 30 });
      return realRect.call(this);
    };

    try {
      const { container, rerender } = render(<ScrollFadeTabs value="general" tabs={TABS} />);
      const scrollEl = getScrollEl(container);
      mockScrollMetrics(scrollEl, { scrollWidth: 500, clientWidth: 100, scrollLeft: 72 });
      vi.mocked(scrollEl.scrollBy).mockClear();

      rerender(<ScrollFadeTabs value="danger" tabs={TABS} />);

      expect(scrollEl.scrollBy).toHaveBeenCalledWith({ left: 38 });
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
    }
  });
});
