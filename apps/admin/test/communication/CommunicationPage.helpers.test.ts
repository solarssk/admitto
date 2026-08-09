import { describe, expect, it } from "vitest";
import { bodyPlaceholderInsert, walletButtonMarkup } from "../../src/pages/CommunicationPage.js";

describe("walletButtonMarkup", () => {
  it("builds MJML and HTML badge buttons for known wallet placeholders", () => {
    expect(walletButtonMarkup("apple_wallet_url", "mjml")).toContain('href="{{apple_wallet_url}}"');
    expect(walletButtonMarkup("apple_wallet_url", "mjml")).toContain("/assets/apple-wallet-badge.svg");
    expect(walletButtonMarkup("apple_wallet_url", "html")).toContain("<a href=\"{{apple_wallet_url}}\">");
    expect(walletButtonMarkup("google_wallet_url", "mjml")).toContain("mj-image");
    expect(walletButtonMarkup("google_wallet_url", "html")).toContain("<a href=\"{{google_wallet_url}}\">");
    expect(walletButtonMarkup("google_wallet_url", "html")).toContain("/assets/google-wallet-badge.svg");
  });

  it("falls back to a bare token when the wallet name has no badge asset", () => {
    expect(walletButtonMarkup("unknown_wallet_url", "html")).toBe("{{unknown_wallet_url}}");
  });
});

describe("bodyPlaceholderInsert", () => {
  it("inserts image markup, wallet badges, or bare tokens by placeholder kind", () => {
    expect(bodyPlaceholderInsert("logo_url", "html", ["logo_url"])).toContain("<img");
    expect(bodyPlaceholderInsert("apple_wallet_url", "mjml", [])).toContain("mj-image");
    expect(bodyPlaceholderInsert("first_name", "html", [])).toBe("{{first_name}}");
  });
});
