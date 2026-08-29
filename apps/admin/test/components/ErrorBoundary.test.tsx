// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/components/ErrorBoundary.js";
import { reportClientError } from "../../src/reportClientError.js";

vi.mock("../../src/reportClientError.js", () => ({
  reportClientError: vi.fn(),
}));

function ThrowsOnRender(): never {
  throw new Error("boom");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders its children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>Real content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Real content")).toBeTruthy();
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it("catches a render error, reports it, and shows the recoverable fallback", () => {
    // React logs the caught error to console.error even though this test expects and asserts
    // on it via reportClientError - suppressed here so it doesn't clutter test output.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowsOnRender />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByText("Real content")).toBeNull();

    expect(reportClientError).toHaveBeenCalledTimes(1);
    const [error, context] = vi.mocked(reportClientError).mock.calls[0]!;
    expect((error as Error).message).toBe("boom");
    expect(context).toMatchObject({ source: "admin-error-boundary" });

    consoleError.mockRestore();
  });

  it("reloads the page from the fallback's Reload button", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    // window.location.reload isn't implemented in jsdom - stub the whole location object rather
    // than just the one method, since it's read-only on the real Location prototype.
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    render(
      <ErrorBoundary>
        <ThrowsOnRender />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});
