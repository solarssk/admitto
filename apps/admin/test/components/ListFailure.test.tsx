// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListFailure } from "../../src/components/ListFailure.js";

afterEach(cleanup);

describe("ListFailure", () => {
  it("says nothing when nothing failed", () => {
    const { container } = render(<ListFailure error={null} refreshError={null} onRetry={async () => {}} className="x-status" />);
    expect(container.firstChild).toBeNull();
  });

  it("is an alert with the card's own class and a Retry that reruns the load, when the list could not be loaded", () => {
    const onRetry = vi.fn(async () => {});
    render(<ListFailure error="Could not load users." refreshError={null} onRetry={onRetry} className="x-status" />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toBe("x-status");
    expect(alert.textContent).toContain("Could not load users.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("warns that the list may be older when only a refresh failed", () => {
    render(<ListFailure error={null} refreshError="Could not refresh this list." onRetry={async () => {}} className="x-status" />);
    const alert = screen.getByRole("alert");
    expect(alert.className).not.toContain("x-status");
    expect(alert.textContent).toContain("Could not refresh this list.");
  });

  it("shows the failed load, not the warning, when both are set: the list is gone", () => {
    render(<ListFailure error="Could not load users." refreshError="Could not refresh this list." onRetry={async () => {}} className="x-status" />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("Could not refresh this list.")).toBeNull();
  });
});
