// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WalletColumnCell } from "../../src/attendees/walletColumnCell.js";

afterEach(() => {
  cleanup();
});

describe("WalletColumnCell", () => {
  it("shows a dash when no WalletPass row exists", () => {
    render(<WalletColumnCell status={null} />);
    expect(screen.getByText("-")).toBeTruthy();
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
      />,
    );
    const apple = screen.getByLabelText("Apple Wallet: Status unknown");
    const google = screen.getByLabelText("Google Wallet: Unregistered");
    expect(apple.className).not.toContain("attendees-table-v2__wallet-icon--active");
    expect(google.className).not.toContain("attendees-table-v2__wallet-icon--active");
  });
});
