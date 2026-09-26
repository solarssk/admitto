import type { WalletProviderRegistrations, WalletProviderSnapshot } from "@admitto/wallet";

/** A WalletProviderSnapshot for stubbing WalletPassProvider.getPassSnapshot in tests: not voided,
 * no expiration, all registration counts 0 unless overridden. Shared so the wallet integration
 * suites don't each restate the whole snapshot shape around the one field they care about. */
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
