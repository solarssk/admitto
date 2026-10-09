// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListFailure } from "../../src/components/ListFailure.js";
import type { RetryKeepingError } from "../../src/hooks/useRetryKeepingError.js";

afterEach(cleanup);

const noop = () => Promise.resolve();

function failureOf(error: string | null, overrides: Partial<RetryKeepingError> = {}): RetryKeepingError {
  return { error, retrying: false, running: false, retry: noop, ...overrides };
}

describe("ListFailure", () => {
  it("says nothing when nothing failed", () => {
    const { container } = render(<ListFailure failure={failureOf(null)} refreshError={null} onRefresh={noop} title="Could not load users" />);
    expect(container.firstChild).toBeNull();
  });

  it("is the shared error placeholder, with the title it is given, that fades in, and a Retry that reruns the load, when the list could not be loaded", () => {
    const retry = vi.fn(noop);
    render(<ListFailure failure={failureOf("Something went wrong.", { retry })} refreshError={null} onRefresh={noop} title="Could not load users" />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toBe("at-empty-state at-empty-state--error at-fade-in");
    expect(screen.getByText("Could not load users")).toBeTruthy();
    expect(alert.textContent).toContain("Something went wrong.");
    // The glyph an error has everywhere, over the title.
    expect(alert.querySelector(".at-empty-state__icon i.ti-circle-x")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps the error with a busy Retry, whose focus it keeps, while the retry runs", () => {
    const retry = vi.fn(noop);
    const { rerender } = render(<ListFailure failure={failureOf("Could not load users.", { retry })} refreshError={null} onRefresh={noop} title="Could not load users" />);
    const button = screen.getByRole("button", { name: "Retry" });
    expect(button.getAttribute("aria-busy")).toBeNull();
    button.focus();

    rerender(<ListFailure failure={failureOf("Could not load users.", { retry, retrying: true, running: true })} refreshError={null} onRefresh={noop} title="Could not load users" />);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(retry).not.toHaveBeenCalled();
  });

  it("warns that the list may be older when only a refresh failed, with a Retry that refreshes", () => {
    const onRefresh = vi.fn(noop);
    render(<ListFailure failure={failureOf(null)} refreshError="Could not refresh this list." onRefresh={onRefresh} title="Could not load users" />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("at-notice");
    expect(alert.textContent).toContain("Could not refresh this list.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows the failed load, not the warning, when both are set: the list is gone", () => {
    render(<ListFailure failure={failureOf("Could not load users.")} refreshError="Could not refresh this list." onRefresh={noop} title="Could not load users" />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("Could not refresh this list.")).toBeNull();
  });
});
