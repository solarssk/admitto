import { describe, expect, it } from "vitest";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import {
  buildActiveWalletFilter,
  buildEverInstalledWalletFilter,
  buildWalletLifecycleFilter,
} from "../../src/admin/wallet-lifecycle-filter.js";

const ALL_ENABLED: EnabledWalletPlatforms = { apple: true, google: true, samsung: true, any: true };
const APPLE_ONLY: EnabledWalletPlatforms = { apple: true, google: false, samsung: false, any: true };
const NONE_ENABLED: EnabledWalletPlatforms = { apple: false, google: false, samsung: false, any: false };

describe("buildEverInstalledWalletFilter", () => {
  it("ORs first_confirmed_at with every active/inactive registration column, each gt 0 paired with not null", () => {
    expect(buildEverInstalledWalletFilter()).toEqual({
      OR: [
        { wallet_pass: { first_confirmed_at: { not: null } } },
        { wallet_pass: { apple_active_registrations: { gt: 0, not: null } } },
        { wallet_pass: { google_active_registrations: { gt: 0, not: null } } },
        { wallet_pass: { samsung_active_registrations: { gt: 0, not: null } } },
        { wallet_pass: { apple_inactive_registrations: { gt: 0, not: null } } },
        { wallet_pass: { google_inactive_registrations: { gt: 0, not: null } } },
        { wallet_pass: { samsung_inactive_registrations: { gt: 0, not: null } } },
      ],
    });
  });
});

describe("buildActiveWalletFilter", () => {
  it("only includes active-registration checks for enabled platforms", () => {
    expect(buildActiveWalletFilter(APPLE_ONLY)).toEqual({
      OR: [{ wallet_pass: { apple_active_registrations: { gt: 0, not: null } } }],
    });
  });

  it("includes every platform when all are enabled", () => {
    expect(buildActiveWalletFilter(ALL_ENABLED)).toEqual({
      OR: [
        { wallet_pass: { apple_active_registrations: { gt: 0, not: null } } },
        { wallet_pass: { google_active_registrations: { gt: 0, not: null } } },
        { wallet_pass: { samsung_active_registrations: { gt: 0, not: null } } },
      ],
    });
  });

  it("matches nobody when no platform is enabled", () => {
    expect(buildActiveWalletFilter(NONE_ENABLED)).toEqual({ id: { in: [] } });
  });
});

describe("buildWalletLifecycleFilter", () => {
  it("'active' delegates to buildActiveWalletFilter", () => {
    expect(buildWalletLifecycleFilter("active", APPLE_ONLY)).toEqual(buildActiveWalletFilter(APPLE_ONLY));
  });

  it("'removed' is ever-installed AND NOT active", () => {
    expect(buildWalletLifecycleFilter("removed", APPLE_ONLY)).toEqual({
      AND: [buildEverInstalledWalletFilter(), { NOT: buildActiveWalletFilter(APPLE_ONLY) }],
    });
  });

  it("'never_installed' is NOT ever-installed, regardless of enabled platforms", () => {
    expect(buildWalletLifecycleFilter("never_installed", NONE_ENABLED)).toEqual({
      NOT: buildEverInstalledWalletFilter(),
    });
  });
});
