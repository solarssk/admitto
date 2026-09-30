import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopProgressBar } from "../src/components/TopProgressBar.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TopProgressBar", () => {
  it("renders nothing while idle", () => {
    render(<TopProgressBar active={false} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is announced as a status, not as a progressbar (there is no value to report)", () => {
    render(<TopProgressBar active />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();
  });

  it("runs while active", () => {
    render(<TopProgressBar active />);
    const bar = screen.getByRole("status", { name: "Loading page" });
    expect(bar.getAttribute("data-phase")).toBe("running");
  });

  it("finishes and then disappears after active turns false", () => {
    const { rerender } = render(<TopProgressBar active />);
    rerender(<TopProgressBar active={false} />);
    expect(screen.getByRole("status").getAttribute("data-phase")).toBe("finishing");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("goes back to running if a new wait starts while finishing", () => {
    const { rerender } = render(<TopProgressBar active />);
    rerender(<TopProgressBar active={false} />);
    rerender(<TopProgressBar active />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("status").getAttribute("data-phase")).toBe("running");
  });
});
