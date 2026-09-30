import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageLoader, SectionLoader } from "../src/components/Loader.js";

describe("PageLoader", () => {
  it("is a status region with the default accessible name", () => {
    render(<PageLoader />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("Loading");
    expect(el.className).toContain("at-loader--page");
  });

  it("draws the mark as decorative SVG (the label carries the meaning)", () => {
    const { container } = render(<PageLoader />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
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
