import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import type { GeocodingProvider, GeocodingResult } from "@admitto/location";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";
import { GeocodingProviderError } from "../../src/maps/nominatim-provider.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_GEO = "org-geocoding-routes";
const EMAIL_ADMIN = "geocoding-admin@example.com";
const EMAIL_OP = "geocoding-op@example.com";
const PASSWORD = "geocoding-test-pass-123";

const SAMPLE_RESULTS: GeocodingResult[] = [
  { formatted_address: "Warsaw, Poland", latitude: 52.23, longitude: 21.01, provider: "fake" },
];

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let adminId: string;
let adminCookie = "";
let opCookie = "";
let prevInstanceOrgId: string | undefined;

// Mutable behavior for the injected fake provider — reset before every test so one test's
// configured result/error/call log never leaks into the next.
let searchResults: GeocodingResult[] = SAMPLE_RESULTS;
let searchError: GeocodingProviderError | null = null;
let searchCalls: string[] = [];
let reverseResult: GeocodingResult | null = SAMPLE_RESULTS[0] ?? null;
let reverseError: GeocodingProviderError | null = null;
let reverseCalls: Array<{ lat: number; lng: number }> = [];

const fakeProvider: GeocodingProvider = {
  name: "fake",
  search: async (query: string) => {
    searchCalls.push(query);
    if (searchError) throw searchError;
    return searchResults;
  },
  reverse: async (latitude: number, longitude: number) => {
    reverseCalls.push({ lat: latitude, lng: longitude });
    if (reverseError) throw reverseError;
    return reverseResult;
  },
};

async function seed(client: PrismaClient) {
  await client.roleAssignment.deleteMany({ where: { scope_id: ORG_GEO } });
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: EMAIL_ADMIN } } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } });
  await client.organization.deleteMany({ where: { id: ORG_GEO } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.create({
    data: { id: ORG_GEO, name: "Geocoding Routes Org", slug: "geocoding-routes-org" },
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminUser.id, role: "admin", scope_type: "organization", scope_id: ORG_GEO },
      { user_id: opUser.id, role: "operator", scope_type: "organization", scope_id: ORG_GEO },
    ],
  });

  await client.userMfaMethod.create({
    data: {
      user_id: adminUser.id,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });

  return { adminId: adminUser.id, opId: opUser.id };
}

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

beforeAll(async () => {
  // isGeocodingContactConfigured() resolves the *instance* organization (INSTANCE_ORG_ID env,
  // else org_default, else first by id) — not "whichever org the caller belongs to". Pin it to
  // this file's fixture org so contact_configured assertions don't depend on what other
  // integration test files left behind in this shared test database.
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_GEO;

  prisma = createTestPrismaClient();
  const { adminId: seededAdminId, opId } = await seed(prisma);
  adminId = seededAdminId;

  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
    geocodingProvider: fakeProvider,
  });

  adminCookie = await sessionCookieFor(adminId);
  opCookie = await sessionCookieFor(opId);
});

afterAll(async () => {
  if (prevInstanceOrgId === undefined) delete process.env.INSTANCE_ORG_ID;
  else process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  await prisma?.$disconnect();
});

beforeEach(async () => {
  rateLimitStore.reset();
  searchResults = SAMPLE_RESULTS;
  searchError = null;
  searchCalls = [];
  reverseResult = SAMPLE_RESULTS[0] ?? null;
  reverseError = null;
  reverseCalls = [];
  await prisma.organization.update({
    where: { id: ORG_GEO },
    data: { support_contact_name: null, support_contact_email: null },
  });
});

function search(cookie: string | null, body: unknown, rawBody?: string) {
  return app.request("/api/admin/geocoding/search", {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      "Content-Type": "application/json",
      ...sameOrigin,
    },
    body: rawBody ?? JSON.stringify(body),
  });
}

function reverse(cookie: string | null, body: unknown, rawBody?: string) {
  return app.request("/api/admin/geocoding/reverse", {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      "Content-Type": "application/json",
      ...sameOrigin,
    },
    body: rawBody ?? JSON.stringify(body),
  });
}

function timezone(cookie: string | null, body: unknown, rawBody?: string) {
  return app.request("/api/admin/geocoding/timezone", {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      "Content-Type": "application/json",
      ...sameOrigin,
    },
    body: rawBody ?? JSON.stringify(body),
  });
}

