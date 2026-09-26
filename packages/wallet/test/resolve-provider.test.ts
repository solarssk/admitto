import { afterEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

// The real decryptFromString needs ENCRYPTION_KEY; here it stands in for "the stored key is valid
// ciphertext" (returns a key) or "is not" (throws, its real behavior for garbage input).
const decrypt = vi.hoisted(() =>
  vi.fn((): string => {
    throw new Error("bad ciphertext");
  }),
);
vi.mock("@admitto/crypto", () => ({ decryptFromString: decrypt }));

import { PassCreatorClient } from "../src/passcreator-client.js";
import {
  canIssueWalletPass,
  resolveConfiguredWalletProvider,
  resolveWalletProvider,
} from "../src/resolve-provider.js";

function event(overrides: Partial<Parameters<typeof resolveWalletProvider>[0]> = {}) {
  return {
    walletEnabled: true,
    walletTemplateId: "tmpl-1",
    walletApiKeyEnc: "not-a-real-ciphertext",
    walletFieldMapping: null,
    ...overrides,
  };
}

function withValidKey() {
  decrypt.mockReturnValue("api-key");
}

afterEach(() => {
  decrypt.mockReset().mockImplementation(() => {
    throw new Error("bad ciphertext");
  });
  resetSystemLogBufferForTest();
});

describe("canIssueWalletPass", () => {
  it("is true only when the master switch is on and both a template and an API key are set", () => {
    expect(canIssueWalletPass(event())).toBe(true);
    expect(canIssueWalletPass(event({ walletEnabled: false }))).toBe(false);
    expect(canIssueWalletPass(event({ walletTemplateId: null }))).toBe(false);
    expect(canIssueWalletPass(event({ walletTemplateId: "" }))).toBe(false);
    expect(canIssueWalletPass(event({ walletApiKeyEnc: null }))).toBe(false);
  });

  it("does not decrypt anything", () => {
    canIssueWalletPass(event());
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe("resolveConfiguredWalletProvider", () => {
  it("builds the provider from the event's credentials even when the master switch is off", () => {
    withValidKey();
    const provider = resolveConfiguredWalletProvider(event({ walletEnabled: false }));

    expect(provider).toBeInstanceOf(PassCreatorClient);
    expect(decrypt).toHaveBeenCalledWith("not-a-real-ciphertext");
  });

  it("returns null without a template id or key", () => {
    expect(resolveConfiguredWalletProvider(event({ walletTemplateId: null }))).toBeNull();
    expect(resolveConfiguredWalletProvider(event({ walletApiKeyEnc: null }))).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("returns null and logs a wallet-source error when the stored key fails to decrypt", () => {
    const result = resolveConfiguredWalletProvider(event());

    expect(result).toBeNull();
    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({ level: "error", message: "wallet_api_key_decrypt_failed" });
  });

  it("returns the injected provider without touching the key at all", () => {
    const injected = { createPass: vi.fn() } as never;
    expect(resolveConfiguredWalletProvider(event({ walletApiKeyEnc: null }), injected)).toBe(injected);
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe("resolveWalletProvider", () => {
  it("returns null and returns early without a template id or key", () => {
    expect(resolveWalletProvider(event({ walletTemplateId: null }))).toBeNull();
    expect(resolveWalletProvider(event({ walletApiKeyEnc: null }))).toBeNull();
    expect(resolveWalletProvider(event({ walletEnabled: false }))).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("stays gated on the master switch even though the event is fully configured", () => {
    withValidKey();
    expect(resolveWalletProvider(event({ walletEnabled: false }))).toBeNull();
    expect(resolveWalletProvider(event())).toBeInstanceOf(PassCreatorClient);
  });

  it("returns null and logs a wallet-source error when the stored key fails to decrypt", () => {
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
