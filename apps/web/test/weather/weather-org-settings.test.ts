import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { encryptToString } from "@admitto/crypto";
import {
  describeWeatherSettings,
  patchWeatherSettings,
  resolveEffectiveWeatherConfig,
  createWeatherServiceFromDb,
  WEATHER_SETTINGS_KEY,
} from "../../src/weather/weather-org-settings.js";
import {
  isGeocodingContactConfigured,
  buildGeocodingUserAgent,
} from "../../src/maps/user-agent.js";

vi.mock("../../src/maps/user-agent.js", () => ({
  isGeocodingContactConfigured: vi.fn(async () => true),
  buildGeocodingUserAgent: vi.fn(async () => "Admitto/test (test@example.com)"),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeWeatherDb(storedJson: string | null = null): PrismaClient {
  let row =
    storedJson == null ? null : { key: WEATHER_SETTINGS_KEY, value_json: storedJson };
  return {
    systemSettings: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async ({ create, update }: { create: { value_json: string }; update: { value_json: string } }) => {
        row = {
          key: WEATHER_SETTINGS_KEY,
          value_json: row ? update.value_json : create.value_json,
        };
        return row;
      }),
    },
  } as unknown as PrismaClient;
}

describe("resolveEffectiveWeatherConfig", () => {
  it("returns built-in MET Norway defaults when no row exists", async () => {
    const cfg = await resolveEffectiveWeatherConfig(fakeWeatherDb(null), {});
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe("metno");
  });

  it("applies stored Open-Meteo overrides including decrypted API key", async () => {
    const enc = encryptToString("org-secret");
    const cfg = await resolveEffectiveWeatherConfig(
      fakeWeatherDb(
        JSON.stringify({
          enabled: true,
          provider: "openmeteo",
          baseUrl: "https://customer-api.open-meteo.com",
          apiKeyEnc: enc,
        }),
      ),
      {},
    );
    expect(cfg.provider).toBe("openmeteo");
    expect(cfg.baseUrl).toBe("https://customer-api.open-meteo.com");
    expect(cfg.apiKey).toBe("org-secret");
  });

  it("infers openmeteo from legacy blobs with baseUrl but no provider", async () => {
    const cfg = await resolveEffectiveWeatherConfig(
      fakeWeatherDb(JSON.stringify({ baseUrl: "https://api.open-meteo.com" })),
      {},
    );
    expect(cfg.provider).toBe("openmeteo");
  });

  it("returns null-ish overrides for corrupt JSON without throwing", async () => {
    const db = {
      systemSettings: {
        findUnique: vi.fn(async () => ({
          key: WEATHER_SETTINGS_KEY,
          value_json: "{not-json",
        })),
      },
    } as unknown as PrismaClient;
    const cfg = await resolveEffectiveWeatherConfig(db, {});
    expect(cfg.provider).toBe("metno");
  });

  it("treats undecryptable apiKeyEnc as no key", async () => {
    const cfg = await resolveEffectiveWeatherConfig(
      fakeWeatherDb(
        JSON.stringify({
          provider: "openmeteo",
          apiKeyEnc: "not-a-valid-encrypted-blob",
        }),
      ),
      {},
    );
    expect(cfg.apiKey).toBeNull();
  });

  it("ignores non-object stored JSON shapes", async () => {
    const cfg = await resolveEffectiveWeatherConfig(
      fakeWeatherDb(JSON.stringify([1, 2, 3])),
      {},
    );
    expect(cfg.provider).toBe("metno");
  });
});

describe("createWeatherServiceFromDb", () => {
  it("builds a service with Support contact User-Agent when configured", async () => {
    vi.mocked(isGeocodingContactConfigured).mockClear();
    vi.mocked(buildGeocodingUserAgent).mockClear();
    vi.mocked(isGeocodingContactConfigured).mockResolvedValueOnce(true);
    vi.mocked(buildGeocodingUserAgent).mockResolvedValueOnce("Admitto/test (x@example.com)");
    const service = await createWeatherServiceFromDb(fakeWeatherDb(null), { NODE_ENV: "test" });
    expect(service.enabled).toBe(true);
    expect(service.configSnapshot.provider).toBe("metno");
    expect(buildGeocodingUserAgent).toHaveBeenCalled();
  });

  it("passes a null User-Agent when Support contact is missing", async () => {
    vi.mocked(isGeocodingContactConfigured).mockClear();
    vi.mocked(buildGeocodingUserAgent).mockClear();
    vi.mocked(isGeocodingContactConfigured).mockResolvedValueOnce(false);
    const service = await createWeatherServiceFromDb(fakeWeatherDb(null), { NODE_ENV: "test" });
    expect(buildGeocodingUserAgent).not.toHaveBeenCalled();
    expect(service.configSnapshot.provider).toBe("metno");
  });
});

describe("describeWeatherSettings", () => {
  it("never exposes the cleartext API key", async () => {
    const enc = encryptToString("org-secret");
    const described = await describeWeatherSettings(
      fakeWeatherDb(
        JSON.stringify({
          provider: "openmeteo",
          apiKeyEnc: enc,
        }),
      ),
      {},
    );
    expect(described.apiKey).toEqual({ configured: true, source: "organization" });
    expect(JSON.stringify(described)).not.toContain("org-secret");
  });
});

describe("patchWeatherSettings", () => {
  it("persists provider and clears blank baseUrl to null", async () => {
    const db = fakeWeatherDb(JSON.stringify({ provider: "metno" }));
    const described = await patchWeatherSettings(db, {
      provider: "openmeteo",
      baseUrl: "   ",
      enabled: true,
    });
    expect(described.provider).toBe("openmeteo");
    const upsert = vi.mocked(db.systemSettings.upsert);
    expect(upsert).toHaveBeenCalled();
    const payload = JSON.parse(
      (upsert.mock.calls[0]![0] as { update: { value_json: string } }).update.value_json,
    ) as { baseUrl: string | null; provider: string };
    expect(payload.baseUrl).toBeNull();
    expect(payload.provider).toBe("openmeteo");
  });

  it("encrypts a new API key and can clear it", async () => {
    const db = fakeWeatherDb(null);
    await patchWeatherSettings(db, { apiKey: "new-key", provider: "openmeteo" });
    let stored = JSON.parse(
      (vi.mocked(db.systemSettings.upsert).mock.calls.at(-1)![0] as {
        update: { value_json: string };
      }).update.value_json,
    ) as { apiKeyEnc: string | null };
    expect(stored.apiKeyEnc).toBeTruthy();
    expect(stored.apiKeyEnc).not.toBe("new-key");

    await patchWeatherSettings(db, { apiKey: "" });
    stored = JSON.parse(
      (vi.mocked(db.systemSettings.upsert).mock.calls.at(-1)![0] as {
        update: { value_json: string };
      }).update.value_json,
    ) as { apiKeyEnc: string | null };
    expect(stored.apiKeyEnc).toBeNull();
  });
});
