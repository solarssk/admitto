/**
 * Organisation Settings → External services (ADR 0040).
 * Weather + Maps are editable from the UI (SystemSettings). Superadmin-only; secrets
 * never returned in clear text.
 */

import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { canManageInstance } from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { z } from "zod";
import {
  describeWeatherSettings,
  patchWeatherSettings,
  resolveEffectiveWeatherConfig,
} from "../weather/weather-org-settings.js";
import {
  mergeWeatherConfig,
  weatherApiKeyRequired,
} from "../weather/config.js";
import { WeatherService } from "../weather/weather-service.js";
import {
  describeMapsSettings,
  patchMapsSettings,
  refreshMapsConfigCache,
} from "../maps/maps-org-settings.js";
import { isStaffSpaCompatibleTileUrl, resolveGeocodingConfig } from "../maps/config.js";
import {
  buildGeocodingUserAgent,
  isGeocodingContactConfigured,
} from "../maps/user-agent.js";
import { NominatimProvider } from "../maps/nominatim-provider.js";
import { adminAuditFromContext } from "./admin-helpers.js";

const weatherPatchSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["openmeteo", "metno"]).optional(),
  baseUrl: z.string().max(2048).nullable().optional(),
  apiKey: z.string().max(512).nullable().optional(),
});

const mapsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  tileUrl: z.string().max(2048).nullable().optional(),
  attribution: z.string().max(2048).nullable().optional(),
  maxZoom: z.number().int().min(1).max(22).nullable().optional(),
  geocodingProvider: z.string().max(64).nullable().optional(),
  geocodingBaseUrl: z.string().max(2048).nullable().optional(),
});

/** Draft probe body (no persist). Empty apiKey keeps the stored organisation key. */
const weatherTestSchema = z.object({
  provider: z.enum(["openmeteo", "metno"]),
  baseUrl: z.string().max(2048).optional(),
  apiKey: z.string().max(512).optional(),
  clearApiKey: z.boolean().optional(),
});

const mapsTestSchema = z.object({
  geocodingBaseUrl: z.string().max(2048),
});

const WEATHER_PROBE_OK = "Connected. Weather provider reachable";
const WEATHER_PROBE_FAIL = "Could not reach the weather provider.";
const WEATHER_PROBE_CONTACT =
  "Support contact is required for MET Norway (User-Agent).";
const WEATHER_PROBE_API_KEY = "API key is required for this Open-Meteo host.";
const MAPS_PROBE_OK = "Connected. Nominatim reachable";
const MAPS_PROBE_FAIL = "Could not reach Nominatim.";
const MAPS_PROBE_CONTACT =
  "Support contact is required for Nominatim (User-Agent).";
const MAPS_PROBE_INVALID_URL = "Geocoding base URL must be a valid http(s) URL.";

function serializeWeather(weather: Awaited<ReturnType<typeof describeWeatherSettings>>) {
  return {
    enabled: weather.enabled,
    provider: weather.provider,
    base_url: weather.baseUrl,
    api_key: weather.apiKey,
    attribution: weather.attribution,
    attribution_url: weather.attributionUrl,
    commercial_notice: weather.commercialNotice,
    horizon_days: weather.horizonDays,
    contact_configured: weather.contactConfigured,
  };
}

function serializeMaps(maps: Awaited<ReturnType<typeof describeMapsSettings>>) {
  return {
    enabled: maps.enabled,
    tile_url: maps.tileUrl,
    attribution: maps.attribution,
    max_zoom: maps.maxZoom,
    geocoding_provider: maps.geocodingProvider,
    geocoding_base_url: maps.geocodingBaseUrl,
  };
}

function validateHttpsOrHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** GET /api/admin/external-services — weather + maps for External services tab. */
export async function handleGetExternalServices(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  await refreshMapsConfigCache(db);
  const [weather, maps] = await Promise.all([
    describeWeatherSettings(db),
    describeMapsSettings(db),
  ]);

  return c.json({
    weather: serializeWeather(weather),
    maps: serializeMaps(maps),
  });
}

/** PUT /api/admin/external-services/weather */
export async function handlePutWeatherSettings(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = weatherPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }

  if (parsed.data.baseUrl != null && parsed.data.baseUrl.trim() !== "") {
    if (!validateHttpsOrHttpUrl(parsed.data.baseUrl)) {
      return c.json({ error: "invalid_base_url" }, 400);
    }
  }

  // Resolve what the post-patch config would look like for commercial-host key checks.
  const current = await describeWeatherSettings(db);
  const nextEnabled = parsed.data.enabled ?? current.enabled;
  const nextProvider = parsed.data.provider ?? current.provider;
  const nextBaseUrl =
    parsed.data.baseUrl !== undefined
      ? (parsed.data.baseUrl?.trim() || current.baseUrl)
      : current.baseUrl;
  const clearingKey =
    parsed.data.apiKey !== undefined &&
    (parsed.data.apiKey == null || parsed.data.apiKey.trim() === "");
  const nextKeyConfigured =
    parsed.data.apiKey !== undefined
      ? !clearingKey && Boolean(parsed.data.apiKey?.trim())
      : current.apiKey.configured;

  if (weatherApiKeyRequired(nextProvider, nextBaseUrl, nextEnabled) && !nextKeyConfigured) {
    return c.json({ error: "api_key_required" }, 400);
  }

  const described = await patchWeatherSettings(db, {
    enabled: parsed.data.enabled,
    provider: parsed.data.provider,
    baseUrl: parsed.data.baseUrl,
    apiKey: parsed.data.apiKey,
  });

  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "weather_settings_updated",
    metadata: {
      enabled: described.enabled,
      provider: described.provider,
      base_url_set: Boolean(described.baseUrl),
      api_key_configured: described.apiKey.configured,
    },
  });

  return c.json({ weather: serializeWeather(described) });
}

