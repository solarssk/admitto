import { describe, expect, it } from "vitest";
import { enabledWalletPlatforms } from "../src/walletPlatforms.js";

describe("enabledWalletPlatforms", () => {
  it("enables both platforms when the master switch and both toggles are on", () => {
    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: true,
        wallet_google_enabled: true,
      }),
    ).toEqual({ apple: true, google: true, any: true });
  });

  it("disables everything when the master switch is off, regardless of the per-platform toggles", () => {
    expect(
      enabledWalletPlatforms({
        wallet_enabled: false,
        wallet_apple_enabled: true,
        wallet_google_enabled: true,
      }),
    ).toEqual({ apple: false, google: false, any: false });
  });

  it("reflects only the enabled platform when the master switch is on but one toggle is off", () => {
    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: true,
        wallet_google_enabled: false,
      }),
    ).toEqual({ apple: true, google: false, any: true });

    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: false,
        wallet_google_enabled: true,
      }),
    ).toEqual({ apple: false, google: true, any: true });
  });

  it("is not any when the master switch is on but both platform toggles are off", () => {
    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: false,
        wallet_google_enabled: false,
      }),
    ).toEqual({ apple: false, google: false, any: false });
  });
});
