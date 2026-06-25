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
    render(
      <CkInlineCamera
        wedgeActive={false}
        onScan={() => {}}
        onClose={() => {}}
        scanResult={null}
        card={null}
        pending={false}
        canAct
        onReset={() => {}}
      />,
    );
    expect(screen.getByTestId("camera-scanner")).toBeTruthy();
    expect(screen.getByText(/Point the camera at the attendee's QR/i)).toBeTruthy();
    expect(screen.getByLabelText("Exit camera mode")).toBeTruthy();
  });

  it("renders result panel when scanResult is set", () => {
    render(
      <CkInlineCamera
        wedgeActive={false}
        onScan={() => {}}
        onClose={() => {}}
        scanResult={{ status: "INVALID", confirmed: false }}
        card={null}
        pending={false}
        canAct
        onReset={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Invalid ticket" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan next" })).toBeTruthy();
  });
});
