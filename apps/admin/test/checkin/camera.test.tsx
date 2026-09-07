// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    // `ideal`, not a bare string — a bare facingMode is a required/exact
    // match per spec, which throws OverconstrainedError on a desktop webcam
    // with no environment-facing capability (this same component also
    // renders the desktop inline camera).
    expect(video.facingMode).toEqual({ ideal: "environment" });
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

  describe("camera start failure", () => {
    it("shows a permission-denied message for NotAllowedError", async () => {
      decodeFromConstraints.mockRejectedValueOnce(
        new DOMException("denied", "NotAllowedError"),
      );
      render(<CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />);
      expect(
        await screen.findByText(
          "Camera access denied. Allow camera access for this site in your browser settings, then reload.",
        ),
      ).toBeTruthy();
    });

    it("shows the same permission-denied message for SecurityError", async () => {
      decodeFromConstraints.mockRejectedValueOnce(
        new DOMException("insecure context", "SecurityError"),
      );
      render(<CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />);
      expect(
        await screen.findByText(
          "Camera access denied. Allow camera access for this site in your browser settings, then reload.",
        ),
      ).toBeTruthy();
    });

    it("shows a no-camera message for NotFoundError", async () => {
      decodeFromConstraints.mockRejectedValueOnce(
        new DOMException("no device", "NotFoundError"),
      );
      render(<CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />);
      expect(await screen.findByText("No camera found on this device.")).toBeTruthy();
    });

    it("shows a broader access-problem message for NotReadableError, without asserting a single cause (bot review)", async () => {
      decodeFromConstraints.mockRejectedValueOnce(
        new DOMException("hardware error", "NotReadableError"),
      );
      render(<CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />);
      expect(
        await screen.findByText(
          "Could not access the camera. It may be in use by another app, or a hardware problem. Close other apps using the camera and try again.",
        ),
      ).toBeTruthy();
    });

    it("shows a generic start-failure message for an unrecognized error", async () => {
      decodeFromConstraints.mockRejectedValueOnce(new Error("boom"));
      render(<CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />);
      expect(await screen.findByText("Could not start the camera. Try again.")).toBeTruthy();
    });

    it("does not set an error once the camera has already been stopped (unmounted before the rejection settles)", async () => {
      let rejectStart!: (err: unknown) => void;
      decodeFromConstraints.mockImplementationOnce(
        () => new Promise((_resolve, reject) => { rejectStart = reject; }),
      );
      const { unmount } = render(
        <CameraScanner enabled={true} wedgeActive={false} onScan={() => {}} />,
      );
      await waitFor(() => expect(decodeFromConstraints).toHaveBeenCalled());

      unmount();
      rejectStart(new DOMException("no device", "NotFoundError"));

      // Nothing left to assert on the unmounted tree - this just proves the rejection after
      // unmount doesn't throw an unhandled/act warning by trying to setState on a gone component.
      await Promise.resolve();
    });
  });
});
