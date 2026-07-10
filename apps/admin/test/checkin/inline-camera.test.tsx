// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CkInlineCamera } from "../../src/checkin/CkInlineCamera.js";
import { isDesktopViewport, useIsDesktop } from "../../src/hooks/useIsDesktop.js";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mq = {
    matches,
    media: "(min-width: 768px)",
    addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => {
      listeners.add(handler);
    },
    removeEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => {
      listeners.delete(handler);
    },
    dispatch(next: boolean) {
      Object.assign(mq, { matches: next });
      listeners.forEach((handler) => handler({ matches: next } as MediaQueryListEvent));
    },
  };
  vi.stubGlobal("matchMedia", () => mq);
  return mq;
}

const baseProps = {
  wedgeActive: false,
  scannerPaused: false,
  overlayScanResult: null,
  onScan: () => {},
  onClose: () => {},
  onReset: () => {},
};

describe("useIsDesktop", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("returns true when viewport is desktop width", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
    expect(isDesktopViewport()).toBe(true);
  });

  it("updates when matchMedia changes", () => {
    const mq = mockMatchMedia(false);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);

    act(() => {
      mq.dispatch(true);
    });
    expect(result.current).toBe(true);
  });
});

describe("CkInlineCamera", () => {
  beforeEach(() => {
    mockMatchMedia(true);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders viewfinder when no scan result", () => {
    render(<CkInlineCamera {...baseProps} />);
    expect(screen.getByTestId("camera-scanner")).toBeTruthy();
    expect(screen.getByText(/Point the camera at the attendee's QR/i)).toBeTruthy();
    expect(screen.getByLabelText("Exit camera mode")).toBeTruthy();
  });

  it("hides hint when scanner is paused for AttendeeCard below", () => {
    render(<CkInlineCamera {...baseProps} scannerPaused />);
    expect(screen.queryByText(/Point the camera at the attendee's QR/i)).toBeNull();
  });

  it("calls onReset and onClose when exit is clicked", () => {
    const onClose = vi.fn();
    const onReset = vi.fn();
    render(
      <CkInlineCamera
        {...baseProps}
        onClose={onClose}
        onReset={onReset}
        overlayScanResult={{ status: "INVALID", confirmed: false }}
      />,
    );
    screen.getByLabelText("Exit camera mode").click();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses via Escape", () => {
    const onClose = vi.fn();
    const onReset = vi.fn();
    render(<CkInlineCamera {...baseProps} onClose={onClose} onReset={onReset} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the shared ScanFeedback card (not the mobile full-color result panel) on no-match", () => {
    render(
      <CkInlineCamera
        {...baseProps}
        scannerPaused
        overlayScanResult={{ status: "INVALID", confirmed: false }}
      />,
    );
    // ScanFeedback copy + status strip, never the CheckInCameraResultPanel's
    // "Invalid ticket" heading or Scan next / Cancel buttons (Fix: desktop
    // camera reuses the typed-search feedback component — PO review).
    expect(screen.getByText(/This code is not valid for this event/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Invalid ticket" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan next" })).toBeNull();
    // Exit (X) is the only way out and stays available.
    expect(screen.getByLabelText("Exit camera mode")).toBeTruthy();
  });
});
