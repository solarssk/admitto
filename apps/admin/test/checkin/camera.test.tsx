// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { CameraScanner } from "../../src/checkin/CameraScanner.js";

const { decodeFromVideoDevice } = vi.hoisted(() => {
  const decodeFromVideoDevice = vi.fn().mockResolvedValue({ stop: vi.fn() });
  return { decodeFromVideoDevice };
});

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class MockBrowserQRCodeReader {
    decodeFromVideoDevice = decodeFromVideoDevice;
  },
}));

describe("CameraScanner", () => {
  beforeEach(() => {
    decodeFromVideoDevice.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
  });
});
