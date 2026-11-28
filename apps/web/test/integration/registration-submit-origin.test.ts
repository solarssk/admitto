/**
 * What a request keeps of where it came from (`keep_origin`), against a real database: the client address the limits use, the zone the page
 * sent, and the language of the browser. With the switch off nothing of the three is kept, and the language still is. The place of the
 * address is empty here because the test has no GeoIP database, which is not an error (the place itself is tested in
 * ../registration/submission-origin.test.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { documentOf } from "../helpers/registration-form-fixtures.js";
import { eventSeeder, harness } from "../helpers/registration-submit-harness.js";

const peer = vi.hoisted(() => ({ address: "203.0.113.10" }));
vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(() => ({ remote: { address: peer.address, port: 1234 } })),
}));

const ORG = "org-reg-origin";

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let slugCounter = 0;
const nextSlug = () => `regorigin-${(slugCounter += 1)}`;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
});

beforeEach(() => {
  peer.address = "203.0.113.10";
  resetSystemLogBufferForTest();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Sends the form of a new event and returns the one registration it made. */
async function submit(options: { keep?: boolean; timeZone?: unknown; headers?: Record<string, string> } = {}) {
  const slug = nextSlug();
  const eventId = await seeder.addEvent(slug, { settings: { mode: "approval", verify_email: false, ...(options.keep === undefined ? {} : { keep_origin: options.keep }) } });
  const h = harness({ prisma });
  const body = h.body(slug, options.timeZone === undefined ? {} : { time_zone: options.timeZone });
  const res = await h.post(slug, body, { headers: options.headers });
  expect(res.status).toBe(200);
  const row = await prisma.registration.findFirstOrThrow({ where: { event_id: eventId } });
  return { row, res, email: body.email };
}

describe("an event that keeps where a request came from (the default)", () => {
  it("saves the client address, the zone the page sent in the product's spelling, and the language, and no place without a database", async () => {
    const { row } = await submit({ timeZone: "Europe/Warsaw", headers: { "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8" } });

    expect(row).toMatchObject({
      submitted_ip: "203.0.113.10",
      submitted_timezone: "Europe/Warsaw",
      submitted_country: null,
      submitted_region: null,
      locale: "pl-PL",
    });
  });

  it("takes the address the limits use: X-Forwarded-For counts only from a trusted proxy, and a guest cannot choose what is stored", async () => {
    const forwarded = { "X-Forwarded-For": "198.51.100.77" };

    // No TRUST_PROXY: the header is not read.
    expect((await submit({ headers: forwarded })).row.submitted_ip).toBe("203.0.113.10");

    // TRUST_PROXY on, and the peer is the loopback proxy of the default list: the header is the client.
    vi.stubEnv("TRUST_PROXY", "true");
    peer.address = "127.0.0.1";
    expect((await submit({ headers: forwarded })).row.submitted_ip).toBe("198.51.100.77");

    // TRUST_PROXY on, and the peer is not a proxy of ours: the header is not read.
    peer.address = "203.0.113.10";
    expect((await submit({ headers: forwarded })).row.submitted_ip).toBe("203.0.113.10");
  });

  it("drops a zone that is not one without refusing the request, and keeps the rest", async () => {
    for (const timeZone of ["Mars/Olympus", "", 42, "x".repeat(200), { zone: "Europe/Warsaw" }]) {
      const { row } = await submit({ timeZone });
      expect(row.submitted_timezone).toBeNull();
      expect(row.submitted_ip).toBe("203.0.113.10");
    }
  });

  it("keeps no language when the browser sends none or something that is not a tag", async () => {
    expect((await submit()).row.locale).toBeNull();
    expect((await submit({ headers: { "Accept-Language": "*" } })).row.locale).toBeNull();
  });

  it("writes none of it to a log line", async () => {
    const { email } = await submit({ timeZone: "Europe/Warsaw", headers: { "Accept-Language": "pl-PL" } });
    const logged = JSON.stringify(querySystemLogs({}));
    const spoken = JSON.stringify([vi.mocked(console.info).mock.calls, vi.mocked(console.warn).mock.calls]);
    for (const secret of ["203.0.113.10", "Europe/Warsaw", "pl-PL", email]) {
      expect(logged).not.toContain(secret);
      expect(spoken).not.toContain(secret);
    }
  });
});

describe("an event that does not keep where a request came from", () => {
  it("saves no address and no zone, ignores the zone the body carries without refusing it, and still keeps the language", async () => {
    const { row } = await submit({ keep: false, timeZone: "Europe/Warsaw", headers: { "Accept-Language": "de-DE" } });

    expect(row).toMatchObject({ submitted_ip: null, submitted_timezone: null, submitted_country: null, submitted_region: null, locale: "de-DE" });
  });
});

describe("the page of the event", () => {
  it("tells the script to send the zone only while the event keeps the origin", async () => {
    const on = nextSlug();
    const off = nextSlug();
    await seeder.addEvent(on, { settings: { keep_origin: true } });
    await seeder.addEvent(off, { settings: { keep_origin: false } });
    const h = harness({ prisma });

    expect(documentOf(await (await h.get(`/r/${on}`)).text()).getElementById("reg-form").hasAttribute("data-keep-origin")).toBe(true);
    expect(documentOf(await (await h.get(`/r/${off}`)).text()).getElementById("reg-form").hasAttribute("data-keep-origin")).toBe(false);
  });
});
