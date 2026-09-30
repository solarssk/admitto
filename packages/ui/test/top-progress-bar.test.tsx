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
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("runs while active", () => {
    render(<TopProgressBar active />);
    const bar = screen.getByRole("progressbar", { name: "Loading page" });
    expect(bar.getAttribute("data-phase")).toBe("running");
  });

  it("finishes and then disappears after active turns false", () => {
    const { rerender } = render(<TopProgressBar active />);
    rerender(<TopProgressBar active={false} />);
    expect(screen.getByRole("progressbar").getAttribute("data-phase")).toBe("finishing");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("goes back to running if a new wait starts while finishing", () => {
    const { rerender } = render(<TopProgressBar active />);
    rerender(<TopProgressBar active={false} />);
    rerender(<TopProgressBar active />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("progressbar").getAttribute("data-phase")).toBe("running");
  });
});
