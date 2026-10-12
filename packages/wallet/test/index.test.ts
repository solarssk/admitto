import { describe, expect, it } from "vitest";
import { WalletProviderError, walletFailureCode } from "../src/index.js";
import { createStubWalletProvider } from "./stub-provider.js";

describe("@admitto/wallet", () => {
  it("allows only fixed failure codes in operational logs and erasure summaries", () => {
    expect(walletFailureCode(new WalletProviderError("wallet_provider_timeout", "private@example.com"))).toBe("wallet_provider_timeout");
    expect(walletFailureCode({ code: "wallet_provider_duplicate" })).toBe("wallet_provider_duplicate");
    for (const error of [null, "private@example.com", new Error("private@example.com"), { code: "private@example.com" }, { code: 401 }]) {
      expect(walletFailureCode(error)).toBe("unknown");
    }
  });

  it("exports WalletProviderError as a typed, coded error", () => {
    const error = new WalletProviderError("wallet_provider_rejected", "test");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("wallet_provider_rejected");
  });

  it("stub provider satisfies the WalletPassProvider contract", async () => {
    const provider = createStubWalletProvider();
    const created = await provider.createPass({
      attendeeName: "Jane Doe",
      eventDateLabel: "12 August 2026",
      eventDateShortLabel: "12 Aug 2026",
      ticketTypeLabel: "General",
      ticketStatusLabel: "Valid",
      customFieldLabels: {},
      userProvidedId: "admitto:event1:attendee1",
      barcodeValue: "https://tickets.example.com/t/tok-jane",
    });
    expect(created.providerPassId).toBe("stub-admitto:event1:attendee1");

    const found = await provider.findByUserProvidedId("admitto:event1:attendee1");
    expect(found?.providerPassId).toBe(created.providerPassId);

    const notFound = await provider.findByUserProvidedId("admitto:event1:missing");
    expect(notFound).toBeNull();

    const snapshot = await provider.getPassSnapshot({
      providerPassId: created.providerPassId,
      userProvidedId: "admitto:event1:attendee1",
    });
    expect(snapshot?.validity.voided).toBe(false);
    expect(snapshot?.registrations?.appleActive).toBe(0);
    expect(
      await provider.getPassSnapshot({ providerPassId: "stub-missing", userProvidedId: "admitto:event1:missing" }),
    ).toBeNull();
  });
});
