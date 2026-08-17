// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  WalletStatusBadge,
  WALLET_LIFECYCLE_STATUS_LABELS,
  isWalletPassInstalled,
} from "../../src/attendees/walletStatusBadge.js";

afterEach(cleanup);

describe("WalletStatusBadge", () => {
  it("shows Sent for an active pass with no confirmed device registration", () => {
    render(<WalletStatusBadge status="active" installed={false} />);
    expect(screen.getByText("Sent")).toBeTruthy();
  });

  it("shows Added only once a device registration is confirmed", () => {
    render(<WalletStatusBadge status="active" installed={true} />);
    expect(screen.getByText("Added")).toBeTruthy();
  });

  it("ignores installed for a non-active status", () => {
    render(<WalletStatusBadge status="voided" installed={true} />);
    expect(screen.getByText("Voided")).toBeTruthy();
  });

  it("shows Not added when there is no wallet pass", () => {
    render(<WalletStatusBadge status={null} />);
    expect(screen.getByText("Not added")).toBeTruthy();
  });
});

describe("WALLET_LIFECYCLE_STATUS_LABELS", () => {
  it("uses a registration-neutral 'Active' for lifecycle/timeline transitions, unlike the live badge's 'Sent'", () => {
    expect(WALLET_LIFECYCLE_STATUS_LABELS.active).toBe("Active");
  });

  it("keeps every other status label identical to the live badge's labels", () => {
    expect(WALLET_LIFECYCLE_STATUS_LABELS.pending).toBe("Pending");
    expect(WALLET_LIFECYCLE_STATUS_LABELS.voided).toBe("Voided");
    expect(WALLET_LIFECYCLE_STATUS_LABELS.failed).toBe("Failed");
    expect(WALLET_LIFECYCLE_STATUS_LABELS.expired).toBe("Expired");
  });
});

describe("isWalletPassInstalled", () => {
  it("is false when registration counts are both null (never synced)", () => {
    expect(isWalletPassInstalled({ apple_active_registrations: null, google_active_registrations: null })).toBe(false);
  });

  it("is false when registration counts are confirmed zero", () => {
    expect(isWalletPassInstalled({ apple_active_registrations: 0, google_active_registrations: 0 })).toBe(false);
  });

  it("is true when either platform has a confirmed active registration", () => {
    expect(isWalletPassInstalled({ apple_active_registrations: 1, google_active_registrations: 0 })).toBe(true);
    expect(isWalletPassInstalled({ apple_active_registrations: 0, google_active_registrations: 2 })).toBe(true);
  });
});
