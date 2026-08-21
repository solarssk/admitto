import { describe, expect, it } from "vitest";
import { WalletProviderError } from "../src/index.js";
import { createStubWalletProvider } from "./stub-provider.js";

describe("@admitto/wallet", () => {
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
      userProvidedId: "admitto:event1:attendee1",
      barcodeValue: "https://tickets.example.com/t/tok-jane",
    });
    expect(created.providerPassId).toBe("stub-admitto:event1:attendee1");

    const found = await provider.findByUserProvidedId("admitto:event1:attendee1");
    expect(found?.providerPassId).toBe(created.providerPassId);

    const notFound = await provider.findByUserProvidedId("admitto:event1:missing");
    expect(notFound).toBeNull();
  });
});
