// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScrollFadeTabs } from "../../src/components/ScrollFadeTabs.js";

afterEach(() => {
  cleanup();
});

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
});
