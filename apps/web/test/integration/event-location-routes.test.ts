import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import type { EventLocationDto } from "@admitto/location";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_LOC = "org-location";
const EVENT_LOC = "evt-location";
const EVENT_LOC_OTHER = "evt-location-other";
const EVENT_LOC_ARCHIVED = "evt-location-archived";

const EMAIL_ADMIN = "location-admin@example.com";
const EMAIL_OP = "location-op@example.com";
const EMAIL_SUPER = "location-super@example.com";
const PASSWORD = "location-test-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";
let superCookie = "";

async function seed(client: PrismaClient) {
  const fixtureEventIds = [EVENT_LOC, EVENT_LOC_OTHER, EVENT_LOC_ARCHIVED];
  await client.eventLocation.deleteMany({ where: { event_id: { in: fixtureEventIds } } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG_LOC } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_LOC, EVENT_LOC, EVENT_LOC_OTHER] } } });
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP, EMAIL_SUPER] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_SUPER] } } } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP, EMAIL_SUPER] } } });
  await client.event.deleteMany({ where: { id: { in: fixtureEventIds } } });
  await client.organization.deleteMany({ where: { id: ORG_LOC } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.create({ data: { id: ORG_LOC, name: "Location Org", slug: "location-org" } });
  await client.event.createMany({
    data: [
      {
        id: EVENT_LOC,
        title: "Location Event",
        slug: "location-event",
        date: new Date("2026-10-01"),
        organization_id: ORG_LOC,
      },
      {
        id: EVENT_LOC_OTHER,
        title: "Location Other Event",
        slug: "location-other-event",
        date: new Date("2026-10-02"),
        organization_id: ORG_LOC,
      },
      {
        id: EVENT_LOC_ARCHIVED,
        title: "Location Archived Event",
        slug: "location-archived-event",
        date: new Date("2026-10-03"),
        organization_id: ORG_LOC,
        archived_at: new Date(),
      },
    ],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_LOC },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_LOC },
    ],
  });

  // Instance-scope superadmin is a single global slot (partial unique index on scope_id IS
  // NULL — see schema.prisma RoleAssignment comment), shared across every integration test
  // file in this run. Reuse/retarget it instead of creating a second one (same pattern as
  // event-image-assets-routes.test.ts).
  const existingInstanceSuper = await client.roleAssignment.findFirst({
    where: { role: "superadmin", scope_type: "instance" },
    select: { id: true },
  });
  if (existingInstanceSuper) {
    await client.roleAssignment.update({
      where: { id: existingInstanceSuper.id },
      data: { user_id: superUser.id },
    });
  } else {
    await client.roleAssignment.create({
      data: { user_id: superUser.id, role: "superadmin", scope_type: "instance", scope_id: null },
    });
  }

  for (const userId of [adminId, superUser.id]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }

  return { superId: superUser.id };
}

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  const { superId } = await seed(prisma);
  app = createApp({
    prisma,
    checkinToken: "location-checkin-token-32-characters!",
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
  adminCookie = await sessionCookieFor(adminId);
  opCookie = await sessionCookieFor(opId);
  superCookie = await sessionCookieFor(superId);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await prisma.eventLocation.deleteMany({ where: { event_id: { in: [EVENT_LOC, EVENT_LOC_OTHER] } } });
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG_LOC } });
});

