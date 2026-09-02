// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import { WalletColumnCell } from "../../src/attendees/walletColumnCell.js";

const BOTH_ENABLED: EnabledWalletPlatforms = { apple: true, google: true, samsung: false, any: true };

afterEach(() => {
  cleanup();
});

describe("WalletColumnCell", () => {
  it("shows both platform icons muted, labelled Not added, when no WalletPass row exists", () => {
    render(<WalletColumnCell status={null} enabledPlatforms={BOTH_ENABLED} />);
    const apple = screen.getByLabelText("Apple Wallet: Not added");
    const google = screen.getByLabelText("Google Wallet: Not added");
    expect(apple.className).not.toContain("attendees-table-v2__wallet-icon--active");
    expect(google.className).not.toContain("attendees-table-v2__wallet-icon--active");
  });

  it("highlights only the platform(s) with an active registration", () => {
    render(
      <WalletColumnCell
        status={{
          apple_active_registrations: 1,
          apple_inactive_registrations: 0,
          google_active_registrations: 0,
          google_inactive_registrations: 0,
          samsung_active_registrations: 0,
          samsung_inactive_registrations: 0,
        }}
        enabledPlatforms={BOTH_ENABLED}
      />,
    );
    const apple = screen.getByLabelText("Apple Wallet: Registered");
    const google = screen.getByLabelText("Google Wallet: Not added");
    expect(apple.className).toContain("attendees-table-v2__wallet-icon--active");
    expect(google.className).not.toContain("attendees-table-v2__wallet-icon--active");
  });

  it("highlights the Samsung icon too once it has a real active registration", () => {
    render(
      <WalletColumnCell
        status={{
          apple_active_registrations: 0,
          apple_inactive_registrations: 0,
          google_active_registrations: 0,
          google_inactive_registrations: 0,
          samsung_active_registrations: 1,
          samsung_inactive_registrations: 0,
        }}
        enabledPlatforms={{ apple: true, google: true, samsung: true, any: true }}
      />,
    );
    const samsung = screen.getByLabelText("Samsung Wallet: Registered");
    // SVG elements expose a live `.className` as an SVGAnimatedString, not a plain string like
    // HTML elements (unlike Apple/Google's <i> font-glyph icons above) - read the class attribute
    // directly instead, which behaves the same for both element types.
    expect(samsung.getAttribute("class")).toContain("attendees-table-v2__wallet-icon--active");
  });

  it("shows both platforms as inactive when neither has an active registration", () => {
    render(
      <WalletColumnCell
        status={{
          apple_active_registrations: null,
          apple_inactive_registrations: null,
          google_active_registrations: 0,
          google_inactive_registrations: 1,
          samsung_active_registrations: null,
          samsung_inactive_registrations: null,
        }}
        enabledPlatforms={BOTH_ENABLED}
      />,
    );
    const apple = screen.getByLabelText("Apple Wallet: Status unknown");
    const google = screen.getByLabelText("Google Wallet: Unregistered");
    expect(apple.className).not.toContain("attendees-table-v2__wallet-icon--active");
    expect(google.className).not.toContain("attendees-table-v2__wallet-icon--active");
  });

  it("renders nothing when neither platform is enabled for the event", () => {
    const { container } = render(
      <WalletColumnCell
        status={null}
        enabledPlatforms={{ apple: false, google: false, samsung: false, any: false }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows only the Apple icon when only Apple Wallet is enabled", () => {
    render(
      <WalletColumnCell
        status={null}
        enabledPlatforms={{ apple: true, google: false, samsung: false, any: true }}
      />,
    );
    expect(screen.getByLabelText("Apple Wallet: Not added")).toBeTruthy();
    expect(screen.queryByLabelText(/Google Wallet/)).toBeNull();
    expect(screen.queryByLabelText(/Samsung Wallet/)).toBeNull();
  });

  it("shows the Samsung icon, muted like Apple/Google, when no WalletPass row exists yet", () => {
    render(
      <WalletColumnCell
        status={null}
        enabledPlatforms={{ apple: true, google: true, samsung: true, any: true }}
      />,
    );
    const samsung = screen.getByLabelText("Samsung Wallet: Not added");
    expect(samsung).toBeTruthy();
    // SVG className is a live SVGAnimatedString, not a plain string - read the attribute instead.
    expect(samsung.getAttribute("class")).not.toContain("attendees-table-v2__wallet-icon--active");
  });

  it("omits the Samsung icon when Samsung Wallet is disabled, even with Apple/Google both on", () => {
    render(<WalletColumnCell status={null} enabledPlatforms={BOTH_ENABLED} />);
    expect(screen.queryByLabelText(/Samsung Wallet/)).toBeNull();
  });

  it("still shows the Samsung icon when it's the only platform enabled - Apple/Google being off must not hide it too", () => {
    // `any` stays false (EnabledWalletPlatforms.any is deliberately Apple/Google only - real
    // pass-lifecycle actions elsewhere in the admin can't apply to Samsung), but this cell reads
    // real Samsung registration data the same way it does Apple/Google's, so it must not depend
    // on `any` to decide whether to render.
    render(
      <WalletColumnCell
        status={null}
        enabledPlatforms={{ apple: false, google: false, samsung: true, any: false }}
      />,
    );
    expect(screen.getByLabelText("Samsung Wallet: Not added")).toBeTruthy();
    expect(screen.queryByLabelText(/Apple Wallet/)).toBeNull();
    expect(screen.queryByLabelText(/Google Wallet/)).toBeNull();
  });

  it("renders nothing at all when no platform is enabled", () => {
    const { container } = render(
      <WalletColumnCell
        status={null}
        enabledPlatforms={{ apple: false, google: false, samsung: false, any: false }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
