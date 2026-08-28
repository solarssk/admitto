import { describe, expect, it } from "vitest";
import { enabledWalletPlatforms } from "../src/walletPlatforms.js";

describe("enabledWalletPlatforms", () => {
  it("enables every platform when the master switch and all toggles are on", () => {
    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: true,
        wallet_google_enabled: true,
        wallet_samsung_enabled: true,
      }),
    ).toEqual({ apple: true, google: true, samsung: true, any: true });
  });

  it("disables everything when the master switch is off, regardless of the per-platform toggles", () => {
    expect(
      enabledWalletPlatforms({
        wallet_enabled: false,
        wallet_apple_enabled: true,
        wallet_google_enabled: true,
        wallet_samsung_enabled: true,
      }),
    ).toEqual({ apple: false, google: false, samsung: false, any: false });
  });

  it("reflects only the enabled platform when the master switch is on but one toggle is off", () => {
    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: true,
        wallet_google_enabled: false,
        wallet_samsung_enabled: false,
      }),
    ).toEqual({ apple: true, google: false, samsung: false, any: true });

    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: false,
        wallet_google_enabled: true,
        wallet_samsung_enabled: false,
      }),
    ).toEqual({ apple: false, google: true, samsung: false, any: true });
  });

  it("is not any when the master switch is on but every platform toggle is off", () => {
    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: false,
        wallet_google_enabled: false,
        wallet_samsung_enabled: false,
      }),
    ).toEqual({ apple: false, google: false, samsung: false, any: false });
  });

  it("resolves samsung independently of apple/google, and never counts it toward any", () => {
    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: false,
        wallet_google_enabled: false,
        wallet_samsung_enabled: true,
      }),
    ).toEqual({ apple: false, google: false, samsung: true, any: false });

    expect(
      enabledWalletPlatforms({
        wallet_enabled: true,
        wallet_apple_enabled: true,
        wallet_google_enabled: true,
        wallet_samsung_enabled: false,
      }),
    ).toEqual({ apple: true, google: true, samsung: false, any: true });
  });
});