describe("POST /api/admin/geocoding/search", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const res = await search(null, { query: "Warsaw" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a user without admin panel access (operator)", async () => {
    const res = await search(opCookie, { query: "Warsaw" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await search(adminCookie, undefined, "{not json");
    expect(res.status).toBe(400);
  });

  it("returns 400 when query is missing", async () => {
    const res = await search(adminCookie, {});
    expect(res.status).toBe(400);
  });

  it("returns 400 when query is shorter than 2 characters", async () => {
    const res = await search(adminCookie, { query: "a" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when query exceeds the 300-character limit", async () => {
    const res = await search(adminCookie, { query: "a".repeat(301) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when query is not a string", async () => {
    const res = await search(adminCookie, { query: 123 });
    expect(res.status).toBe(400);
  });

  it("returns 400 on an unknown field (strict schema)", async () => {
    const res = await search(adminCookie, { query: "Warsaw", extra: "nope" });
    expect(res.status).toBe(400);
  });

  it("returns 200 with the provider's results and contact_configured=false by default", async () => {
    searchResults = [{ formatted_address: "Warsaw Happy Path", latitude: 1, longitude: 2, provider: "fake" }];

    const res = await search(adminCookie, { query: "Warsaw Happy Path" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: GeocodingResult[]; contact_configured: boolean };
    expect(body.results).toEqual(searchResults);
    expect(body.contact_configured).toBe(false);
  });

  it("returns contact_configured=true once the instance org has a support contact", async () => {
    await prisma.organization.update({
      where: { id: ORG_GEO },
      data: { support_contact_email: "ops@example.com" },
    });

    const res = await search(adminCookie, { query: "Krakow Contact Path" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { contact_configured: boolean };
    expect(body.contact_configured).toBe(true);
  });

  it("trims and normalizes the query before it reaches the provider", async () => {
    const res = await search(adminCookie, { query: "  Trim   Test  " });
    expect(res.status).toBe(200);
    expect(searchCalls).toEqual(["trim test"]);
  });

  it("returns 503 when the provider times out", async () => {
    searchError = new GeocodingProviderError("timeout");

    const res = await search(adminCookie, { query: "Timeout Query" });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("geocoding_unavailable");
  });

  it("returns 502 when the provider is unavailable", async () => {
    searchError = new GeocodingProviderError("unavailable");

    const res = await search(adminCookie, { query: "Unavailable Query" });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("geocoding_unavailable");
  });

  describe("rate limiting", () => {
    it("allows consecutive search requests within a second (Nominatim 1/s is provider-side)", async () => {
      const first = await search(adminCookie, { query: "Global Limit First" });
      expect(first.status).toBe(200);

      const second = await search(adminCookie, { query: "Global Limit Second" });
      expect(second.status).toBe(200);
    });

    it("returns 429 geocoding_rate_limited once the per-user 40/min limit is exhausted", async () => {
      const userKey = `admin:geocoding-search:user:${adminId}`;
      for (let i = 0; i < 40; i++) {
        await rateLimitStore.hit(userKey, 60_000, 40);
      }

      const res = await search(adminCookie, { query: "Per User Limit" });
      expect(res.status).toBe(429);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("geocoding_rate_limited");
    });
  });
});

describe("POST /api/admin/geocoding/reverse", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const res = await reverse(null, { latitude: 52.23, longitude: 21.01 });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a user without admin panel access (operator)", async () => {
    const res = await reverse(opCookie, { latitude: 52.23, longitude: 21.01 });
    expect(res.status).toBe(403);
  });

  it("returns 400 when coordinates are out of range", async () => {
    const res = await reverse(adminCookie, { latitude: 99, longitude: 21 });
    expect(res.status).toBe(400);
  });

  it("returns 200 with the provider result", async () => {
    reverseResult = {
      name: "Marywilska 62",
      formatted_address: "Polska, Warszawa — Marywilska 62",
      latitude: 52.3,
      longitude: 21.05,
      provider: "fake",
    };

    const res = await reverse(adminCookie, { latitude: 52.3, longitude: 21.05 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: GeocodingResult | null;
      contact_configured: boolean;
    };
    expect(body.result).toEqual(reverseResult);
    expect(body.contact_configured).toBe(false);
    expect(reverseCalls).toEqual([{ lat: 52.3, lng: 21.05 }]);
  });

  it("returns result: null when the provider has no coverage", async () => {
    reverseResult = null;
    const res = await reverse(adminCookie, { latitude: 0, longitude: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: GeocodingResult | null };
    expect(body.result).toBeNull();
  });

  it("returns 503 when the provider times out", async () => {
    reverseError = new GeocodingProviderError("timeout");
    const res = await reverse(adminCookie, { latitude: 1, longitude: 2 });
    expect(res.status).toBe(503);
  });

  it("returns 502 when the provider is unavailable", async () => {
    reverseError = new GeocodingProviderError("unavailable");
    const res = await reverse(adminCookie, { latitude: 1, longitude: 2 });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "geocoding_unavailable" });
  });
});

describe("POST /api/admin/geocoding/timezone", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const res = await timezone(null, { latitude: 52.23, longitude: 21.01 });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a user without admin panel access (operator)", async () => {
    const res = await timezone(opCookie, { latitude: 52.23, longitude: 21.01 });
    expect(res.status).toBe(403);
  });

  it("returns 400 when coordinates are out of range", async () => {
    const res = await timezone(adminCookie, { latitude: 99, longitude: 21 });
    expect(res.status).toBe(400);
  });

  it("returns Europe/Warsaw for a Warsaw pin", async () => {
    const res = await timezone(adminCookie, { latitude: 52.2297, longitude: 21.0122 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { timezone: string | null };
    expect(body.timezone).toBe("Europe/Warsaw");
  });

  it("returns Asia/Kolkata for a New Delhi pin", async () => {
    const res = await timezone(adminCookie, { latitude: 28.6139, longitude: 77.209 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { timezone: string | null };
    expect(body.timezone).toBe("Asia/Kolkata");
  });

  it("does not consume the Nominatim search rate-limit budget", async () => {
    const tzRes = await timezone(adminCookie, { latitude: 52.23, longitude: 21.01 });
    expect(tzRes.status).toBe(200);

    const searchRes = await search(adminCookie, { query: "After Timezone" });
    expect(searchRes.status).toBe(200);
  });

  it("returns 429 after the per-user timezone limit is exhausted", async () => {
    const userKey = `admin:geocoding-timezone:user:${adminId}`;
    for (let i = 0; i < 60; i++) {
      await rateLimitStore.hit(userKey, 60_000, 60);
    }

    const res = await timezone(adminCookie, { latitude: 52.23, longitude: 21.01 });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "geocoding_rate_limited" });
  });
});
