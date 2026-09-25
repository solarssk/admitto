import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { sessionCookieFor } from "../helpers/session-cookie.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { openMeteoForecastResponse, type ForecastDay } from "../helpers/open-meteo-forecast.js";
import * as weatherOrgSettings from "../../src/weather/weather-org-settings.js";
import {
  InMemoryWeatherCache,
  WeatherService,
  resolveWeatherEnvConfig,
} from "../../src/weather/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const CHECKIN_TOKEN = "event-weather-snapshot-checkin-token-32chars!";

const ORG_ID = "org-event-weather-snapshot";
const EVENT_AHEAD = "evt-event-weather-snapshot-ahead"; // 6 Aug
const EVENT_ENDED = "evt-event-weather-snapshot-ended"; // 1 Aug
const EMAIL_SUPER = "event-weather-snapshot-super@example.com";
const EMAIL_OP = "event-weather-snapshot-op@example.com";
const PASSWORD = "event-weather-snapshot-pass-123";

const WEATHER_OF_6_AUG = {
  status: "past",
  temp_c: 20,
  temp_min_c: 11,
  weather_code: 61,
  attribution: "Weather data by Open-Meteo.com",
  attribution_url: "https://open-meteo.com/",
};

/** What listing the events on 5 Aug saves for the event of 6 Aug (the provider's default day). */
const SAVED_6_AUG = {
  v: 1,
  date: "2026-08-06",
  lat: 52.23,
  lon: 21.01,
  provider: "openmeteo",
  temp_c: 20,
  temp_min_c: 11,
  weather_code: 61,
  captured_at: "2026-08-05T09:00:00.000Z",
};
const DEFAULT_DAY: ForecastDay = { max: 19.6, min: 11.2, code: 61 };

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
let superId: string;
let opId: string;

/** The clock the weather service sees, how often a provider was asked, and what it answers. */
let clock = new Date("2026-08-05T12:00:00.000Z");
let providerCalls = 0;
let providerDay = DEFAULT_DAY;
/** Runs in the middle of a provider call: after the saved forecasts were read, before any write. */
let duringProviderCall: (() => Promise<unknown>) | null = null;

/** One org with a superadmin, an operator, and two pinned events: 6 Aug (ahead) and 1 Aug (ended). */
async function seed(client: PrismaClient) {
  await client.roleAssignment.deleteMany({
    where: { scope_id: { in: [ORG_ID, EVENT_AHEAD, EVENT_ENDED] } },
  });
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_SUPER, EMAIL_OP] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: [EMAIL_SUPER] } } } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_AHEAD, EVENT_ENDED] } } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  await client.organization.create({
    data: { id: ORG_ID, name: "Weather Snapshot Org", slug: "event-weather-snapshot" },
  });
  for (const [id, slug, date] of [
    [EVENT_AHEAD, "event-weather-snapshot-ahead", "2026-08-06T12:00:00.000Z"],
    [EVENT_ENDED, "event-weather-snapshot-ended", "2026-08-01T12:00:00.000Z"],
  ] as const) {
    await client.event.create({
      data: { id, title: slug, slug, date: new Date(date), organization_id: ORG_ID },
    });
    await client.eventLocation.create({ data: { event_id: id, latitude: 52.23, longitude: 21.01 } });
  }

  const password_hash = await hashPassword(PASSWORD);
  superId = (await client.user.create({ data: { email: EMAIL_SUPER, password_hash } })).id;
  opId = (await client.user.create({ data: { email: EMAIL_OP, password_hash } })).id;
  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_AHEAD },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_ENDED },
    ],
  });
  await enrollConfirmedTotp(client, superId);
}

type ListedEvent = { id: string; weather?: unknown } & Record<string, unknown>;

/** GET a staff event list (or single event) as `userId` and index the events by id. */
async function listEvents(path: string, userId: string): Promise<Map<string, ListedEvent>> {
  const res = await app.request(path, { headers: { Cookie: await sessionCookieFor(prisma, userId) } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { events: ListedEvent[] };
  return new Map(body.events.map((e) => [e.id, e]));
}

/** The forecast currently saved on the event of 6 Aug. */
const savedSnapshot = () =>
  prisma.event.findUniqueOrThrow({ where: { id: EVENT_AHEAD }, select: { weather_snapshot: true } });

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);
  app = buildTestApp({ prisma, checkinToken: CHECKIN_TOKEN, adminDistRoot });
});

