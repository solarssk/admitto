// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { CameraScanner } from "../../src/checkin/CameraScanner.js";

const { decodeFromConstraints, stop } = vi.hoisted(() => {
  const stop = vi.fn();
  const decodeFromConstraints = vi.fn().mockResolvedValue({ stop });
  return { decodeFromConstraints, stop };
});

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class MockBrowserQRCodeReader {
    decodeFromConstraints = decodeFromConstraints;
  },
}));

describe("CameraScanner", () => {
  beforeEach(() => {
    decodeFromConstraints.mockClear();
    stop.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not load zxing when disabled", () => {
    render(<CameraScanner enabled={false} wedgeActive={false} onScan={() => {}} />);
    expect(decodeFromConstraints).not.toHaveBeenCalled();
  });

  it("starts decode only when enabled and wedge inactive", async () => {
    render(<CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />);
    await waitFor(() => {
      expect(decodeFromConstraints).toHaveBeenCalled();
    });
  });

  it("requests the rear camera with a continuous-focus hint (close-range QR focus, PO review)", async () => {
    render(<CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />);
    await waitFor(() => expect(decodeFromConstraints).toHaveBeenCalled());

    const [constraints] = decodeFromConstraints.mock.calls[0] as [MediaStreamConstraints];
    const video = constraints.video as MediaTrackConstraints;
    expect(video.facingMode).toBe("environment");
    expect(video.advanced).toEqual([{ focusMode: "continuous" }]);
  });

  it("pauses decode when wedge has input", async () => {
    const { rerender } = render(
      <CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />,
    );
    await waitFor(() => expect(decodeFromConstraints).toHaveBeenCalledTimes(1));

    rerender(<CameraScanner enabled={true} wedgeActive={true} onScan={() => {}} />);
    await waitFor(() => expect(decodeFromConstraints).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it("debounces repeated decodes of the same QR", async () => {
    const onScan = vi.fn();
    let decodeCallback: ((result: { getText: () => string } | undefined) => void) | undefined;

    decodeFromConstraints.mockImplementation(async (_constraints, _video, callback) => {
      decodeCallback = callback;
      return { stop };
    });

    render(<CameraScanner enabled={true} wedgeActive={false} onScan={onScan} />);
    await waitFor(() => expect(decodeCallback).toBeTypeOf("function"));

    vi.useFakeTimers();
    const result = { getText: () => "https://example.com/t/abc" };
    decodeCallback?.(result);
    decodeCallback?.(result);
    expect(onScan).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2500);
    decodeCallback?.(result);
    expect(onScan).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
