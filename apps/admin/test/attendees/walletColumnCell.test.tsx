// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import { WalletColumnCell } from "../../src/attendees/walletColumnCell.js";

const BOTH_ENABLED: EnabledWalletPlatforms = { apple: true, google: true, any: true };

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
        }}
        enabledPlatforms={BOTH_ENABLED}
      />,
    );
    const apple = screen.getByLabelText("Apple Wallet: Registered");
    const google = screen.getByLabelText("Google Wallet: Not added");
    expect(apple.className).toContain("attendees-table-v2__wallet-icon--active");
    expect(google.className).not.toContain("attendees-table-v2__wallet-icon--active");
  });

  it("shows both platforms as inactive when neither has an active registration", () => {
    render(
      <WalletColumnCell
        status={{
          apple_active_registrations: null,
          apple_inactive_registrations: null,
          google_active_registrations: 0,
          google_inactive_registrations: 1,
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
      <WalletColumnCell status={null} enabledPlatforms={{ apple: false, google: false, any: false }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows only the Apple icon when only Apple Wallet is enabled", () => {
    render(
      <WalletColumnCell
        status={null}
        enabledPlatforms={{ apple: true, google: false, any: true }}
      />,
    );
    expect(screen.getByLabelText("Apple Wallet: Not added")).toBeTruthy();
    expect(screen.queryByLabelText(/Google Wallet/)).toBeNull();
  });
});
