// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryEmptyState } from "../../src/components/RetryEmptyState.js";

afterEach(cleanup);

function tabPanel(children: React.ReactNode) {
  return <div role="tabpanel">{children}</div>;
}

describe("RetryEmptyState", () => {
  it("says what failed and why, as an alert, with a Retry that calls back", () => {
    const onRetry = vi.fn(() => Promise.resolve());
    render(<RetryEmptyState title="Could not load providers" message="Network down." retrying={false} onRetry={onRetry} />);
    expect(screen.getByText("Could not load providers")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Network down.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the Retry focusable and ignores a click while it is busy", () => {
    const onRetry = vi.fn(() => Promise.resolve());
    render(<RetryEmptyState title="Could not load" message="Network down." retrying onRetry={onRetry} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    retry.focus();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(retry);
  });

  it("mounts the message afresh when a retry ends with the failure still there, and never the button", () => {
    const props = { title: "Could not load", message: "Network down.", onRetry: () => Promise.resolve() };
    const { rerender } = render(<RetryEmptyState {...props} retrying={false} />);
    const retry = screen.getByRole("button", { name: "Retry" });
    const before = screen.getByText("Network down.");

    rerender(<RetryEmptyState {...props} retrying />);
    expect(screen.getByText("Network down.")).toBe(before);

    rerender(<RetryEmptyState {...props} retrying={false} />);
    expect(screen.getByText("Network down.")).not.toBe(before);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
  });

  it("hands the focus of a Retry that goes away to the tab panel it sat in", async () => {
    const props = { title: "Could not load", message: "Network down.", onRetry: () => Promise.resolve() };
    const { rerender } = render(tabPanel(<RetryEmptyState {...props} retrying={false} />));
    screen.getByRole("button", { name: "Retry" }).focus();

    rerender(tabPanel(<p>Loaded</p>));
    await Promise.resolve();
    expect(document.activeElement).toBe(screen.getByRole("tabpanel"));
  });
});
