import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createClient } from "redis";
import { RedisGeocodingCache } from "../../src/maps/geocoding-cache.js";
import { GeocodingService } from "../../src/maps/geocoding-service.js";
import { defaultWeatherConfig } from "../../src/weather/config.js";
import { RedisWeatherCache } from "../../src/weather/weather-cache.js";
import { WeatherService } from "../../src/weather/weather-service.js";

const redisUrl = process.env["REDIS_URL"]!;

describe("cache identities through Redis serialization", () => {
  it.each(["search", "reverse"])("isolates geocoding operations when %s runs first", async (first) => {
    const scope = `https://geocoding-${randomUUID()}.example.com`;
    const query = "rev:52.300000,21.050000";
    const result = { formatted_address: "Synthetic reverse venue", latitude: 52.3, longitude: 21.05, provider: "nominatim" };
    const provider = { name: "nominatim", search: vi.fn(async () => []), reverse: vi.fn(async () => result) };
    const cache = new RedisGeocodingCache(redisUrl);
    const get = vi.spyOn(cache, "get");
    const service = new GeocodingService(provider, cache, () => scope);
    const client = createClient({ url: redisUrl });
    const oldKey = `geocoding:cache:nominatim:v2:${scope}:${query}`;
    await client.connect();
    try {
      await client.set(oldKey, JSON.stringify([result]), { expiration: { type: "PX", value: 60_000 } });
      if (first === "search") {
        expect(await service.search(query)).toEqual([]);
        expect(await service.reverse(52.3, 21.05)).toEqual(result);
      } else {
        expect(await service.reverse(52.3, 21.05)).toEqual(result);
        expect(await service.search(query)).toEqual([]);
      }
      expect(await service.search(`  ${query.toUpperCase()}  `)).toEqual([]);
      expect(await service.reverse(52.30000001, 21.05)).toEqual(result);
      expect(provider.search).toHaveBeenCalledOnce();
      expect(provider.reverse).toHaveBeenCalledOnce();
      for (const operation of ["search", "reverse"]) {
        const key = get.mock.calls.map(([key]) => key).find((key) => (JSON.parse(key) as string[])[3] === operation)!;
        const prefixKey = `geocoding:cache:${key}`;
        expect(JSON.parse((await client.get(prefixKey))!)).toEqual(operation === "search" ? [] : [result]);
        const ttl = await client.pTTL(prefixKey);
        const days = operation === "search" ? 1 : 30;
        expect(ttl).toBeGreaterThan((days - 0.1) * 86_400_000);
        expect(ttl).toBeLessThanOrEqual(days * 86_400_000);
      }
    } finally {
      await client.del([oldKey, ...get.mock.calls.map(([key]) => `geocoding:cache:${key}`)]);
      await cache.disconnect();
      await client.close();
    }
  });

  it.each(["UTC", "Europe/Warsaw"])("isolates weather timezones when %s runs first", async (first) => {
    const second = first === "UTC" ? "Europe/Warsaw" : "UTC";
    const config = { ...defaultWeatherConfig({}), provider: "openmeteo" as const, baseUrl: `https://forecast-${randomUUID()}.example.com` };
    const cache = new RedisWeatherCache(redisUrl);
    const get = vi.spyOn(cache, "get");
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const max = url.searchParams.get("timezone") === "UTC" ? 20 : 30;
      return Response.json({ daily: { time: ["2026-08-08"], weather_code: [1], temperature_2m_max: [max], temperature_2m_min: [10] } });
    });
    const service = new WeatherService({ config, cache, fetchFn, now: () => new Date("2026-08-05T12:00:00Z") });
    const client = createClient({ url: redisUrl });
    const oldKey = `weather:forecast:52.30:21.05:2026-08-08:om:${config.baseUrl}:c`;
    await client.connect();
    try {
      await client.set(oldKey, JSON.stringify({ date: "2026-08-08", temp_max_c: 99, temp_min_c: 99, weather_code: 95 }));
      for (const timezone of [first, second, first, second]) {
        expect(await service.summarize({ latitude: 52.3, longitude: 21.05, date: "2026-08-08T12:00:00Z", timezone })).toMatchObject({
          status: "ok", temp_c: timezone === "UTC" ? 20 : 30,
        });
      }
      expect(fetchFn).toHaveBeenCalledTimes(2);
      for (const key of new Set(get.mock.calls.map(([key]) => key))) {
        const parts = JSON.parse(key) as string[];
        expect(parts[5]).toMatch(/^(UTC|Europe\/Warsaw)$/);
        const raw = await client.get(`weather:forecast:${key}`);
        expect(JSON.parse(raw!)).toMatchObject({ date: "2026-08-08", temp_max_c: parts[5] === "UTC" ? 20 : 30 });
        const ttl = await client.pTTL(`weather:forecast:${key}`);
        expect(ttl).toBeGreaterThan(config.cacheTtlMs / 2);
        expect(ttl).toBeLessThanOrEqual(config.cacheTtlMs);
      }
    } finally {
      await client.del([oldKey, ...get.mock.calls.map(([key]) => `weather:forecast:${key}`)]);
      await cache.disconnect();
      await client.close();
    }
  });
});
