import { afterEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { resolveWalletProvider } from "../src/resolve-provider.js";

function event(overrides: Partial<Parameters<typeof resolveWalletProvider>[0]> = {}) {
  return {
    walletEnabled: true,
    walletTemplateId: "tmpl-1",
    walletApiKeyEnc: "not-a-real-ciphertext",
    walletFieldMapping: null,
    ...overrides,
  };
}

afterEach(() => {
  resetSystemLogBufferForTest();
});

describe("resolveWalletProvider", () => {
  it("returns null and returns early without a template id or key", () => {
    expect(resolveWalletProvider(event({ walletTemplateId: null }))).toBeNull();
    expect(resolveWalletProvider(event({ walletApiKeyEnc: null }))).toBeNull();
    expect(resolveWalletProvider(event({ walletEnabled: false }))).toBeNull();
  });

  it("returns null and logs a wallet-source error when the stored key fails to decrypt", () => {
    // Not valid ciphertext for @admitto/crypto's decryptFromString - exercises the catch branch.
    const result = resolveWalletProvider(event());

    expect(result).toBeNull();
    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({ level: "error", message: "wallet_api_key_decrypt_failed" });
  });

  it("returns the injected provider without touching the key at all", () => {
    const injected = { createPass: vi.fn() } as never;
    expect(resolveWalletProvider(event({ walletApiKeyEnc: null }), injected)).toBe(injected);
    expect(querySystemLogs({ source: "wallet" })).toHaveLength(0);
  });
});
