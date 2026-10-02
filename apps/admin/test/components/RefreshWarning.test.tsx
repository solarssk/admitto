// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefreshWarning } from "../../src/components/RefreshWarning.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("RefreshWarning", () => {
  it("is an alert with the message and a Retry that is not busy until it is pressed", () => {
    render(<RefreshWarning message="Could not refresh this list." onRetry={async () => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not refresh this list.");
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull();
  });

  it("keeps the Retry busy from its click for at least 400ms, even when it fails at once, and announces the message again", async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn(async () => {});
    render(<RefreshWarning message="Could not refresh this list." onRetry={onRetry} />);
    const before = screen.getByText("Could not refresh this list.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advance(0);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true");
    await advance(399);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true");
    await advance(1);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull();
    // The same text again, but a new element: that is what makes the live region read it out once more.
    expect(screen.getByText("Could not refresh this list.")).not.toBe(before);
  });

  it("stays busy while the retry itself is still running", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    render(<RefreshWarning message="Could not refresh this list." onRetry={() => new Promise<void>((resolve) => (finish = resolve))} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advance(5000);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => finish());
    await advance(0);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull();
  });
});
