import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLoaderClockForTests, syncLoaderClockToSplash } from "../src/loader-clock.js";
import { PageLoader, SectionLoader } from "../src/components/Loader.js";

describe("PageLoader", () => {
  it("is a status region named after what is loading", () => {
    render(<PageLoader label="Loading event" />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("Loading event");
    expect(el.className).toContain("at-loader--page");
  });

  it("draws the whole mark as decorative SVG (the label carries the meaning)", () => {
    const { container } = render(<PageLoader label="Loading event" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    // Tile, tick and dot are all present from the first render: the loader never shows a partial icon.
    expect(svg?.querySelector(".at-loader__tile")).not.toBeNull();
    expect(svg?.querySelector(".at-loader__check")).not.toBeNull();
    expect(svg?.querySelector(".at-loader__dot")).not.toBeNull();
    expect(svg?.querySelector(".at-loader__check")?.getAttribute("pathLength")).toBe("1");
  });

  it("says what is loading in a visible line under the mark, hidden from assistive tech (the name is on the region)", () => {
    render(<PageLoader label="Loading event" />);
    const line = screen.getByText("Loading event…");
    expect(line.classList.contains("at-loader__label")).toBe(true);
    expect(line.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the mark and its text in one stack, so the mark is what is centred and the text hangs below it", () => {
    const { container } = render(<PageLoader label="Loading event" />);
    const stack = container.querySelector(".at-loader__stack");
    expect(stack?.firstElementChild?.classList.contains("at-loader__mark")).toBe(true);
    expect(stack?.querySelector(".at-loader__text .at-loader__label")).not.toBeNull();
  });

  it("shows a caption only when one is given, and then under the label", () => {
    const { rerender, container } = render(<PageLoader label="Loading event" />);
    // No caption element at all, not an empty one: it would add a gap in the text block.
    expect(container.querySelector(".at-loader__caption")).toBeNull();

    rerender(<PageLoader label="Loading event" caption="Taking longer than usual." />);
    const caption = screen.getByText("Taking longer than usual.");
    expect(caption.classList.contains("at-loader__caption")).toBe(true);
    const text = container.querySelector(".at-loader__text");
    const order = [...(text?.children ?? [])].map((el) => (el.classList.contains("at-loader__label") ? "label" : "caption"));
    expect(order).toEqual(["label", "caption"]);
  });
});

describe("SectionLoader", () => {
  it("shows a ring and the line saying what is loading, not the logo (the logo is for whole screens)", () => {
    const { container } = render(<SectionLoader label="Loading sessions" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".at-loader__mark")).toBeNull();
    const ring = container.querySelector(".at-loader__ring");
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".at-loader__stack")?.firstElementChild).toBe(ring);
    expect(screen.getByText("Loading sessions…").classList.contains("at-loader__label")).toBe(true);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Loading sessions");
  });

  it("shows the slow caption under the label", () => {
    const { container } = render(<SectionLoader label="Loading sessions" caption="Taking longer than usual." />);
    const text = container.querySelector(".at-loader__text");
    expect(text?.lastElementChild?.textContent).toBe("Taking longer than usual.");
    expect(text?.firstElementChild?.classList.contains("at-loader__label")).toBe(true);
  });

  it("reserves 12rem by default so the surrounding card does not resize", () => {
    render(<SectionLoader label="Loading sessions" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("at-loader--section");
    expect(el.style.minHeight).toBe("12rem");
  });

  it("reserves the height it is given", () => {
    render(<SectionLoader label="Loading sessions" minHeight={250} />);
    expect(screen.getByRole("status").style.minHeight).toBe("250px");
  });

  it("lets a caller style override the reserved height", () => {
    render(<SectionLoader label="Loading sessions" minHeight={250} style={{ minHeight: 100 }} />);
    expect(screen.getByRole("status").style.minHeight).toBe("100px");
  });
});

describe("loader phase (shared clock)", () => {
  afterEach(() => {
    resetLoaderClockForTests();
    vi.restoreAllMocks();
  });

  it("starts each loader mid-cycle, where the shared clock is, so swapping loaders does not restart the tick", () => {
    let now = 5_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const root = document.createElement("div");
    root.innerHTML = '<div class="at-splash"><svg></svg></div>';
    Object.assign(root.querySelector("svg")!, { getAnimations: () => [{ currentTime: 700 }] });
    syncLoaderClockToSplash(root);

    now += 600; // the splash has been drawing for 1300ms when this loader mounts
    render(<PageLoader label="Loading event" />);
    expect(screen.getByRole("status").style.getPropertyValue("--at-loader-phase")).toBe("-1300ms");
  });

  it("wraps around the 2s cycle instead of growing without bound", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    now = 4_750;
    render(<SectionLoader label="Loading sessions" />);
    expect(screen.getByRole("status").style.getPropertyValue("--at-loader-phase")).toBe("-750ms");
  });
});