/** PUT /api/admin/external-services/maps */
export async function handlePutMapsSettings(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = mapsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }

  if (parsed.data.tileUrl != null && parsed.data.tileUrl.trim() !== "") {
    if (!isStaffSpaCompatibleTileUrl(parsed.data.tileUrl.trim())) {
      return c.json({ error: "invalid_tile_url" }, 400);
    }
  }
  if (parsed.data.geocodingBaseUrl != null && parsed.data.geocodingBaseUrl.trim() !== "") {
    if (!validateHttpsOrHttpUrl(parsed.data.geocodingBaseUrl)) {
      return c.json({ error: "invalid_geocoding_base_url" }, 400);
    }
  }

  const described = await patchMapsSettings(db, {
    enabled: parsed.data.enabled,
    tileUrl: parsed.data.tileUrl,
    attribution: parsed.data.attribution,
    maxZoom: parsed.data.maxZoom,
    geocodingProvider: parsed.data.geocodingProvider,
    geocodingBaseUrl: parsed.data.geocodingBaseUrl,
  });

  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "maps_settings_updated",
    metadata: {
      enabled: described.enabled,
      tile_url_set: Boolean(described.tileUrl),
      geocoding_provider: described.geocodingProvider,
    },
  });

  return c.json({ maps: serializeMaps(described) });
}

/**
 * POST /api/admin/external-services/weather/test
 * Probe the weather provider from a draft body (no persist). Empty apiKey keeps the stored key.
 */
export async function handlePostWeatherTest(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = weatherTestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }

  const draft = parsed.data;
  if (draft.baseUrl != null && draft.baseUrl.trim() !== "") {
    if (!validateHttpsOrHttpUrl(draft.baseUrl)) {
      return c.json({ ok: false, error: "invalid_base_url" });
    }
  }

  const effective = await resolveEffectiveWeatherConfig(db);
  let apiKeyOverride: string | null | undefined;
  if (draft.clearApiKey) {
    apiKeyOverride = null;
  } else if (draft.apiKey !== undefined && draft.apiKey.trim() !== "") {
    apiKeyOverride = draft.apiKey.trim();
  }

  const config = mergeWeatherConfig(effective, {
    provider: draft.provider,
    ...(draft.baseUrl !== undefined ? { baseUrl: draft.baseUrl.trim() || null } : {}),
    ...(apiKeyOverride !== undefined ? { apiKey: apiKeyOverride } : {}),
  });

  if (weatherApiKeyRequired(config.provider, config.baseUrl, true) && !config.apiKey) {
    return c.json({ ok: false, error: WEATHER_PROBE_API_KEY });
  }

  const contactConfigured = await isGeocodingContactConfigured(db);
  const userAgent = contactConfigured ? await buildGeocodingUserAgent(db) : null;
  const service = new WeatherService({
    config,
    userAgent,
    contactConfigured,
  });
  const probe = await service.probeLive();

  if (!probe.ok) {
    const error =
      probe.error === "support_contact_required"
        ? WEATHER_PROBE_CONTACT
        : WEATHER_PROBE_FAIL;
    return c.json({ ok: false, error, latency_ms: probe.latencyMs });
  }

  return c.json({
    ok: true,
    message: `${WEATHER_PROBE_OK} (${probe.latencyMs} ms).`,
    latency_ms: probe.latencyMs,
  });
}

/**
 * POST /api/admin/external-services/maps/test
 * Probe Nominatim from a draft geocoding base URL (no persist).
 */
export async function handlePostMapsTest(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = mapsTestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }

  const baseUrl = parsed.data.geocodingBaseUrl.trim().replace(/\/$/, "");
  if (!baseUrl || !validateHttpsOrHttpUrl(baseUrl)) {
    return c.json({ ok: false, error: MAPS_PROBE_INVALID_URL });
  }

  const contactConfigured = await isGeocodingContactConfigured(db);
  if (!contactConfigured) {
    return c.json({ ok: false, error: MAPS_PROBE_CONTACT });
  }

  const timeoutMs = resolveGeocodingConfig().timeoutMs;
  const provider = new NominatimProvider({
    baseUrl,
    timeoutMs,
    buildUserAgent: () => buildGeocodingUserAgent(db),
    minIntervalMs: 0,
  });

  const started = Date.now();
  try {
    await provider.search("Warsaw");
    const latencyMs = Date.now() - started;
    return c.json({
      ok: true,
      message: `${MAPS_PROBE_OK} (${latencyMs} ms).`,
      latency_ms: latencyMs,
    });
  } catch {
    return c.json({
      ok: false,
      error: MAPS_PROBE_FAIL,
      latency_ms: Date.now() - started,
    });
  }
}
