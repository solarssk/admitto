import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLoaderClockForTests, syncLoaderClockToSplash } from "../src/loader-clock.js";
import { PageLoader, SectionLoader } from "../src/components/Loader.js";

describe("PageLoader", () => {
  it("is a status region with the default accessible name", () => {
    render(<PageLoader />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("Loading");
    expect(el.className).toContain("at-loader--page");
  });

  it("draws the whole mark as decorative SVG (the label carries the meaning)", () => {
    const { container } = render(<PageLoader />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    // Tile, tick and dot are all present from the first render: the loader never shows a partial icon.
    expect(svg?.querySelector(".at-loader__tile")).not.toBeNull();
    expect(svg?.querySelector(".at-loader__check")).not.toBeNull();
    expect(svg?.querySelector(".at-loader__dot")).not.toBeNull();
    expect(svg?.querySelector(".at-loader__check")?.getAttribute("pathLength")).toBe("1");
  });

  it("shows a visible caption only when one is given", () => {
    const { rerender } = render(<PageLoader />);
    expect(screen.queryByText("Taking longer than usual.")).toBeNull();
    rerender(<PageLoader caption="Taking longer than usual." />);
    expect(screen.getByText("Taking longer than usual.").className).toContain("at-loader__caption");
  });

  it("accepts a custom accessible name", () => {
    render(<PageLoader label="Loading event" />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Loading event");
  });
});

describe("SectionLoader", () => {
  it("reserves 12rem by default so the surrounding card does not resize", () => {
    render(<SectionLoader />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("at-loader--section");
    expect(el.style.minHeight).toBe("12rem");
  });

  it("reserves the height it is given", () => {
    render(<SectionLoader minHeight={250} />);
    expect(screen.getByRole("status").style.minHeight).toBe("250px");
  });

  it("lets a caller style override the reserved height", () => {
    render(<SectionLoader minHeight={250} style={{ minHeight: 100 }} />);
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
    render(<PageLoader />);
    expect(screen.getByRole("status").style.getPropertyValue("--at-loader-phase")).toBe("-1300ms");
  });

  it("wraps around the 2s cycle instead of growing without bound", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    now = 4_750;
    render(<SectionLoader />);
    expect(screen.getByRole("status").style.getPropertyValue("--at-loader-phase")).toBe("-750ms");
  });
});
