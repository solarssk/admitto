import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../src/components/Toast.js";

function ToastHarness({
  message = "Message",
  variant = "success" as const,
  duration = 4000,
  label = "Show toast",
}: {
  message?: string;
  variant?: "success" | "error" | "info" | "warning";
  duration?: number;
  label?: string;
}) {
  const { addToast } = useToast();
  return (
    <button type="button" onClick={() => addToast(message, variant, duration)}>
      {label}
    </button>
  );
}

function renderWithToast(ui: ReactNode) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("Toast / useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows toast with success variant class", () => {
    renderWithToast(<ToastHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    const toast = screen.getByTestId("at-toast");
    expect(toast.className).toContain("at-toast--success");
    expect(screen.getByText("Message")).toBeTruthy();
  });

  it("dismisses toast after duration", async () => {
    renderWithToast(<ToastHarness duration={100} />);
    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    expect(screen.getByTestId("at-toast")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("dismisses toast immediately via dismiss button", () => {
    renderWithToast(<ToastHarness duration={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("keeps at most 5 toasts visible", () => {
    renderWithToast(
      <>
        {Array.from({ length: 6 }, (_, i) => (
          <ToastHarness key={i} message={`Message ${i}`} duration={0} label={`Show toast ${i}`} />
        ))}
      </>,
    );
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole("button", { name: `Show toast ${i}` }));
    }
    expect(screen.getAllByTestId("at-toast")).toHaveLength(5);
  });

  it("does not stack duplicate message and variant", () => {
    renderWithToast(<ToastHarness duration={0} />);
    const trigger = screen.getByRole("button", { name: "Show toast" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.getAllByTestId("at-toast")).toHaveLength(1);
  });

  it("clears auto-dismiss timer for toast evicted by the 5-toast cap", async () => {
    renderWithToast(
      <>
        <ToastHarness message="First toast" duration={5000} label="Show first toast" />
        {Array.from({ length: 5 }, (_, i) => (
          <ToastHarness
            key={i}
            message={`Later toast ${i}`}
            duration={0}
            label={`Show later toast ${i}`}
          />
        ))}
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show first toast" }));
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: `Show later toast ${i}` }));
    }
    expect(screen.getAllByTestId("at-toast")).toHaveLength(5);
    expect(screen.queryByText("First toast")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getAllByTestId("at-toast")).toHaveLength(5);
  });

  it("clears pending timers on unmount", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = renderWithToast(<ToastHarness duration={5000} />);
    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("throws when useToast is used outside ToastProvider", () => {
    function Outside() {
      useToast();
      return null;
    }
    expect(() => render(<Outside />)).toThrow("useToast must be used within <ToastProvider>");
  });
});
