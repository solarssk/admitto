// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, waitFor, screen } from "@testing-library/react";
import { CameraScanner } from "../../src/checkin/CameraScanner.js";

const { decodeFromVideoDevice, stop } = vi.hoisted(() => {
  const stop = vi.fn();
  const decodeFromVideoDevice = vi.fn().mockResolvedValue({ stop });
  return { decodeFromVideoDevice, stop };
});

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class MockBrowserQRCodeReader {
    decodeFromVideoDevice = decodeFromVideoDevice;
  },
}));

describe("CameraScanner", () => {
  beforeEach(() => {
    decodeFromVideoDevice.mockClear();
    stop.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not load zxing when disabled", () => {
    render(<CameraScanner enabled={false} wedgeActive={false} onScan={() => {}} />);
    expect(decodeFromVideoDevice).not.toHaveBeenCalled();
  });

  it("starts decode only when enabled and wedge inactive", async () => {
    render(<CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />);
    await waitFor(() => {
      expect(decodeFromVideoDevice).toHaveBeenCalled();
    });
  });

  it("pauses decode when wedge has input", async () => {
    const { rerender } = render(
      <CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />,
    );
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalledTimes(1));

    rerender(<CameraScanner enabled={true} wedgeActive={true} onScan={() => {}} />);
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it("shows fullscreen toggle button", async () => {
    render(<CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />);
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Enter fullscreen" })).toBeTruthy();
  });

  it("uses CSS fallback when requestFullscreen is unavailable", async () => {
    const { container } = render(
      <CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />,
    );
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());

    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    Object.defineProperty(video!.parentElement, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    expect(container.querySelector(".checkin-camera--fullscreen")).toBeTruthy();
  });
});
