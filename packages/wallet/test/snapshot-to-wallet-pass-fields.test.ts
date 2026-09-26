import { describe, expect, it } from "vitest";
import { snapshotToWalletPassFields } from "../src/snapshot-to-wallet-pass-fields.js";
import { walletSnapshot } from "./snapshot-fixture.js";

describe("snapshotToWalletPassFields", () => {
  it("maps every registration count and the first-download time onto WalletPass's own columns", () => {
    const fields = snapshotToWalletPassFields(
      walletSnapshot(
        { appleActive: 1, appleInactive: 2, googleActive: 3, googleInactive: 4, samsungActive: 5, samsungInactive: 6 },
        { firstDownloadedAt: "2026-08-25 09:00" },
      ),
    );

    expect(fields).toEqual({
      apple_active_registrations: 1,
      apple_inactive_registrations: 2,
      google_active_registrations: 3,
      google_inactive_registrations: 4,
      samsung_active_registrations: 5,
      samsung_inactive_registrations: 6,
      first_downloaded_at: "2026-08-25 09:00",
    });
  });

  it("persists a confirmed zero as a zero, not as a missing value", () => {
    const fields = snapshotToWalletPassFields(walletSnapshot());
    expect(fields.apple_active_registrations).toBe(0);
    expect(fields.first_downloaded_at).toBeNull();
  });

  it("leaves the counts out entirely when the provider can't report registrations, instead of zeroing them", () => {
    const fields = snapshotToWalletPassFields({ ...walletSnapshot(), registrations: null });

    expect(fields).toEqual({ first_downloaded_at: null });
    expect(fields).not.toHaveProperty("apple_active_registrations");
  });

  it("never persists the provider's validity observation", () => {
    const fields = snapshotToWalletPassFields({
      ...walletSnapshot(),
      validity: { voided: true, expirationRaw: "2026-09-25 23:59", expiresAt: new Date("2026-09-25T21:59:00Z") },
    });

    expect(Object.keys(fields).sort()).not.toContain("status");
    expect(JSON.stringify(fields)).not.toContain("2026-09-25");
  });
});
