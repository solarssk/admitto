/**
 * Org-level weather settings stored in SystemSettings (ADR 0040).
 * Precedence: UI row (when present) > built-in defaults.
 * Providers: metno (default) | openmeteo.
 */

import type { PrismaClient } from "@admitto/db";
import { decryptFromString, encryptToString } from "@admitto/crypto";
import {
  attributionForProvider,
  defaultWeatherConfig,
  forecastHorizonDays,
  isWeatherProviderId,
  mergeWeatherConfig,
  type WeatherConfig,
  type WeatherConfigOverrides,
  type WeatherProviderId,
} from "./config.js";
import { WeatherService } from "./weather-service.js";
import { createWeatherCache } from "./weather-cache.js";
import {
  buildGeocodingUserAgent,
  isGeocodingContactConfigured,
} from "../maps/user-agent.js";

/** SystemSettings.key - JSON blob, not registered in SETTING_ENV_LOCKS. */
export const WEATHER_SETTINGS_KEY = "weather_settings";

export interface WeatherSettingsStored {
  enabled?: boolean;
  /** openmeteo | metno. Omitted on legacy blobs → inferred (see parseStored). */
  provider?: WeatherProviderId;
  /** Empty / omit → built-in Open-Meteo host (only used when provider is openmeteo). */
  baseUrl?: string | null;
  /** Encrypted API key; null clears; omit keeps previous on patch. */
  apiKeyEnc?: string | null;
}

export interface WeatherSettingsPublic {
  enabled: boolean;
  provider: WeatherProviderId;
  baseUrl: string;
  apiKey: { configured: boolean; source: "organization" | "none" };
  attribution: string;
  attributionUrl: string;
  commercialNotice: string;
  /** Forecast horizon in days for the active provider (inclusive of today). */
  horizonDays: number;
  /** Support contact present (required User-Agent for MET Norway). */
  contactConfigured: boolean;
}

function parseStored(raw: unknown): WeatherSettingsStored | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: WeatherSettingsStored = {};
  if (typeof o.enabled === "boolean") out.enabled = o.enabled;
  if (isWeatherProviderId(o.provider)) {
    out.provider = o.provider;
  } else if (
    // Legacy Open-Meteo-only blobs: base URL or key implies openmeteo.
    (typeof o.baseUrl === "string" && o.baseUrl.trim() !== "") ||
    (typeof o.apiKeyEnc === "string" && o.apiKeyEnc !== "")
  ) {
    out.provider = "openmeteo";
  }
  if (o.baseUrl === null) out.baseUrl = null;
  else if (typeof o.baseUrl === "string") out.baseUrl = o.baseUrl;
  if (o.apiKeyEnc === null) out.apiKeyEnc = null;
  else if (typeof o.apiKeyEnc === "string") out.apiKeyEnc = o.apiKeyEnc;
  return out;
}

async function readStored(db: PrismaClient): Promise<WeatherSettingsStored | null> {
  try {
    const row = await db.systemSettings.findUnique({ where: { key: WEATHER_SETTINGS_KEY } });
    if (!row) return null;
    try {
      return parseStored(JSON.parse(row.value_json) as unknown);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function overridesFromStored(stored: WeatherSettingsStored | null): WeatherConfigOverrides | null {
  if (!stored) return null;
  const overrides: WeatherConfigOverrides = {};
  if (stored.enabled !== undefined) overrides.enabled = stored.enabled;
  if (stored.provider !== undefined) overrides.provider = stored.provider;
  if (stored.baseUrl !== undefined) {
    overrides.baseUrl = stored.baseUrl?.trim() || null;
  }
  if (stored.apiKeyEnc !== undefined) {
    if (stored.apiKeyEnc == null || stored.apiKeyEnc === "") {
      overrides.apiKey = null;
    } else {
      try {
        overrides.apiKey = decryptFromString(stored.apiKeyEnc);
      } catch {
        overrides.apiKey = null;
      }
    }
  }
  return overrides;
}

export async function resolveEffectiveWeatherConfig(
  db: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<WeatherConfig> {
  const base = defaultWeatherConfig(env);
  const stored = await readStored(db);
  return mergeWeatherConfig(base, overridesFromStored(stored));
}

export async function createWeatherServiceFromDb(
  db: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<WeatherService> {
  const config = await resolveEffectiveWeatherConfig(db, env);
  const contactConfigured = await isGeocodingContactConfigured(db, env);
  const userAgent = contactConfigured ? await buildGeocodingUserAgent(db, env) : null;
  return new WeatherService({
    config,
    cache: createWeatherCache(env),
    userAgent,
    contactConfigured,
  });
}

export async function describeWeatherSettings(
  db: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<WeatherSettingsPublic> {
  const effective = await resolveEffectiveWeatherConfig(db, env);
  const stored = await readStored(db);
  const apiKeySource: WeatherSettingsPublic["apiKey"]["source"] = stored?.apiKeyEnc
    ? "organization"
    : "none";
  const attr = attributionForProvider(effective.provider);
  const contactConfigured = await isGeocodingContactConfigured(db, env);

  return {
    enabled: effective.enabled,
    provider: effective.provider,
    baseUrl: effective.baseUrl,
    apiKey: {
      configured: Boolean(effective.apiKey),
      source: apiKeySource,
    },
    attribution: attr.attribution,
    attributionUrl: attr.attributionUrl,
    commercialNotice:
      "The free Open-Meteo host is for non-commercial use. Commercial or SaaS deployments need a customer API key, a self-hosted Open-Meteo base URL, MET Norway, or weather disabled.",
    horizonDays: forecastHorizonDays(effective.provider),
    contactConfigured,
  };
}

export interface WeatherSettingsPatch {
  enabled?: boolean;
  provider?: WeatherProviderId;
  baseUrl?: string | null;
  /** Omit to keep; empty string clears the organisation key. */
  apiKey?: string | null;
}

export async function patchWeatherSettings(
  db: PrismaClient,
  patch: WeatherSettingsPatch,
): Promise<WeatherSettingsPublic> {
  const current = (await readStored(db)) ?? {};
  const next: WeatherSettingsStored = { ...current };

  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.provider !== undefined) next.provider = patch.provider;
  if (patch.baseUrl !== undefined) {
    const trimmed = patch.baseUrl?.trim() || null;
    next.baseUrl = trimmed;
  }
  if (patch.apiKey !== undefined) {
    if (patch.apiKey == null || patch.apiKey.trim() === "") {
      next.apiKeyEnc = null;
    } else {
      next.apiKeyEnc = encryptToString(patch.apiKey.trim());
    }
  }

  await db.systemSettings.upsert({
    where: { key: WEATHER_SETTINGS_KEY },
    create: { key: WEATHER_SETTINGS_KEY, value_json: JSON.stringify(next) },
    update: { value_json: JSON.stringify(next) },
  });

  return describeWeatherSettings(db);
}
