import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { encryptToString } from "@admitto/crypto";
import {
  describeWalletSettings,
  patchWalletSettings,
  resolveWalletApiKey,
  WALLET_SETTINGS_KEY,
} from "../../src/wallet/wallet-org-settings.js";

function fakeWalletDb(storedJson: string | null = null): PrismaClient {
  let row = storedJson == null ? null : { key: WALLET_SETTINGS_KEY, value_json: storedJson };
  return {
    systemSettings: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async ({ create, update }: { create: { value_json: string }; update: { value_json: string } }) => {
        row = { key: WALLET_SETTINGS_KEY, value_json: row ? update.value_json : create.value_json };
        return row;
      }),
    },
  } as unknown as PrismaClient;
}

describe("resolveWalletApiKey", () => {
  it("returns null when nothing is stored and no env key is set", async () => {
    const key = await resolveWalletApiKey(fakeWalletDb(null), {});
    expect(key).toBeNull();
  });

  it("reads PASSCREATOR_API_KEY from env even without PASSCREATOR_TEMPLATE_ID set", async () => {
    // Regression: resolvePassCreatorConfig() (config.ts) requires both vars together for the
    // legacy combined config - this module must resolve the key independently, since template ID
    // now lives per-event (Event.wallet_template_id), not in a matching env var.
    const key = await resolveWalletApiKey(fakeWalletDb(null), { PASSCREATOR_API_KEY: "env-key" });
    expect(key).toBe("env-key");
  });

  it("prefers the stored organisation key over the env var", async () => {
    const enc = encryptToString("org-secret");
    const key = await resolveWalletApiKey(
      fakeWalletDb(JSON.stringify({ apiKeyEnc: enc })),
      { PASSCREATOR_API_KEY: "env-key" },
    );
    expect(key).toBe("org-secret");
  });

  it("returns null for an undecryptable stored key instead of throwing", async () => {
    const key = await resolveWalletApiKey(
      fakeWalletDb(JSON.stringify({ apiKeyEnc: "not-a-valid-encrypted-blob" })),
      {},
    );
    expect(key).toBeNull();
  });
});

describe("describeWalletSettings", () => {
  it("reports source: none when nothing is configured", async () => {
    const described = await describeWalletSettings(fakeWalletDb(null), {});
    expect(described.apiKey).toEqual({ configured: false, source: "none" });
  });

  it("reports source: env for an env-only key, without PASSCREATOR_TEMPLATE_ID set", async () => {
    const described = await describeWalletSettings(fakeWalletDb(null), {
      PASSCREATOR_API_KEY: "env-key",
    });
    expect(described.apiKey).toEqual({ configured: true, source: "env" });
  });

  it("reports source: organization and never exposes the cleartext key", async () => {
    const enc = encryptToString("org-secret");
    const described = await describeWalletSettings(fakeWalletDb(JSON.stringify({ apiKeyEnc: enc })), {});
    expect(described.apiKey).toEqual({ configured: true, source: "organization" });
    expect(JSON.stringify(described)).not.toContain("org-secret");
  });
});

describe("patchWalletSettings", () => {
  it("encrypts a new API key and can clear it", async () => {
    const db = fakeWalletDb(null);
    await patchWalletSettings(db, { apiKey: "new-key" });
    let stored = JSON.parse(
      (vi.mocked(db.systemSettings.upsert).mock.calls.at(-1)![0] as {
        update: { value_json: string };
      }).update.value_json,
    ) as { apiKeyEnc: string | null };
    expect(stored.apiKeyEnc).toBeTruthy();
    expect(stored.apiKeyEnc).not.toBe("new-key");

    await patchWalletSettings(db, { apiKey: "" });
    stored = JSON.parse(
      (vi.mocked(db.systemSettings.upsert).mock.calls.at(-1)![0] as {
        update: { value_json: string };
      }).update.value_json,
    ) as { apiKeyEnc: string | null };
    expect(stored.apiKeyEnc).toBeNull();
  });
});
