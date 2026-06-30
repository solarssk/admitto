// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TotpQrCode } from "../../src/account/TotpQrCode.js";

vi.mock("qrcode", () => ({
  default: {
    toCanvas: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("TotpQrCode", () => {
  it("renders canvas without throwing", () => {
    const { container } = render(
      <TotpQrCode uri="otpauth://totp/Admitto:test?secret=JBSWY3DPEHPK3PXP&issuer=Admitto" />,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
