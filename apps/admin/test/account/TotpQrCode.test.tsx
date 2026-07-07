// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import { TotpQrCode } from "../../src/account/TotpQrCode.js";

vi.mock("qrcode", () => ({
  default: {
    toCanvas: vi.fn().mockResolvedValue(undefined),
  },
}));

const TEST_URI = "otpauth://totp/Admitto:test?secret=JBSWY3DPEHPK3PXP&issuer=Admitto";

describe("TotpQrCode", () => {
  it("renders canvas and calls QRCode.toCanvas with the enrollment URI", async () => {
    const { container } = render(<TotpQrCode uri={TEST_URI} />);
    expect(container.querySelector("canvas")).not.toBeNull();
    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        expect.any(HTMLCanvasElement),
        TEST_URI,
        expect.objectContaining({ width: 160 }),
      );
    });
  });

  it("shows a fallback alert when QR rendering fails", async () => {
    const onRenderFailed = vi.fn();
    vi.mocked(QRCode.toCanvas).mockRejectedValueOnce(new Error("canvas failed"));
    const { getByRole } = render(<TotpQrCode uri={TEST_URI} onRenderFailed={onRenderFailed} />);
    await waitFor(() => {
      expect(getByRole("alert").textContent).toMatch(/Could not render QR code/);
      expect(onRenderFailed).toHaveBeenCalled();
    });
  });

  it("notifies on successful render", async () => {
    const onRenderSuccess = vi.fn();
    render(<TotpQrCode uri={TEST_URI} onRenderSuccess={onRenderSuccess} />);
    await waitFor(() => {
      expect(onRenderSuccess).toHaveBeenCalled();
    });
  });
});
