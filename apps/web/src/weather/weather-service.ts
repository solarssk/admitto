/**
 * Resolve event-day weather summary for list cards and public tickets (ADR 0040).
 */

import {
  attributionForProvider,
  forecastHorizonDays,
  type WeatherConfig,
  resolveWeatherEnvConfig,
} from "./config.js";
import { MetNoClient } from "./met-no-client.js";
import { OpenMeteoClient, WeatherProviderError } from "./open-meteo-client.js";
import type { WeatherSummaryDto } from "./types.js";
import {
  getSharedWeatherCache,
  weatherCacheKey,
  weatherConfigCacheScope,
  type WeatherCache,
} from "./weather-cache.js";

/** Max parallel provider fetches when attaching weather to an event list. */
const WEATHER_LIST_CONCURRENCY = 6;

export interface EventWeatherInput {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  /** Event instant (UTC ISO / Date). */
  date: Date | string;
  /** IANA timezone for the event calendar day. */
  timezone: string;
}

export interface WeatherServiceOptions {
  config?: WeatherConfig;
  cache?: WeatherCache;
  fetchFn?: typeof fetch;
  /** Inject "now" for horizon tests. */
  now?: () => Date;
  /**
   * User-Agent for MET Norway (required by their ToS). When omitted and provider is metno,
   * summarize / probe return unavailable without calling the API.
   */
  userAgent?: string | null;
  /** When false and provider is metno, skip API calls (Support contact missing). */
  contactConfigured?: boolean;
}

function probeErrorMessage(err: unknown): string {
  if (err instanceof WeatherProviderError) return err.kind;
  if (err instanceof Error) return err.message;
  return "unavailable";
}

/** Calendar YYYY-MM-DD in the event timezone (falls back to UTC). */
export function eventDateYmd(date: Date | string, timezone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Local calendar YYYY-MM-DD for `now` in `timezone`. */
export function localYmd(now: Date, timezone: string): string {
  return eventDateYmd(now, timezone);
}

function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY;
  return Math.round((to - from) / 86_400_000);
}

export class WeatherService {
  private readonly config: WeatherConfig;
  private readonly cache: WeatherCache;
  private readonly openMeteo: OpenMeteoClient;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly userAgent: string | null;
  private readonly contactConfigured: boolean;

  constructor(options: WeatherServiceOptions = {}) {
    this.config = options.config ?? resolveWeatherEnvConfig();
    this.cache = options.cache ?? getSharedWeatherCache();
    this.fetchFn = options.fetchFn ?? fetch;
    this.openMeteo = new OpenMeteoClient({
      config: this.config,
      // Forward the raw (possibly undefined) override, not the `?? fetch`-defaulted
      // `this.fetchFn` below — OpenMeteoClient uses "no override" as its signal to pin the
      // connection (see open-meteo-client.ts), which would never trigger if this always
      // passed a concrete function.
      fetchFn: options.fetchFn,
    });
    this.now = options.now ?? (() => new Date());
    this.userAgent = options.userAgent?.trim() || null;
    this.contactConfigured = options.contactConfigured ?? Boolean(this.userAgent);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get configSnapshot(): WeatherConfig {
    return this.config;
  }

  private attributionFields(): Pick<WeatherSummaryDto, "attribution" | "attribution_url"> {
    const a = attributionForProvider(this.config.provider);
    return {
      attribution: a.attribution,
      attribution_url: a.attributionUrl,
    };
  }

  private metNoReady(): boolean {
    return this.contactConfigured && Boolean(this.userAgent);
  }

  private metNoClient(): MetNoClient {
    if (!this.userAgent) {
      throw new WeatherProviderError("unavailable");
    }
    return new MetNoClient({
      timeoutMs: this.config.timeoutMs,
      userAgent: this.userAgent,
      fetchFn: this.fetchFn,
    });
  }

  /**
   * Summary for one event. Returns `null` when weather should be omitted from the UI
   * (disabled or no coordinates).
   */
  async summarize(input: EventWeatherInput): Promise<WeatherSummaryDto | null> {
    if (!this.config.enabled) return null;
    const lat = input.latitude;
    const lon = input.longitude;
    if (
      lat == null ||
      lon == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return null;
    }

    const tz = input.timezone?.trim() || "UTC";
    const eventYmd = eventDateYmd(input.date, tz);
    if (!eventYmd) {
      return { status: "unavailable", ...this.attributionFields() };
    }
    const todayYmd = localYmd(this.now(), tz);
    const offsetDays = daysBetweenYmd(todayYmd, eventYmd);
    const horizon = forecastHorizonDays(this.config.provider);

    if (offsetDays > horizon - 1) {
      return {
        status: "too_far",
        opens_in_days: offsetDays - (horizon - 1),
        horizon_days: horizon,
        ...this.attributionFields(),
      };
    }

    // Past event days: still try archive via forecast API with past_days if needed;
    // for v1, treat more than a day in the past as unavailable (list/ticket rarely need it).
    if (offsetDays < -1) {
      return { status: "unavailable", ...this.attributionFields() };
    }

    if (this.config.provider === "metno" && !this.metNoReady()) {
      return { status: "unavailable", ...this.attributionFields() };
    }

    const key = weatherCacheKey(
      lat,
      lon,
      eventYmd,
      weatherConfigCacheScope(this.config),
    );
    const cached = await this.cache.get(key);
    if (cached) {
      return {
        status: "ok",
        temp_c: Math.round(cached.temp_max_c),
        temp_min_c: Math.round(cached.temp_min_c),
        weather_code: cached.weather_code,
        ...this.attributionFields(),
      };
    }

    try {
      const day =
        this.config.provider === "metno"
          ? await this.metNoClient().fetchDayForecast(lat, lon, eventYmd, tz)
          : await this.openMeteo.fetchDayForecast(lat, lon, eventYmd, tz);
      await this.cache.set(key, day, this.config.cacheTtlMs);
      return {
        status: "ok",
        temp_c: Math.round(day.temp_max_c),
        temp_min_c: Math.round(day.temp_min_c),
        weather_code: day.weather_code,
        ...this.attributionFields(),
      };
    } catch {
      return { status: "unavailable", ...this.attributionFields() };
    }
  }

  async probeLive(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      if (this.config.provider === "metno") {
        if (!this.metNoReady()) {
          return {
            ok: false,
            latencyMs: Date.now() - started,
            error: "support_contact_required",
          };
        }
        await this.metNoClient().probe();
      } else {
        await this.openMeteo.probe();
      }
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      const message = probeErrorMessage(err);
      return { ok: false, latencyMs: Date.now() - started, error: message };
    }
  }
}

let sharedService: WeatherService | null = null;

/** Process-wide service (env config). Tests should construct `WeatherService` directly. */
export function getWeatherService(): WeatherService {
  sharedService ??= new WeatherService();
  return sharedService;
}

/** @internal */
export function resetWeatherServiceForTests(): void {
  sharedService = null;
}

export async function summarizeMany(
  inputs: EventWeatherInput[],
  service: WeatherService = getWeatherService(),
  concurrency: number = WEATHER_LIST_CONCURRENCY,
): Promise<Array<WeatherSummaryDto | null>> {
  if (inputs.length === 0) return [];
  const limit = Math.min(Math.max(1, concurrency), inputs.length);
  const results = new Array<WeatherSummaryDto | null>(inputs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next;
      next += 1;
      if (i >= inputs.length) return;
      results[i] = await service.summarize(inputs[i]!);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
