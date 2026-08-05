/**
 * Org-level maps / geocoding settings in SystemSettings.
 * Organisation Settings → External services is the operator source of truth.
 */

import type { PrismaClient } from "@admitto/db";
import {
  defaultGeocodingConfig,
  defaultMapTileConfig,
  getMapsConfigCache,
  isStaffSpaCompatibleTileUrl,
  setMapsConfigCache,
  type MapsRuntimeConfig,
} from "./config.js";

export type { GeocodingConfig, MapTileConfig } from "./config.js";

export const MAPS_SETTINGS_KEY = "maps_settings";

export interface MapsSettingsStored {
  enabled?: boolean;
  tileUrl?: string | null;
  attribution?: string | null;
  maxZoom?: number | null;
  geocodingProvider?: string | null;
  geocodingBaseUrl?: string | null;
}

export interface MapsSettingsPublic {
  enabled: boolean;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  geocodingProvider: string;
  geocodingBaseUrl: string;
}

export type MapsEffectiveConfig = MapsRuntimeConfig;

export interface MapsSettingsPatch {
  enabled?: boolean;
  tileUrl?: string | null;
  attribution?: string | null;
  maxZoom?: number | null;
  geocodingProvider?: string | null;
  geocodingBaseUrl?: string | null;
}

function parseStored(raw: unknown): MapsSettingsStored | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: MapsSettingsStored = {};
  if (typeof o.enabled === "boolean") out.enabled = o.enabled;
  if (o.tileUrl === null) out.tileUrl = null;
  else if (typeof o.tileUrl === "string") out.tileUrl = o.tileUrl;
  if (o.attribution === null) out.attribution = null;
  else if (typeof o.attribution === "string") out.attribution = o.attribution;
  if (o.maxZoom === null) out.maxZoom = null;
  else if (typeof o.maxZoom === "number" && Number.isFinite(o.maxZoom)) out.maxZoom = o.maxZoom;
  if (o.geocodingProvider === null) out.geocodingProvider = null;
  else if (typeof o.geocodingProvider === "string") out.geocodingProvider = o.geocodingProvider;
  if (o.geocodingBaseUrl === null) out.geocodingBaseUrl = null;
  else if (typeof o.geocodingBaseUrl === "string") out.geocodingBaseUrl = o.geocodingBaseUrl;
  return out;
}

/** Throws when the query fails. Returns null only for a missing or corrupt row. */
async function readStored(db: PrismaClient): Promise<MapsSettingsStored | null> {
  const row = await db.systemSettings.findUnique({ where: { key: MAPS_SETTINGS_KEY } });
  if (!row) return null;
  try {
    return parseStored(JSON.parse(row.value_json) as unknown);
  } catch {
    return null;
  }
}

function mergeStored(
  defaults: MapsEffectiveConfig,
  stored: MapsSettingsStored | null,
  env: Record<string, string | undefined> = process.env,
): MapsEffectiveConfig {
  if (!stored) return defaults;

  let tileUrl = defaults.tiles.tileUrl;
  if (stored.tileUrl !== undefined) {
    const trimmed = stored.tileUrl?.trim() || "";
    tileUrl =
      trimmed && isStaffSpaCompatibleTileUrl(trimmed, env) ? trimmed : defaults.tiles.tileUrl;
  }

  const maxZoom =
    stored.maxZoom != null && stored.maxZoom > 0
      ? Math.floor(stored.maxZoom)
      : defaults.tiles.maxZoom;

  const attribution =
    stored.attribution !== undefined
      ? stored.attribution?.trim() || defaults.tiles.attribution
      : defaults.tiles.attribution;

  const geocodingBaseUrl =
    stored.geocodingBaseUrl !== undefined
      ? (stored.geocodingBaseUrl?.trim() || defaults.geocoding.baseUrl).replace(/\/$/, "")
      : defaults.geocoding.baseUrl;

  const geocodingProvider =
    stored.geocodingProvider !== undefined
      ? stored.geocodingProvider?.trim() || defaults.geocoding.provider
      : defaults.geocoding.provider;

  return {
    tiles: {
      enabled: stored.enabled ?? defaults.tiles.enabled,
      tileUrl,
      attribution,
      maxZoom,
    },
    geocoding: {
      provider: geocodingProvider,
      baseUrl: geocodingBaseUrl,
      timeoutMs: defaults.geocoding.timeoutMs,
    },
  };
}

/** Built-in defaults only (not deploy env toggles). Used when no UI row exists yet. */
export function builtInMapsConfig(
  env: Record<string, string | undefined> = process.env,
): MapsEffectiveConfig {
  return {
    tiles: defaultMapTileConfig(env),
    geocoding: defaultGeocodingConfig(env),
  };
}

export async function resolveEffectiveMapsConfig(
  db: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<MapsEffectiveConfig> {
  const stored = await readStored(db);
  return mergeStored(builtInMapsConfig(env), stored, env);
}

export async function refreshMapsConfigCache(
  db: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<MapsEffectiveConfig> {
  try {
    const effective = await resolveEffectiveMapsConfig(db, env);
    setMapsConfigCache(effective);
    return effective;
  } catch (err) {
    console.error("maps config cache refresh failed:", err);
    // Keep the previous cache rather than silently downgrading to built-in defaults.
    return getMapsConfigCache() ?? builtInMapsConfig(env);
  }
}

function publicFromEffective(effective: MapsEffectiveConfig): MapsSettingsPublic {
  return {
    enabled: effective.tiles.enabled,
    tileUrl: effective.tiles.tileUrl,
    attribution: effective.tiles.attribution,
    maxZoom: effective.tiles.maxZoom,
    geocodingProvider: effective.geocoding.provider,
    geocodingBaseUrl: effective.geocoding.baseUrl,
  };
}

export async function describeMapsSettings(db: PrismaClient): Promise<MapsSettingsPublic> {
  return publicFromEffective(await resolveEffectiveMapsConfig(db));
}

export async function patchMapsSettings(
  db: PrismaClient,
  patch: MapsSettingsPatch,
): Promise<MapsSettingsPublic> {
  const current = (await readStored(db)) ?? {};
  const next: MapsSettingsStored = { ...current };

  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.tileUrl !== undefined) next.tileUrl = patch.tileUrl?.trim() || null;
  if (patch.attribution !== undefined) next.attribution = patch.attribution?.trim() || null;
  if (patch.maxZoom !== undefined) {
    next.maxZoom =
      patch.maxZoom != null && patch.maxZoom > 0 ? Math.floor(patch.maxZoom) : null;
  }
  if (patch.geocodingProvider !== undefined) {
    next.geocodingProvider = patch.geocodingProvider?.trim() || null;
  }
  if (patch.geocodingBaseUrl !== undefined) {
    next.geocodingBaseUrl = patch.geocodingBaseUrl?.trim() || null;
  }

  await db.systemSettings.upsert({
    where: { key: MAPS_SETTINGS_KEY },
    create: { key: MAPS_SETTINGS_KEY, value_json: JSON.stringify(next) },
    update: { value_json: JSON.stringify(next) },
  });

  const effective = await refreshMapsConfigCache(db);
  return publicFromEffective(effective);
}
