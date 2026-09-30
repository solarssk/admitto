// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraOverlay } from "../../src/checkin/CameraOverlay.js";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const baseProps = {
  open: true,
  eventTimezone: "UTC",
  admittedCount: 7,
  history: [],
  wedgeActive: false,
  onClose: () => {},
  onScan: vi.fn(),
  allowManualLookup: true,
  onSearch: vi.fn().mockResolvedValue([]),
  onSelectAttendee: vi.fn(),
  onManualEntry: vi.fn(),
  onClearManualError: () => {},
  scanResult: null,
  card: null,
  pending: false,
  canAct: true,
  onReset: () => {},
};

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("CameraOverlay while the first load of the counts and history is running", () => {
  it("shows no '0 checked in' and no 'No scans yet', holds the space, then draws a placeholder after 200ms", async () => {
    render(<CameraOverlay {...baseProps} admittedCount={0} historyLoading />);
    const count = () => document.querySelector(".ck-overlay__admitted") as HTMLElement;
    const recent = () => document.querySelector(".ck-overlay__aside .ck-recent") as HTMLElement;

    expect(count().textContent).toBe(" checked in");
    expect(count().querySelector(".at-skeleton")?.className).toContain("at-loading-hold");
    expect(recent().className).toContain("at-loading-hold");
    expect(screen.queryByText("No scans yet")).toBeNull();

    await advance(200);
    expect(count().querySelector(".at-skeleton")?.className).not.toContain("at-loading-hold");
    expect(recent().className).not.toContain("at-loading-hold");
    expect(screen.queryByText("No scans yet")).toBeNull();
  });

  it("shows the real count and history once the load is over and the placeholder has had its 400ms", async () => {
    const { rerender } = render(<CameraOverlay {...baseProps} historyLoading />);
    await advance(250);
    rerender(<CameraOverlay {...baseProps} historyLoading={false} />);
    await advance(400);
    expect(screen.getByText(/7/, { selector: ".ck-overlay__admitted" })).toBeTruthy();
    expect(screen.getByText("No scans yet")).toBeTruthy();
    expect(document.querySelector(".ck-overlay .at-skeleton")).toBeNull();
  });

  it("is unchanged when it opens with the numbers already loaded", () => {
    render(<CameraOverlay {...baseProps} />);
    expect(document.querySelector(".ck-overlay__admitted")?.textContent).toBe("7 checked in");
    expect(screen.getByText("No scans yet")).toBeTruthy();
    expect(document.querySelector(".ck-overlay .at-skeleton")).toBeNull();
  });
});

describe("CameraOverlay when the first load of the counts and history failed", () => {
  it("says so in the bar and the list, with a Retry, instead of '0 checked in' and 'No scans yet'", () => {
    const onRetryHistory = vi.fn();
    render(<CameraOverlay {...baseProps} admittedCount={0} historyError onRetryHistory={onRetryHistory} />);
    expect(document.querySelector(".ck-overlay__admitted")?.textContent).toBe("Count unavailable");
    expect(screen.queryByText("No scans yet")).toBeNull();
    expect(screen.getByText("Could not load the counts and recent scans.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryHistory).toHaveBeenCalledTimes(1);
  });

  it("keeps the Retry busy for at least 400ms even when the retry fails again at once", async () => {
    const { rerender } = render(<CameraOverlay {...baseProps} historyError onRetryHistory={vi.fn()} />);
    rerender(<CameraOverlay {...baseProps} historyError historyRetrying onRetryHistory={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true");
    rerender(<CameraOverlay {...baseProps} historyError historyRetrying={false} onRetryHistory={vi.fn()} />);
    await advance(399);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true");
    await advance(1);
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull();
  });

  it("shows the count again when the retry succeeds", () => {
    const { rerender } = render(<CameraOverlay {...baseProps} historyError onRetryHistory={vi.fn()} />);
    rerender(<CameraOverlay {...baseProps} />);
    expect(document.querySelector(".ck-overlay__admitted")?.textContent).toBe("7 checked in");
    expect(screen.queryByText("Could not load the counts and recent scans.")).toBeNull();
  });
});
