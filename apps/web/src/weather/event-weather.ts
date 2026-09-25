/**
 * Weather for a list of events, plus keeping each event's last forecast (ADR 0040). Staff list
 * requests are where forecasts get seen, so they are also where the last one is saved: an ended
 * event can no longer be asked for its weather, only shown what was saved.
 */

import { Prisma, type PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import type { WeatherSummaryDto } from "./types.js";
import { summarizeMany, type WeatherService } from "./weather-service.js";
import { nextWeatherSnapshot, snapshotForEvent } from "./weather-snapshot.js";

/** The part of an event row the weather needs. */
export interface WeatherEventRow {
  id: string;
  date: Date;
  timezone: string;
  map_latitude?: number | null;
  map_longitude?: number | null;
}

/**
 * Stored `Event.weather_snapshot` values by event id, or null when they could not be read. That
 * costs the ended-event chip, and it means nothing may be saved: without what is stored there is
 * no telling whether a new reading is allowed to replace it.
 */
async function loadStoredSnapshots(
  db: PrismaClient,
  ids: string[],
): Promise<Map<string, Prisma.JsonValue> | null> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await db.event.findMany({
      where: { id: { in: ids } },
      select: { id: true, weather_snapshot: true },
    });
    return new Map(rows.map((row) => [row.id, row.weather_snapshot]));
  } catch {
    emitSystemLog("db", "warn", "weather_snapshot_load_failed", { events: ids.length });
    return null;
  }
}

/**
 * Save the forecasts that just became the newest look at their event day. Each write only lands
 * while the stored value is still the one the decision was made from: a provider call sits between
 * the read and the write, and a request that saved in the meantime (a full-day forecast just
 * before midnight, say) must not be overwritten by this older or partial reading. A write that
 * lost that race is dropped, not an error. Never throws.
 */
async function saveNewSnapshots(
  db: PrismaClient,
  service: WeatherService,
  events: WeatherEventRow[],
  summaries: Array<WeatherSummaryDto | null>,
  stored: Map<string, Prisma.JsonValue>,
): Promise<void> {
  const provider = service.configSnapshot.provider;
  const now = new Date();
  const writes: Array<Promise<unknown>> = [];
  events.forEach((event, i) => {
    const { map_latitude: latitude, map_longitude: longitude } = event;
    const day = service.eventDay(event.date, event.timezone);
    if (latitude == null || longitude == null || !day) return;
    const next = nextWeatherSnapshot({
      current: snapshotForEvent(stored.get(event.id), { latitude, longitude, eventYmd: day.ymd }),
      summary: summaries[i],
      provider,
      latitude,
      longitude,
      eventYmd: day.ymd,
      offsetDays: day.offsetDays,
      now,
    });
    if (next) {
      writes.push(
        db.event.updateMany({
          where: { id: event.id, weather_snapshot: { equals: stored.get(event.id) ?? Prisma.DbNull } },
          data: { weather_snapshot: next },
        }),
      );
    }
  });
  const failed = (await Promise.allSettled(writes)).filter((r) => r.status === "rejected").length;
  if (failed > 0) emitSystemLog("db", "warn", "weather_snapshot_save_failed", { failed });
}

/**
 * Weather summaries for a list of events, in the same order. Ended events get the forecast that
 * was saved for them (if any), and forecasts seen now are saved for later.
 */
export async function summarizeEventsWeather(
  db: PrismaClient,
  service: WeatherService,
  events: WeatherEventRow[],
): Promise<Array<WeatherSummaryDto | null>> {
  const withPin = events.filter((e) => e.map_latitude != null && e.map_longitude != null);
  const stored = await loadStoredSnapshots(db, withPin.map((e) => e.id));
  const summaries = await summarizeMany(
    events.map((e) => ({
      latitude: e.map_latitude,
      longitude: e.map_longitude,
      date: e.date,
      timezone: e.timezone,
      snapshot: stored?.get(e.id),
    })),
    service,
  );
  if (stored) await saveNewSnapshots(db, service, events, summaries, stored);
  return summaries;
}