function putLocation(eventId: string, cookie: string, body: unknown) {
  return app.request(`/api/admin/events/${eventId}/location`, {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json", ...sameOrigin },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/events/:eventId/location", () => {
  it("returns 403 for operator (no manage access)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_LOC}/location`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for a non-existent event", async () => {
    const res = await app.request("/api/admin/events/evt-location-missing/location", {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(404);
  });

  it("returns a stable empty DTO for a fresh event with no EventLocation row", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_LOC_OTHER}/location`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body).toEqual({
      venue_name: null,
      formatted_address: null,
      latitude: null,
      longitude: null,
      map_zoom: 15,
      directions_text: null,
      accessibility_text: null,
      geocoding_provider: null,
      geocoded_at: null,
      address_components: null,
    });
  });

  it("returns the persisted row once one exists", async () => {
    await prisma.eventLocation.create({
      data: {
        event_id: EVENT_LOC_OTHER,
        formatted_address: "1 Example Street, Example City",
        latitude: 50.06,
        longitude: 19.94,
        map_zoom: 17,
        directions_text: "Enter via the north gate.",
        accessibility_text: "Step-free access from the car park.",
      },
    });
    const res = await app.request(`/api/admin/events/${EVENT_LOC_OTHER}/location`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body).toMatchObject({
      formatted_address: "1 Example Street, Example City",
      latitude: 50.06,
      longitude: 19.94,
      map_zoom: 17,
      directions_text: "Enter via the north gate.",
      accessibility_text: "Step-free access from the car park.",
      geocoding_provider: null,
      geocoded_at: null,
    });
  });
});

describe("PUT /api/admin/events/:eventId/location", () => {
  it("returns 400 on malformed JSON", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_LOC}/location`, {
      method: "PUT",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for operator (no manage access)", async () => {
    const res = await putLocation(EVENT_LOC, opCookie, { formatted_address: "Somewhere" });
    expect(res.status).toBe(403);
  });

  it("returns 404 for a non-existent event", async () => {
    const res = await putLocation("evt-location-missing", superCookie, { formatted_address: "Somewhere" });
    expect(res.status).toBe(404);
  });

  it("returns 403 event_archived for an archived event", async () => {
    const res = await putLocation(EVENT_LOC_ARCHIVED, adminCookie, { formatted_address: "Somewhere" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
  });

  it("rejects an unknown field (strict schema)", async () => {
    const res = await putLocation(EVENT_LOC, adminCookie, { unknown_field: "nope" });
    expect(res.status).toBe(400);
  });

  it("rejects a wrong field type", async () => {
    const res = await putLocation(EVENT_LOC, adminCookie, { latitude: "not-a-number" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty patch (no fields to change)", async () => {
    const res = await putLocation(EVENT_LOC, adminCookie, {});
    expect(res.status).toBe(400);
  });

  it.each([
    ["latitude too high", { latitude: 91, longitude: 19 }],
    ["latitude too low", { latitude: -91, longitude: 19 }],
    ["longitude too high", { latitude: 50, longitude: 181 }],
    ["longitude too low", { latitude: 50, longitude: -181 }],
    ["only latitude set", { latitude: 50 }],
    ["only longitude set", { longitude: 19 }],
    ["zoom too low", { map_zoom: 0 }],
    ["zoom too high", { map_zoom: 20 }],
    ["zoom not an integer", { map_zoom: 15.5 }],
    ["venue_name too long", { venue_name: "a".repeat(301) }],
    ["formatted_address too long", { formatted_address: "a".repeat(501) }],
    ["directions_text too long", { directions_text: "a".repeat(2001) }],
    ["accessibility_text too long", { accessibility_text: "a".repeat(2001) }],
    ["address components is not an object", { address_components: "not-an-address" }],
    ["address components has an unknown field", { address_components: { city: "Kraków", extra: "nope" } }],
    ["address components contains a non-string field", { address_components: { city: 123 } }],
  ])("rejects invalid input: %s", async (_label, patch) => {
    const res = await putLocation(EVENT_LOC, adminCookie, patch);
    expect(res.status).toBe(400);
  });

  it("persists and clears address_components", async () => {
    const components = {
      object_name: "ICE Kraków",
      street: "Marii Konopnickiej 17",
      postcode: "30-302",
      city: "Kraków",
      region: "Lesser Poland",
      country: "Poland",
    };
    const res = await putLocation(EVENT_LOC, adminCookie, { address_components: components });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body.address_components).toEqual(components);

    const cleared = await putLocation(EVENT_LOC, adminCookie, { address_components: null });
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as EventLocationDto;
    expect(clearedBody.address_components).toBeNull();
  });

  it("creates a new row with all fields on first save", async () => {
    const res = await putLocation(EVENT_LOC, adminCookie, {
      venue_name: "ICE Kraków Congress Centre",
      formatted_address: "1 Example Street, Example City",
      latitude: 50.06,
      longitude: 19.94,
      map_zoom: 17,
      directions_text: "Enter via the north gate.",
      accessibility_text: "Step-free access from the car park.",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body).toMatchObject({
      venue_name: "ICE Kraków Congress Centre",
      formatted_address: "1 Example Street, Example City",
      latitude: 50.06,
      longitude: 19.94,
      map_zoom: 17,
      directions_text: "Enter via the north gate.",
      accessibility_text: "Step-free access from the car park.",
    });

    const row = await prisma.eventLocation.findUnique({ where: { event_id: EVENT_LOC } });
    expect(row?.formatted_address).toBe("1 Example Street, Example City");
    expect(row?.venue_name).toBe("ICE Kraków Congress Centre");
  });

  it("applies a default zoom of 15 when map_zoom is omitted on create", async () => {
    const res = await putLocation(EVENT_LOC, adminCookie, { formatted_address: "No zoom given" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body.map_zoom).toBe(15);
  });

  it("partially updates a field, leaving the rest unchanged", async () => {
    await prisma.eventLocation.create({
      data: {
        event_id: EVENT_LOC,
        venue_name: "Original Venue",
        formatted_address: "Original address",
        latitude: 50.06,
        longitude: 19.94,
        directions_text: "Original directions",
      },
    });

    const res = await putLocation(EVENT_LOC, adminCookie, { directions_text: "Updated directions" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body).toMatchObject({
      venue_name: "Original Venue",
      formatted_address: "Original address",
      latitude: 50.06,
      longitude: 19.94,
      directions_text: "Updated directions",
    });
  });

  it("clears venue_name via null", async () => {
    await prisma.eventLocation.create({
      data: { event_id: EVENT_LOC, venue_name: "Will be cleared" },
    });

    const res = await putLocation(EVENT_LOC, adminCookie, { venue_name: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body.venue_name).toBeNull();
  });

  it("clears venue_name via an empty string", async () => {
    await prisma.eventLocation.create({
      data: { event_id: EVENT_LOC, venue_name: "Will be cleared" },
    });

    const res = await putLocation(EVENT_LOC, adminCookie, { venue_name: "   " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body.venue_name).toBeNull();
  });

  it("clears a text field via null", async () => {
    await prisma.eventLocation.create({
      data: { event_id: EVENT_LOC, directions_text: "Will be cleared" },
    });

    const res = await putLocation(EVENT_LOC, adminCookie, { directions_text: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body.directions_text).toBeNull();
  });

  it("clears a text field via an empty string", async () => {
    await prisma.eventLocation.create({
      data: { event_id: EVENT_LOC, accessibility_text: "Will be cleared" },
    });

    const res = await putLocation(EVENT_LOC, adminCookie, { accessibility_text: "   " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body.accessibility_text).toBeNull();
  });

  it("resets map_zoom to the default (15) when explicitly set to null", async () => {
    await prisma.eventLocation.create({
      data: { event_id: EVENT_LOC, map_zoom: 19 },
    });

    const res = await putLocation(EVENT_LOC, adminCookie, { map_zoom: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body.map_zoom).toBe(15);
  });

  it("rejects clearing one coordinate while the other stays set (merged pairing check)", async () => {
    await prisma.eventLocation.create({
      data: { event_id: EVENT_LOC, latitude: 50.06, longitude: 19.94 },
    });

    const res = await putLocation(EVENT_LOC, adminCookie, { latitude: null });
    expect(res.status).toBe(400);
  });

  it("clears both coordinates together", async () => {
    await prisma.eventLocation.create({
      data: { event_id: EVENT_LOC, latitude: 50.06, longitude: 19.94 },
    });

    const res = await putLocation(EVENT_LOC, adminCookie, { latitude: null, longitude: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventLocationDto;
    expect(body.latitude).toBeNull();
    expect(body.longitude).toBeNull();
  });

  it("writes an event_location_updated admin audit log entry with the changed field names", async () => {
    const res = await putLocation(EVENT_LOC, adminCookie, {
      venue_name: "Audited Venue",
      formatted_address: "Audited address",
      map_zoom: 12,
    });
    expect(res.status).toBe(200);

    const entries = await prisma.adminAuditLog.findMany({
      where: { organization_id: ORG_LOC, action_type: "event_location_updated" },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actor_user_id).toBe(adminId);
    expect(entries[0]?.metadata).toMatchObject({
      eventId: EVENT_LOC,
      fields: expect.arrayContaining(["venue_name", "formatted_address", "map_zoom"]),
    });
  });

  describe("geocoding provenance (geocoding_provider / geocoded_at)", () => {
    it("stamps geocoding_provider and geocoded_at when coordinates arrive with a provider", async () => {
      const res = await putLocation(EVENT_LOC, adminCookie, {
        latitude: 50.06,
        longitude: 19.94,
        geocoding_provider: "nominatim",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventLocationDto;
      expect(body.geocoding_provider).toBe("nominatim");
      expect(body.geocoded_at).not.toBeNull();
      expect(new Date(body.geocoded_at ?? "").getTime()).not.toBeNaN();
    });

    it("clears geocoding_provider and geocoded_at when coordinates change without a provider (manual drag)", async () => {
      await prisma.eventLocation.create({
        data: {
          event_id: EVENT_LOC,
          latitude: 50.06,
          longitude: 19.94,
          geocoding_provider: "nominatim",
          geocoded_at: new Date(),
        },
      });

      const res = await putLocation(EVENT_LOC, adminCookie, { latitude: 50.07, longitude: 19.95 });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventLocationDto;
      expect(body.geocoding_provider).toBeNull();
      expect(body.geocoded_at).toBeNull();
    });

    it("clears geocoding_provider and geocoded_at when coordinates are cleared entirely", async () => {
      await prisma.eventLocation.create({
        data: {
          event_id: EVENT_LOC,
          latitude: 50.06,
          longitude: 19.94,
          geocoding_provider: "nominatim",
          geocoded_at: new Date(),
        },
      });

      const res = await putLocation(EVENT_LOC, adminCookie, { latitude: null, longitude: null });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventLocationDto;
      expect(body.geocoding_provider).toBeNull();
      expect(body.geocoded_at).toBeNull();
    });

    it("leaves geocoding_provider and geocoded_at untouched when coordinates are not part of the patch", async () => {
      const created = await prisma.eventLocation.create({
        data: {
          event_id: EVENT_LOC,
          latitude: 50.06,
          longitude: 19.94,
          geocoding_provider: "nominatim",
          geocoded_at: new Date("2026-01-01T00:00:00.000Z"),
        },
      });

      const res = await putLocation(EVENT_LOC, adminCookie, { directions_text: "Updated directions" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventLocationDto;
      expect(body.geocoding_provider).toBe("nominatim");
      expect(body.geocoded_at).toBe(created.geocoded_at?.toISOString());
    });

    it("clears geocoding_provider when explicitly null without a coordinate change (venue rename)", async () => {
      await prisma.eventLocation.create({
        data: {
          event_id: EVENT_LOC,
          venue_name: "Old Hall",
          latitude: 50.06,
          longitude: 19.94,
          geocoding_provider: "nominatim",
          geocoded_at: new Date("2026-01-01T00:00:00.000Z"),
        },
      });

      const res = await putLocation(EVENT_LOC, adminCookie, {
        venue_name: "New Hall",
        geocoding_provider: null,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventLocationDto;
      expect(body.venue_name).toBe("New Hall");
      expect(body.latitude).toBe(50.06);
      expect(body.geocoding_provider).toBeNull();
      expect(body.geocoded_at).toBeNull();
    });

    it("treats a blank geocoding_provider the same as omitting it (clears provenance)", async () => {
      await prisma.eventLocation.create({
        data: {
          event_id: EVENT_LOC,
          latitude: 50.06,
          longitude: 19.94,
          geocoding_provider: "nominatim",
          geocoded_at: new Date(),
        },
      });

      const res = await putLocation(EVENT_LOC, adminCookie, {
        latitude: 50.08,
        longitude: 19.96,
        geocoding_provider: "   ",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventLocationDto;
      expect(body.geocoding_provider).toBeNull();
      expect(body.geocoded_at).toBeNull();
    });

    it("includes geocoding_provider in the audit log's changed fields when coordinates change", async () => {
      const res = await putLocation(EVENT_LOC, adminCookie, {
        latitude: 50.06,
        longitude: 19.94,
        geocoding_provider: "nominatim",
      });
      expect(res.status).toBe(200);

      const entries = await prisma.adminAuditLog.findMany({
        where: { organization_id: ORG_LOC, action_type: "event_location_updated" },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.metadata).toMatchObject({
        fields: expect.arrayContaining(["latitude", "longitude", "geocoding_provider"]),
      });
    });
  });
});
