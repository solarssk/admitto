import type { WalletProviderRegistrations, WalletProviderSnapshot } from "../src/types.js";

/** A WalletProviderSnapshot for stubbing WalletPassProvider.getPassSnapshot: not voided, no
 * expiration, all registration counts 0 unless overridden - so a test only restates the field it
 * actually cares about instead of the whole snapshot shape. */
export function walletSnapshot(
  registrations: Partial<WalletProviderRegistrations> = {},
  overrides: Partial<Omit<WalletProviderSnapshot, "registrations">> = {},
): WalletProviderSnapshot {
  return {
    observedAt: new Date("2026-09-01T10:00:00.000Z"),
    validity: { voided: false, expirationRaw: null, expiresAt: null },
    registrations: {
      appleActive: 0,
      appleInactive: 0,
      googleActive: 0,
      googleInactive: 0,
      samsungActive: 0,
      samsungInactive: 0,
      ...registrations,
    },
    firstDownloadedAt: null,
    ...overrides,
  };
}