beforeEach(async () => {
  // Every test starts with no saved forecast and the events on their own days.
  await prisma.event.updateMany({
    where: { id: { in: [EVENT_AHEAD, EVENT_ENDED] } },
    data: { weather_snapshot: Prisma.DbNull },
  });
  await prisma.event.update({ where: { id: EVENT_AHEAD }, data: { date: new Date("2026-08-06T12:00:00.000Z") } });
  clock = new Date("2026-08-05T12:00:00.000Z");
  providerCalls = 0;
  providerDay = DEFAULT_DAY;
  duringProviderCall = null;
  vi.spyOn(weatherOrgSettings, "createWeatherServiceFromDb").mockImplementation(
    async () =>
      new WeatherService({
        config: resolveWeatherEnvConfig({ WEATHER_PROVIDER: "openmeteo" }),
        cache: new InMemoryWeatherCache(),
        now: () => clock,
        fetchFn: async () => {
          providerCalls += 1;
          await duringProviderCall?.();
          return openMeteoForecastResponse(clock, providerDay);
        },
      }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("an event's last forecast", () => {
  it("is saved when the events list shows it, and shown again after the event", async () => {
    const before = await listEvents("/api/admin/events", superId);
    expect(before.get(EVENT_AHEAD)?.weather).toMatchObject({ status: "ok", temp_c: 20, temp_min_c: 11 });
    expect((await savedSnapshot()).weather_snapshot).toMatchObject({
      v: 1,
      date: "2026-08-06",
      lat: 52.23,
      lon: 21.01,
      provider: "openmeteo",
      temp_c: 20,
      temp_min_c: 11,
      weather_code: 61,
    });

    // Two days after the event no provider can say anything any more.
    clock = new Date("2026-08-08T12:00:00.000Z");
    providerCalls = 0;
    const after = await listEvents("/api/admin/events", superId);
    expect(after.get(EVENT_AHEAD)?.weather).toEqual(WEATHER_OF_6_AUG);
    expect(providerCalls).toBe(0);
  });

  it("is replaced by a newer forecast while the day is still ahead", async () => {
    await listEvents("/api/admin/events", superId);
    providerDay = { max: 25.4, min: 14.1, code: 2 };
    // A new request asks the provider again; the write only lands because the stored value is
    // still the one that request read (a condition on the whole JSON value, run on a real JSONB).
    await listEvents("/api/admin/events", superId);
    expect((await savedSnapshot()).weather_snapshot).toMatchObject({
      temp_c: 25,
      temp_min_c: 14,
      weather_code: 2,
    });
  });

  it("on the event day fills an empty snapshot", async () => {
    clock = new Date("2026-08-06T12:00:00.000Z");
    await listEvents("/api/admin/events", superId);
    expect((await savedSnapshot()).weather_snapshot).toMatchObject({ date: "2026-08-06", temp_c: 20 });
  });

  it("does not overwrite a forecast another request saved while this one was asking the provider", async () => {
    // The event day itself: with nothing saved when it looked, this reading (which MET Norway may
    // only give for the hours left) would be kept, but a full-day forecast landed in the meantime.
    clock = new Date("2026-08-06T12:00:00.000Z");
    const fullDay = { ...SAVED_6_AUG, temp_c: 23, temp_min_c: 12, weather_code: 2 };
    duringProviderCall = () =>
      prisma.event.update({ where: { id: EVENT_AHEAD }, data: { weather_snapshot: fullDay } });
    await listEvents("/api/admin/events", superId);
    expect(providerCalls).toBeGreaterThan(0);
    expect((await savedSnapshot()).weather_snapshot).toEqual(fullDay);
  });

  it("is not there for an ended event that was never seen with a forecast, and that is not an error", async () => {
    const events = await listEvents("/api/admin/events", superId);
    expect(events.get(EVENT_ENDED)?.weather).toEqual({ status: "past" });
  });

  it("is never sent to the browser as the raw stored column", async () => {
    await listEvents("/api/admin/events", superId);
    const events = await listEvents("/api/admin/events", superId);
    for (const event of events.values()) expect(event).not.toHaveProperty("weather_snapshot");
  });

  it("is shown on a single event too", async () => {
    await prisma.event.update({ where: { id: EVENT_AHEAD }, data: { weather_snapshot: SAVED_6_AUG } });
    clock = new Date("2026-08-08T12:00:00.000Z");
    const res = await app.request(`/api/admin/events/${EVENT_AHEAD}`, {
      headers: { Cookie: await sessionCookieFor(prisma, superId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: ListedEvent };
    expect(body.event.weather).toEqual(WEATHER_OF_6_AUG);
  });

  it("is shown to operators on the check-in event list too", async () => {
    await listEvents("/api/admin/events", superId);
    clock = new Date("2026-08-08T12:00:00.000Z");
    const events = await listEvents("/api/checkin/events", opId);
    expect(events.get(EVENT_AHEAD)?.weather).toEqual(WEATHER_OF_6_AUG);
  });

  it("is dropped once the event moved to another day", async () => {
    await listEvents("/api/admin/events", superId);
    // Moved back to 2 Aug: the saved forecast was for 6 Aug and must not be shown for it.
    await prisma.event.update({ where: { id: EVENT_AHEAD }, data: { date: new Date("2026-08-02T12:00:00.000Z") } });
    clock = new Date("2026-08-08T12:00:00.000Z");
    const events = await listEvents("/api/admin/events", superId);
    expect(events.get(EVENT_AHEAD)?.weather).toEqual({ status: "past" });
  });
});
