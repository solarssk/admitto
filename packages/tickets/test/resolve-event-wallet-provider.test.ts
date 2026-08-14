import { describe, expect, it, vi } from "vitest";

vi.mock("@admitto/wallet", () => ({ resolveWalletProvider: vi.fn() }));

import { resolveWalletProvider } from "@admitto/wallet";
import { resolveEventWalletProvider } from "../src/resolve-event-wallet-provider.js";

const fakeProvider = { provider: "stub" };

describe("resolveEventWalletProvider", () => {
  it("loads the event's wallet config and resolves a provider from it", async () => {
    vi.mocked(resolveWalletProvider).mockReset().mockReturnValue(fakeProvider as never);
    const db = {
      event: {
        findUnique: vi.fn().mockResolvedValue({
          wallet_enabled: true,
          wallet_template_id: "tmpl-1",
          wallet_api_key_enc: "enc",
          wallet_field_mapping: null,
        }),
      },
    };

    const result = await resolveEventWalletProvider(db as never, "evt-1");

    expect(db.event.findUnique).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      select: {
        wallet_enabled: true,
        wallet_template_id: true,
        wallet_api_key_enc: true,
        wallet_field_mapping: true,
      },
    });
    expect(resolveWalletProvider).toHaveBeenCalledWith({
      walletEnabled: true,
      walletTemplateId: "tmpl-1",
      walletApiKeyEnc: "enc",
      walletFieldMapping: null,
    });
    expect(result).toBe(fakeProvider);
  });

  it("returns null without calling resolveWalletProvider when the event doesn't exist", async () => {
    vi.mocked(resolveWalletProvider).mockReset();
    const db = { event: { findUnique: vi.fn().mockResolvedValue(null) } };

    const result = await resolveEventWalletProvider(db as never, "evt-gone");

    expect(result).toBeNull();
    expect(resolveWalletProvider).not.toHaveBeenCalled();
  });
});
