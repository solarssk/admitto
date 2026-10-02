// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryHint } from "../../src/components/RetryHint.js";

afterEach(cleanup);

describe("RetryHint", () => {
  it("is an alert with the message and a Retry that calls back", () => {
    const onRetry = vi.fn();
    render(<RetryHint message="Could not load types." busy={false} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load types.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("gives its Retry a name of its own when asked, starting with Retry", () => {
    render(<RetryHint message="Could not load events." busy={false} onRetry={vi.fn()} retryLabel="Retry loading events" />);
    expect(screen.getByRole("button", { name: "Retry loading events" })).toBeTruthy();
  });

  it("has no button when it was given nothing to call", () => {
    render(<RetryHint message="Could not load types." busy={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("keeps the Retry focusable and ignores a click while busy", () => {
    const onRetry = vi.fn();
    render(<RetryHint message="Could not load types." busy onRetry={onRetry} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    retry.focus();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(retry);
  });

  it("mounts the message afresh when a retry ends with the error still there, and never the button", () => {
    const { rerender } = render(<RetryHint message="Could not load types." busy={false} onRetry={() => {}} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    const before = screen.getByText("Could not load types.");

    rerender(<RetryHint message="Could not load types." busy onRetry={() => {}} />);
    // Busy: the same nodes, nothing is announced yet.
    expect(screen.getByText("Could not load types.")).toBe(before);

    rerender(<RetryHint message="Could not load types." busy={false} onRetry={() => {}} />);
    expect(screen.getByText("Could not load types.")).not.toBe(before);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
  });
});
