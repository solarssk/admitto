import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { createAdminAndOp } from "../helpers/seed-org-and-event.js";
import { bootSingleOrgFixture } from "../helpers/boot-single-org-fixture.js";
import { acquireEventCustomFieldsLock } from "../../src/admin/event-custom-fields-routes.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_CF = "org-custom-fields";
const EVENT_CF = "evt-custom-fields";
const EVENT_CF_OTHER = "evt-custom-fields-other";
// The registration form's fields (0.8): one event for order and reorder tests, three that differ
// only in their registration settings (a mode, a settings row with mode null, an archived event).
const EVENT_CF_ORDER = "evt-custom-fields-order";
const EVENT_CF_REG = "evt-custom-fields-registration";
const EVENT_CF_REG_OFF = "evt-custom-fields-registration-off";
const EVENT_CF_ARCHIVED = "evt-custom-fields-archived";

const EMAIL_ADMIN = "custom-fields-admin@example.com";
const EMAIL_OP = "custom-fields-op@example.com";
const PASSWORD = "custom-fields-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";

// The 422/lock-race tests each create their own event with a fixed id rather than reusing
// EVENT_CF/EVENT_CF_OTHER, and delete it at the end of the test - include those ids here too so
// an aborted run (which skips that cleanup) doesn't leave orphaned rows breaking the next run's
// prisma.event.create with a unique-constraint error.
const EXTRA_FIXTURE_EVENT_IDS = [
  "evt-custom-fields-limit",
  "evt-custom-fields-lock-race",
  EVENT_CF_ORDER,
  EVENT_CF_REG,
  EVENT_CF_REG_OFF,
  EVENT_CF_ARCHIVED,
];

async function seed(client: PrismaClient) {
  const fixtureEventIds = [EVENT_CF, EVENT_CF_OTHER, ...EXTRA_FIXTURE_EVENT_IDS];
  // Attendee has an FK to Event, so this must run before the event.deleteMany below.
  await client.attendee.deleteMany({ where: { event_id: { in: fixtureEventIds } } });
  await client.eventItem.deleteMany({ where: { event_id: { in: fixtureEventIds } } });
  await client.eventCustomField.deleteMany({ where: { event_id: { in: fixtureEventIds } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_CF, EVENT_CF, EVENT_CF_OTHER] } } });
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: EMAIL_ADMIN } } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: fixtureEventIds } } });
  await client.organization.deleteMany({ where: { id: ORG_CF } });

  const password_hash = await hashPassword(PASSWORD);
  await client.organization.create({ data: { id: ORG_CF, name: "Custom Fields Org", slug: "custom-fields-org" } });
  await client.event.createMany({
    data: [
      {
        id: EVENT_CF,
        title: "Custom Fields Event",
        slug: "custom-fields-event",
        date: new Date("2026-10-01"),
        organization_id: ORG_CF,
      },
      {
        id: EVENT_CF_OTHER,
        title: "Custom Fields Other Event",
        slug: "custom-fields-other-event",
        date: new Date("2026-10-02"),
        organization_id: ORG_CF,
      },
      {
        id: EVENT_CF_ORDER,
        title: "Custom Fields Order Event",
        slug: "custom-fields-order-event",
        date: new Date("2026-10-03"),
        organization_id: ORG_CF,
      },
      {
        id: EVENT_CF_REG,
        title: "Custom Fields Registration Event",
        slug: "custom-fields-registration-event",
        date: new Date("2026-10-04"),
        organization_id: ORG_CF,
      },
      {
        id: EVENT_CF_REG_OFF,
        title: "Custom Fields Registration Off Event",
        slug: "custom-fields-registration-off-event",
        date: new Date("2026-10-05"),
        organization_id: ORG_CF,
      },
      {
        id: EVENT_CF_ARCHIVED,
        title: "Custom Fields Archived Event",
        slug: "custom-fields-archived-event",
        date: new Date("2026-10-06"),
        archived_at: new Date("2026-10-07"),
        organization_id: ORG_CF,
      },
    ],
  });
  // Registration is on for EVENT_CF_REG only. EVENT_CF_REG_OFF has a settings row whose mode is
  // null (off), and every other event has no row at all: both must behave as before the form.
  await client.eventRegistrationSettings.createMany({
    data: [
      { event_id: EVENT_CF_REG, mode: "automatic", access_methods: ["link"] },
      { event_id: EVENT_CF_REG_OFF, mode: null },
    ],
  });

  ({ adminId, opId } = await createAdminAndOp(client, { adminEmail: EMAIL_ADMIN, opEmail: EMAIL_OP, passwordHash: password_hash, orgId: ORG_CF, eventId: EVENT_CF }));

  await enrollConfirmedTotp(client, adminId);
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);
  ({ app, adminCookie, opCookie } = await bootSingleOrgFixture({ prisma, adminId, opId, checkinToken: "custom-fields-checkin-token-32-chr!", adminDistRoot }));
});

afterAll(async () => {
  // The registration settings rows are instance-wide state (the Health check counts them): leave none behind.
  await prisma?.eventRegistrationSettings.deleteMany({ where: { event_id: { in: [EVENT_CF_REG, EVENT_CF_REG_OFF] } } });
  await prisma?.$disconnect();
});

describe("GET /api/admin/events/:eventId/custom-fields", () => {
  it("returns 403 for operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns empty list for a fresh event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF_OTHER}/custom-fields`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("resolves same-created_at ties by ascending id, not query-plan-dependent scan order", async () => {
    // A single createMany statement evaluates now() once, so every row below shares the same
    // created_at - the scenario the (created_at, id) tiebreaker in handleListEventCustomFields
    // exists for.
    await prisma.eventCustomField.createMany({
      data: [
        { event_id: EVENT_CF_OTHER, source_field: "field_c", label: "Field C" },
        { event_id: EVENT_CF_OTHER, source_field: "field_a", label: "Field A" },
        { event_id: EVENT_CF_OTHER, source_field: "field_b", label: "Field B" },
      ],
    });
    const created = await prisma.eventCustomField.findMany({ where: { event_id: EVENT_CF_OTHER } });
    const timestamps = new Set(created.map((row) => row.created_at.getTime()));
    expect(timestamps.size).toBe(1); // sanity check: the tie scenario is actually exercised

    const expectedOrder = [...created].sort((a, b) => (a.id < b.id ? -1 : 1)).map((row) => row.source_field);

    const res = await app.request(`/api/admin/events/${EVENT_CF_OTHER}/custom-fields`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { source_field: string }[] };
    expect(body.items.map((item) => item.source_field)).toEqual(expectedOrder);

    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_CF_OTHER } });
  });
});

describe("POST /api/admin/events/:eventId/custom-fields", () => {
  it("rejects malformed JSON body", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid json");
  });

  it("creates a field and audits without PII", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ source_field: "dietary", label: "Dietary requirements" }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { source_field: string; label: string; type: string; required: boolean; options: string[] | null };
    expect(row.source_field).toBe("dietary");
    expect(row.type).toBe("text");
    expect(row.required).toBe(false);
    expect(row.options).toBeNull();

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_CF, action_type: "event_custom_field_created" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.attendee_id).toBeNull();
    expect(log?.metadata).toEqual({ source_field: "dietary" });
  });

  it("creates a field with a description, distinct from its label", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        source_field: "shirt_size_desc",
        label: "Shirt size",
        description: "Attendee's t-shirt size for the swag bag",
      }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { label: string; description: string | null };
    expect(row.label).toBe("Shirt size");
    expect(row.description).toBe("Attendee's t-shirt size for the swag bag");
  });

  it("defaults description to null when omitted", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ source_field: "no_description", label: "No description" }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { description: string | null };
    expect(row.description).toBeNull();
  });

  it("rejects a description over 500 characters", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        source_field: "too_long_desc",
        label: "Too long",
        description: "x".repeat(501),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("creates a select field with options and required", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        source_field: "shirt_size",
        label: "Shirt size",
        type: "select",
        required: true,
        options: ["S", "M", "L"],
      }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { type: string; required: boolean; options: string[] | null };
    expect(row.type).toBe("select");
    expect(row.required).toBe(true);
    expect(row.options).toEqual(["S", "M", "L"]);
  });

  it("rejects select type without options", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ source_field: "no_options", label: "No options", type: "select" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects the reserved not-answered sentinel as a select option value", async () => {
    // Must never collide with the Custom fields report's own "not answered" bucket key
    // (CUSTOM_FIELD_NOT_ANSWERED_KEY, packages/shared/src/eventCustomFieldReportsDto.ts).
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        source_field: "reserved_option",
        label: "Reserved option",
        type: "select",
        options: ["S", "__not_answered__"],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid source_field slug", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ source_field: "Bad-Slug", label: "Bad" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a source_field reserved for a first-class import column", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ source_field: "email", label: "Email copy" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 source_field_conflict on duplicate within the same event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ source_field: "dietary", label: "Dietary (dup)" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("source_field_conflict");
  });

  it("returns 422 once the per-event field limit is reached", async () => {
    const seedEventId = "evt-custom-fields-limit";
    await prisma.event.create({
      data: {
        id: seedEventId,
        title: "Limit event",
        slug: "custom-fields-limit-event",
        date: new Date("2026-10-05"),
        organization_id: ORG_CF,
      },
    });
    await prisma.eventCustomField.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        event_id: seedEventId,
        source_field: `field_${i}`,
        label: `Field ${i}`,
      })),
    });

    const res = await app.request(`/api/admin/events/${seedEventId}/custom-fields`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ source_field: "one_too_many", label: "One too many" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; limit: number };
    expect(body.error).toBe("field_limit_reached");
    expect(body.limit).toBe(20);

    await prisma.event.delete({ where: { id: seedEventId } });
  });

  // Genuinely concurrent requests (no mocking) at the cap boundary - the two transactions'
  // pg_advisory_xact_lock acquisitions serialize them, so exactly one of the pair must win
  // regardless of network/Node scheduling (mirrors event-image-assets-routes.test.ts's identical
  // advisory-lock race test).
  it("never exceeds the cap under two genuinely concurrent creates at the boundary (advisory lock)", async () => {
    const seedEventId = "evt-custom-fields-lock-race";
    await prisma.event.create({
      data: {
        id: seedEventId,
        title: "Lock race event",
        slug: "custom-fields-lock-race-event",
        date: new Date("2026-10-06"),
        organization_id: ORG_CF,
      },
    });
    await prisma.eventCustomField.createMany({
      data: Array.from({ length: 19 }, (_, i) => ({
        event_id: seedEventId,
        source_field: `lockrace_seed_${i}`,
        label: `Seed ${i}`,
      })),
    });

    const [resA, resB] = await Promise.all([
      app.request(`/api/admin/events/${seedEventId}/custom-fields`, {
        method: "POST",
        headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ source_field: "lockrace_a", label: "Lock race A" }),
      }),
      app.request(`/api/admin/events/${seedEventId}/custom-fields`, {
        method: "POST",
        headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ source_field: "lockrace_b", label: "Lock race B" }),
      }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 422]);

    const finalCount = await prisma.eventCustomField.count({ where: { event_id: seedEventId } });
    expect(finalCount).toBe(20);

    await prisma.event.delete({ where: { id: seedEventId } });
  });

  it("returns 403 for cross-event admin scope", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CF_OTHER}/custom-fields`, {
      method: "POST",
      headers: { Cookie: opCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ source_field: "x", label: "X" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/events/:eventId/custom-fields/:fieldId", () => {
  it("rejects malformed JSON body", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF, source_field: "bad_json_patch", label: "Bad json patch" },
    });
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid json");
  });

  it("updates label, type, required, and options - source_field is immutable", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF, source_field: "parking", label: "Parking" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({
        label: "Needs parking",
        type: "boolean",
        required: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source_field: string;
      label: string;
      type: string;
      required: boolean;
    };
    expect(body.source_field).toBe("parking");
    expect(body.label).toBe("Needs parking");
    expect(body.type).toBe("boolean");
    expect(body.required).toBe(true);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_CF, action_type: "event_custom_field_updated" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.metadata).toEqual({ source_field: "parking" });
  });

  it("rejects the reserved not-answered sentinel as a select option value", async () => {
    const created = await prisma.eventCustomField.create({
      data: {
        event_id: EVENT_CF,
        source_field: "patch_reserved_option",
        label: "Patch reserved option",
        type: "select",
        options: ["S", "M"],
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ options: ["S", "__not_answered__"] }),
    });
    expect(res.status).toBe(400);
  });

  it("sets and then clears a field's description (explicit null)", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF, source_field: "parking_desc", label: "Parking" },
    });

    const setRes = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ description: "Does the attendee need a parking spot?" }),
    });
    expect(setRes.status).toBe(200);
    const setBody = (await setRes.json()) as { description: string | null };
    expect(setBody.description).toBe("Does the attendee need a parking spot?");

    const clearRes = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ description: null }),
    });
    expect(clearRes.status).toBe(200);
    const clearBody = (await clearRes.json()) as { description: string | null };
    expect(clearBody.description).toBeNull();
  });

  it("leaves description untouched when the PATCH omits the key", async () => {
    const created = await prisma.eventCustomField.create({
      data: {
        event_id: EVENT_CF,
        source_field: "untouched_desc",
        label: "Untouched",
        description: "Original description",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "Renamed" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { description: string | null };
    expect(body.description).toBe("Original description");
  });

  it("clears stored options when switching away from select (explicit null)", async () => {
    const created = await prisma.eventCustomField.create({
      data: {
        event_id: EVENT_CF,
        source_field: "shirt_size_patch",
        label: "Shirt size",
        type: "select",
        options: ["S", "M", "L"],
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ type: "text", options: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; options: string[] | null };
    expect(body.type).toBe("text");
    expect(body.options).toBeNull();

    const row = await prisma.eventCustomField.findUnique({ where: { id: created.id } });
    expect(row?.options).toBeNull();
  });

  it("rejects source_field in the PATCH body (unknown key, strict schema)", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF, source_field: "license_plate", label: "License plate" },
    });
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ source_field: "renamed" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a field belonging to a different event", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_OTHER, source_field: "other_field", label: "Other" },
    });
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ label: "Hijacked" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/events/:eventId/custom-fields/:fieldId/option-usage", () => {
  it("returns 403 for operator", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF, source_field: "usage_op", label: "Usage", type: "select", options: ["S", "M"] },
    });
    const res = await app.request(
      `/api/admin/events/${EVENT_CF}/custom-fields/${created.id}/option-usage`,
      { headers: { Cookie: opCookie } },
    );
    expect(res.status).toBe(403);
  });

  it("groups attendees by their current custom_data value", async () => {
    const created = await prisma.eventCustomField.create({
      data: {
        event_id: EVENT_CF,
        source_field: "usage_shirt",
        label: "Shirt size",
        type: "select",
        options: ["S", "M", "L"],
      },
    });
    await prisma.attendee.createMany({
      data: [
        { event_id: EVENT_CF, email: "usage1@example.com", name: "Usage One", custom_data: { usage_shirt: "M" } },
        { event_id: EVENT_CF, email: "usage2@example.com", name: "Usage Two", custom_data: { usage_shirt: "M" } },
        { event_id: EVENT_CF, email: "usage3@example.com", name: "Usage Three", custom_data: { usage_shirt: "S" } },
        // No usage_shirt at all - must not be counted as any value.
        { event_id: EVENT_CF, email: "usage4@example.com", name: "Usage Four", custom_data: { other_field: "x" } },
      ],
    });

    const res = await app.request(
      `/api/admin/events/${EVENT_CF}/custom-fields/${created.id}/option-usage`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: Record<string, number> };
    expect(body.counts).toEqual({ M: 2, S: 1 });
    // "L" has zero attendees - simply absent, not present with a 0.
    expect(body.counts.L).toBeUndefined();
  });

  it("never counts an attendee from a different event", async () => {
    const created = await prisma.eventCustomField.create({
      data: {
        event_id: EVENT_CF,
        source_field: "usage_isolated",
        label: "Isolated",
        type: "select",
        options: ["A"],
      },
    });
    await prisma.attendee.create({
      data: { event_id: EVENT_CF_OTHER, email: "usage-other@example.com", name: "Other Event", custom_data: { usage_isolated: "A" } },
    });

    const res = await app.request(
      `/api/admin/events/${EVENT_CF}/custom-fields/${created.id}/option-usage`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: Record<string, number> };
    expect(body.counts).toEqual({});
  });

  it("rejects a non-select field", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF, source_field: "usage_text", label: "Text field" },
    });
    const res = await app.request(
      `/api/admin/events/${EVENT_CF}/custom-fields/${created.id}/option-usage`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 for a field belonging to a different event", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_OTHER, source_field: "usage_other_evt", label: "Other", type: "select", options: ["A"] },
    });
    const res = await app.request(
      `/api/admin/events/${EVENT_CF}/custom-fields/${created.id}/option-usage`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/events/:eventId/custom-fields/:fieldId", () => {
  it("deletes an unreferenced field", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF, source_field: "to_delete", label: "To delete" },
    });
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const deleted = await prisma.eventCustomField.findUnique({ where: { id: created.id } });
    expect(deleted).toBeNull();
  });

  it("returns 409 field_in_use while an EventItem still references the field", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF, source_field: "in_use_field", label: "In use" },
    });
    await prisma.eventItem.create({
      data: {
        event_id: EVENT_CF,
        key: "giftbag_cf",
        label: "Gift bag",
        config: { content_fields: ["in_use_field"] },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("field_in_use");

    const stillThere = await prisma.eventCustomField.findUnique({ where: { id: created.id } });
    expect(stillThere).not.toBeNull();

    // Once the item no longer references it, deletion proceeds.
    await prisma.eventItem.update({
      where: { event_id_key: { event_id: EVENT_CF, key: "giftbag_cf" } },
      data: { config: { content_fields: [] } },
    });
    const retryRes = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(retryRes.status).toBe(200);
  });

  it("returns 403 for a field belonging to a different event", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_OTHER, source_field: "cross_event_delete", label: "Cross event" },
    });
    const res = await app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  // Genuinely concurrent delete + item-attach race (no mocking) - both handlers take the same
  // per-event advisory lock before their respective check+commit, so whichever acquires it first
  // fully commits before the other's check runs. The invariant that must hold regardless of which
  // one wins: never end up with the field deleted AND an item's content_fields still pointing at
  // it (the dangling-reference bug this closes; mirrors event-image-assets-routes.test.ts's
  // delete-vs-template-save race test).
  it("never leaves an item referencing a deleted custom field when delete and attach race (advisory lock)", async () => {
    const field = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF, source_field: "race_attach_field", label: "Race attach" },
    });
    const item = await prisma.eventItem.create({
      data: { event_id: EVENT_CF, key: "giftbag_race", label: "Gift bag race" },
    });

    const [deleteRes, patchRes] = await Promise.all([
      app.request(`/api/admin/events/${EVENT_CF}/custom-fields/${field.id}`, {
        method: "DELETE",
        headers: { Cookie: adminCookie, ...sameOrigin },
      }),
      app.request(`/api/admin/events/${EVENT_CF}/items/${item.id}`, {
        method: "PATCH",
        headers: { Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin },
        body: JSON.stringify({ config: { content_fields: ["race_attach_field"] } }),
      }),
    ]);

    // Require exactly one winner and one loser - both-succeeded is the invariant this test
    // guards, but both-failed would trivially satisfy that same check without proving the race
    // was actually serialized.
    const statuses = [deleteRes.status, patchRes.status];
    expect(statuses.filter((status) => status >= 200 && status < 300)).toHaveLength(1);
    expect(statuses.filter((status) => status >= 400 && status < 500)).toHaveLength(1);

    const fieldStillExists = await prisma.eventCustomField.findUnique({ where: { id: field.id } });
    const finalItem = await prisma.eventItem.findUnique({ where: { id: item.id } });
    const finalContentFields =
      (finalItem?.config as { content_fields?: string[] } | null)?.content_fields ?? [];
    const danglingReference = fieldStillExists === null && finalContentFields.includes("race_attach_field");
    expect(danglingReference).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The registration form's two columns: show_on_form and display_order (v0.8).
// ---------------------------------------------------------------------------------------------

type FieldItem = {
  id: string;
  source_field: string;
  label: string;
  required: boolean;
  show_on_form: boolean;
  display_order: number | null;
};

const jsonAdmin = () => ({ Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin });

async function listItems(eventId: string): Promise<FieldItem[]> {
  const res = await app.request(`/api/admin/events/${eventId}/custom-fields`, { headers: { Cookie: adminCookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: FieldItem[] }).items;
}

function createField(eventId: string, body: Record<string, unknown>): Promise<Response> {
  return Promise.resolve(
    app.request(`/api/admin/events/${eventId}/custom-fields`, {
      method: "POST",
      headers: jsonAdmin(),
      body: JSON.stringify({ label: `Field ${String(body.source_field)}`, ...body }),
    }),
  );
}

function patchField(eventId: string, fieldId: string, body: Record<string, unknown>): Promise<Response> {
  return Promise.resolve(
    app.request(`/api/admin/events/${eventId}/custom-fields/${fieldId}`, {
      method: "PATCH",
      headers: jsonAdmin(),
      body: JSON.stringify(body),
    }),
  );
}

function reorder(eventId: string, ids: unknown, headers: Record<string, string> = jsonAdmin()): Promise<Response> {
  return Promise.resolve(
    app.request(`/api/admin/events/${eventId}/custom-fields/order`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ids }),
    }),
  );
}

/** Replaces the event's fields with ones named by `slugs`, created one minute apart in that order. */
async function seedFields(eventId: string, slugs: readonly string[]): Promise<Map<string, string>> {
  await prisma.eventCustomField.deleteMany({ where: { event_id: eventId } });
  const start = Date.UTC(2026, 0, 1);
  await prisma.eventCustomField.createMany({
    data: slugs.map((slug, index) => ({
      event_id: eventId,
      source_field: slug,
      label: `Field ${slug}`,
      created_at: new Date(start + index * 60_000),
    })),
  });
  const rows = await prisma.eventCustomField.findMany({ where: { event_id: eventId } });
  return new Map(rows.map((row) => [row.source_field, row.id]));
}

function idsOf(fields: Map<string, string>, slugs: readonly string[]): string[] {
  return slugs.map((slug) => {
    const id = fields.get(slug);
    if (!id) throw new Error(`no seeded field ${slug}`);
    return id;
  });
}

const slugsOf = (items: readonly FieldItem[]) => items.map((item) => item.source_field);
const positionsOf = (items: readonly FieldItem[]) => items.map((item) => item.display_order);

async function reorderLogCount(eventId: string): Promise<number> {
  return prisma.attendeeActionLog.count({ where: { event_id: eventId, action_type: "event_custom_fields_reordered" } });
}

/** The registration-form tests start from an event with no fields and no reorder in its audit log. */
async function resetFormFixtures(): Promise<void> {
  await prisma.eventCustomField.deleteMany({ where: { event_id: { in: [EVENT_CF_ORDER, EVENT_CF_REG, EVENT_CF_REG_OFF] } } });
  await prisma.attendeeActionLog.deleteMany({ where: { event_id: EVENT_CF_ORDER } });
}

describe("the order of the field list", () => {
  beforeEach(resetFormFixtures);

  it("lists fields by display_order, those without one after them (oldest first), and shows both new columns", async () => {
    const start = Date.UTC(2026, 0, 1);
    await prisma.eventCustomField.createMany({
      data: [
        { event_id: EVENT_CF_ORDER, source_field: "late_placed", label: "Late placed", display_order: 1, created_at: new Date(start + 5 * 60_000) },
        { event_id: EVENT_CF_ORDER, source_field: "unplaced_new", label: "Unplaced new", created_at: new Date(start + 4 * 60_000) },
        { event_id: EVENT_CF_ORDER, source_field: "early_placed", label: "Early placed", display_order: 0, show_on_form: true, created_at: new Date(start + 6 * 60_000) },
        { event_id: EVENT_CF_ORDER, source_field: "unplaced_old", label: "Unplaced old", created_at: new Date(start + 3 * 60_000) },
      ],
    });

    const items = await listItems(EVENT_CF_ORDER);

    expect(slugsOf(items)).toEqual(["early_placed", "late_placed", "unplaced_old", "unplaced_new"]);
    expect(positionsOf(items)).toEqual([0, 1, null, null]);
    expect(items.map((item) => item.show_on_form)).toEqual([true, false, false, false]);
  });

  it("lists the same order as the custom-fields report and its CSV export", async () => {
    const fields = await seedFields(EVENT_CF_ORDER, ["alpha", "bravo", "charlie"]);
    const wanted = ["charlie", "alpha", "bravo"];
    expect((await reorder(EVENT_CF_ORDER, idsOf(fields, wanted))).status).toBe(200);

    expect(slugsOf(await listItems(EVENT_CF_ORDER))).toEqual(wanted);

    const report = await app.request(`/api/admin/events/${EVENT_CF_ORDER}/reports/custom-fields`, {
      headers: { Cookie: adminCookie },
    });
    expect(report.status).toBe(200);
    const reportBody = (await report.json()) as { fields: { source_field: string }[] };
    expect(reportBody.fields.map((field) => field.source_field)).toEqual(wanted);

    const csv = await app.request(`/api/admin/events/${EVENT_CF_ORDER}/reports/export?format=csv&report=customfields`, {
      headers: { Cookie: adminCookie },
    });
    expect(csv.status).toBe(200);
    const header = (await csv.text()).replace(/^\uFEFF/, "").split("\r\n")[0];
    expect(header).toBe('"Name","Email","Ticket type","Field charlie","Field alpha","Field bravo"');
  });
});

describe("show_on_form on create and update", () => {
  beforeEach(resetFormFixtures);

  it("is off and unplaced for a field created without it, as every field was before the form", async () => {
    const res = await createField(EVENT_CF_ORDER, { source_field: "plain" });
    expect(res.status).toBe(201);
    const row = (await res.json()) as FieldItem;
    expect(row.show_on_form).toBe(false);
    expect(row.display_order).toBeNull();
  });

  it("is on for a field created with show_on_form true, which the Registration page sends", async () => {
    const res = await createField(EVENT_CF_ORDER, { source_field: "asked", show_on_form: true });
    expect(res.status).toBe(201);
    expect(((await res.json()) as FieldItem).show_on_form).toBe(true);
    expect((await prisma.eventCustomField.findFirstOrThrow({ where: { event_id: EVENT_CF_ORDER } })).show_on_form).toBe(true);
  });

  it("refuses a show_on_form that is not a boolean, and a display_order in the body (only the reorder writes it)", async () => {
    expect((await createField(EVENT_CF_ORDER, { source_field: "bad_flag", show_on_form: "yes" })).status).toBe(400);
    expect((await createField(EVENT_CF_ORDER, { source_field: "bad_order", display_order: 3 })).status).toBe(400);
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_ORDER, source_field: "patch_me", label: "Patch me" },
    });
    expect((await patchField(EVENT_CF_ORDER, created.id, { show_on_form: 1 })).status).toBe(400);
    expect((await patchField(EVENT_CF_ORDER, created.id, { display_order: 0 })).status).toBe(400);
  });

  it("turns the flag on and off with a PATCH that changes nothing else", async () => {
    const created = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_ORDER, source_field: "toggle", label: "Toggle", required: false },
    });

    const on = await patchField(EVENT_CF_ORDER, created.id, { show_on_form: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as FieldItem).show_on_form).toBe(true);

    const off = await patchField(EVENT_CF_ORDER, created.id, { show_on_form: false });
    expect(((await off.json()) as FieldItem).show_on_form).toBe(false);
    expect((await prisma.eventCustomField.findUniqueOrThrow({ where: { id: created.id } })).label).toBe("Toggle");
  });

  it("appends a field created after a reorder to the end, unplaced", async () => {
    const fields = await seedFields(EVENT_CF_ORDER, ["one", "two"]);
    expect((await reorder(EVENT_CF_ORDER, idsOf(fields, ["two", "one"]))).status).toBe(200);

    expect((await createField(EVENT_CF_ORDER, { source_field: "three" })).status).toBe(201);

    const items = await listItems(EVENT_CF_ORDER);
    expect(slugsOf(items)).toEqual(["two", "one", "three"]);
    expect(positionsOf(items)).toEqual([0, 1, null]);
  });
});

describe("a Required field that the registration form would not ask", () => {
  beforeEach(resetFormFixtures);

  it("is refused on create when the event has a registration mode (422), and nothing is created", async () => {
    for (const body of [
      { source_field: "needed", required: true },
      { source_field: "needed", required: true, show_on_form: false },
    ]) {
      const res = await createField(EVENT_CF_REG, body);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe("required_field_not_on_form");
    }
    expect(await prisma.eventCustomField.count({ where: { event_id: EVENT_CF_REG } })).toBe(0);
  });

  it("is refused for the approval mode as well", async () => {
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_CF_REG }, data: { mode: "approval" } });
    try {
      expect((await createField(EVENT_CF_REG, { source_field: "needed", required: true })).status).toBe(422);
    } finally {
      await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_CF_REG }, data: { mode: "automatic" } });
    }
  });

  it("is accepted on create when it is on the form, or when it is optional", async () => {
    expect((await createField(EVENT_CF_REG, { source_field: "asked_required", required: true, show_on_form: true })).status).toBe(201);
    expect((await createField(EVENT_CF_REG, { source_field: "hidden_optional", required: false })).status).toBe(201);
    expect((await createField(EVENT_CF_REG, { source_field: "hidden_optional_explicit", required: false, show_on_form: false })).status).toBe(201);
  });

  it("is accepted as in 0.7.5 when the event has no registration mode: a settings row with mode null, or no row", async () => {
    for (const eventId of [EVENT_CF_REG_OFF, EVENT_CF_ORDER]) {
      const created = await createField(eventId, { source_field: "needed", required: true });
      expect(created.status).toBe(201);
      const field = (await created.json()) as FieldItem;
      expect(field.required).toBe(true);
      expect(field.show_on_form).toBe(false);

      expect((await patchField(eventId, field.id, { required: false })).status).toBe(200);
      expect((await patchField(eventId, field.id, { required: true })).status).toBe(200);
      expect((await patchField(eventId, field.id, { required: true, show_on_form: false })).status).toBe(200);
    }
  });

  it("is refused on PATCH when it makes a hidden field Required (422), and the field stays as it was", async () => {
    const hidden = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_REG, source_field: "hidden", label: "Hidden", required: false, show_on_form: false },
    });
    const res = await patchField(EVENT_CF_REG, hidden.id, { required: true });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("required_field_not_on_form");
    expect((await prisma.eventCustomField.findUniqueOrThrow({ where: { id: hidden.id } })).required).toBe(false);
  });

  it("is refused on PATCH when it takes a Required field off the form (422)", async () => {
    const asked = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_REG, source_field: "asked", label: "Asked", required: true, show_on_form: true },
    });
    const res = await patchField(EVENT_CF_REG, asked.id, { show_on_form: false });
    expect(res.status).toBe(422);
    expect((await prisma.eventCustomField.findUniqueOrThrow({ where: { id: asked.id } })).show_on_form).toBe(true);
  });

  it("is accepted on PATCH when the same request puts the field on the form, or makes it optional", async () => {
    const hidden = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_REG, source_field: "hidden", label: "Hidden" },
    });
    expect((await patchField(EVENT_CF_REG, hidden.id, { required: true, show_on_form: true })).status).toBe(200);
    expect((await patchField(EVENT_CF_REG, hidden.id, { required: false, show_on_form: false })).status).toBe(200);
  });

  it("leaves a field that already was Required and off the form editable, since that is not enforced backwards", async () => {
    // What an import or an older version left behind. The enable-registration gate reports these.
    const legacy = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_REG, source_field: "legacy", label: "Legacy", required: true, show_on_form: false },
    });
    expect((await patchField(EVENT_CF_REG, legacy.id, { label: "Legacy renamed" })).status).toBe(200);
    expect((await patchField(EVENT_CF_REG, legacy.id, { required: true })).status).toBe(200);
    expect((await patchField(EVENT_CF_REG, legacy.id, { type: "boolean" })).status).toBe(200);
    expect((await patchField(EVENT_CF_REG, legacy.id, { required: false })).status).toBe(200);
  });

  it("never ends Required and off the form when two saves each change one flag at once (lock)", async () => {
    const field = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_REG, source_field: "flip", label: "Flip", required: false, show_on_form: true },
    });
    for (let round = 0; round < 6; round += 1) {
      await prisma.eventCustomField.update({ where: { id: field.id }, data: { required: false, show_on_form: true } });

      const [hide, require] = await Promise.all([
        patchField(EVENT_CF_REG, field.id, { show_on_form: false }),
        patchField(EVENT_CF_REG, field.id, { required: true }),
      ]);

      // Either order is legal, but whichever ran second would have produced the bad pair.
      expect([hide.status, require.status].sort()).toEqual([200, 422]);
      const row = await prisma.eventCustomField.findUniqueOrThrow({ where: { id: field.id } });
      expect(row.required && !row.show_on_form).toBe(false);
    }
  });
});

describe("a save that waits for the custom-fields lock", () => {
  beforeEach(resetFormFixtures);

  it("answers 403 when the field was deleted while it waited, like any field the event does not have", async () => {
    const field = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_REG, source_field: "doomed", label: "Doomed" },
    });
    let save: Promise<Response> | undefined;
    await prisma.$transaction(async (tx) => {
      await acquireEventCustomFieldsLock(tx, EVENT_CF_REG);
      // The save passes its first read, then queues behind this transaction's lock.
      save = patchField(EVENT_CF_REG, field.id, { label: "Too late" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await tx.eventCustomField.delete({ where: { id: field.id } });
    });

    const res = await save;
    expect(res?.status).toBe(403);
    expect(await prisma.eventCustomField.count({ where: { event_id: EVENT_CF_REG } })).toBe(0);
  });
});

describe("PUT /api/admin/events/:eventId/custom-fields/order", () => {
  beforeEach(resetFormFixtures);

  it("returns 403 for an operator, who has access to this event but is not its administrator", async () => {
    const res = await reorder(EVENT_CF, [], { Cookie: opCookie, "Content-Type": "application/json", ...sameOrigin });
    expect(res.status).toBe(403);
  });

  it("returns 403 for a request from another origin, and changes nothing", async () => {
    const fields = await seedFields(EVENT_CF_ORDER, ["a", "b"]);
    const res = await reorder(EVENT_CF_ORDER, idsOf(fields, ["b", "a"]), {
      Cookie: adminCookie,
      "Content-Type": "application/json",
      Origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    expect(positionsOf(await listItems(EVENT_CF_ORDER))).toEqual([null, null]);
  });

  it("returns 403 event_archived for an archived event", async () => {
    const res = await reorder(EVENT_CF_ARCHIVED, []);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("event_archived");
  });

  it("returns 400 for a body that is not JSON, and for a list that is not a list of distinct ids", async () => {
    const notJson = await app.request(`/api/admin/events/${EVENT_CF_ORDER}/custom-fields/order`, {
      method: "PUT",
      headers: jsonAdmin(),
      body: "{not valid json",
    });
    expect(notJson.status).toBe(400);
    expect(((await notJson.json()) as { error: string }).error).toBe("invalid json");

    const fields = await seedFields(EVENT_CF_ORDER, ["a", "b"]);
    const [a, b] = idsOf(fields, ["a", "b"]);
    for (const ids of ["a", [1, 2], [a, a], [a, ""], Array.from({ length: 101 }, (_, i) => `id-${i}`)]) {
      const res = await reorder(EVENT_CF_ORDER, ids);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("validation_failed");
    }
    const extraKey = await app.request(`/api/admin/events/${EVENT_CF_ORDER}/custom-fields/order`, {
      method: "PUT",
      headers: jsonAdmin(),
      body: JSON.stringify({ ids: [a, b], also: true }),
    });
    expect(extraKey.status).toBe(400);
    const noIds = await app.request(`/api/admin/events/${EVENT_CF_ORDER}/custom-fields/order`, {
      method: "PUT",
      headers: jsonAdmin(),
      body: JSON.stringify({}),
    });
    expect(noIds.status).toBe(400);
  });

  it("reorders in one request: the answer, the list and the rows all hold 0..n-1 in the new order", async () => {
    const fields = await seedFields(EVENT_CF_ORDER, ["alpha", "bravo", "charlie", "delta"]);
    const wanted = ["delta", "alpha", "charlie", "bravo"];

    const res = await reorder(EVENT_CF_ORDER, idsOf(fields, wanted));

    expect(res.status).toBe(200);
    const answer = ((await res.json()) as { items: FieldItem[] }).items;
    expect(slugsOf(answer)).toEqual(wanted);
    expect(positionsOf(answer)).toEqual([0, 1, 2, 3]);
    const listed = await listItems(EVENT_CF_ORDER);
    expect(slugsOf(listed)).toEqual(wanted);
    expect(positionsOf(listed)).toEqual([0, 1, 2, 3]);
    const stored = await prisma.eventCustomField.findMany({ where: { event_id: EVENT_CF_ORDER }, orderBy: { display_order: "asc" } });
    expect(stored.map((row) => row.display_order)).toEqual([0, 1, 2, 3]);
  });

  it("numbers the fields that had no position, so the result has no gap and no repeat", async () => {
    const fields = await seedFields(EVENT_CF_ORDER, ["old_1", "old_2"]);
    await prisma.eventCustomField.update({ where: { id: idsOf(fields, ["old_1"])[0]! }, data: { display_order: 7 } });
    await createField(EVENT_CF_ORDER, { source_field: "new_1" });
    await createField(EVENT_CF_ORDER, { source_field: "new_2" });
    const all = new Map((await listItems(EVENT_CF_ORDER)).map((item) => [item.source_field, item.id]));

    const res = await reorder(EVENT_CF_ORDER, idsOf(all, ["new_2", "old_2", "old_1", "new_1"]));

    expect(res.status).toBe(200);
    const items = ((await res.json()) as { items: FieldItem[] }).items;
    expect(slugsOf(items)).toEqual(["new_2", "old_2", "old_1", "new_1"]);
    expect(positionsOf(items)).toEqual([0, 1, 2, 3]);
  });

  it("accepts an empty list for an event with no fields", async () => {
    const res = await reorder(EVENT_CF_ORDER, []);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    expect(await reorderLogCount(EVENT_CF_ORDER)).toBe(0);
  });

  it("records one audit entry naming the fields in order, and none when the order is already stored", async () => {
    const fields = await seedFields(EVENT_CF_ORDER, ["a", "b", "c"]);
    const wanted = ["c", "a", "b"];

    expect((await reorder(EVENT_CF_ORDER, idsOf(fields, wanted))).status).toBe(200);
    expect(await reorderLogCount(EVENT_CF_ORDER)).toBe(1);
    const log = await prisma.attendeeActionLog.findFirstOrThrow({
      where: { event_id: EVENT_CF_ORDER, action_type: "event_custom_fields_reordered" },
    });
    expect(log.attendee_id).toBeNull();
    expect(log.metadata).toEqual({ source_fields: wanted });

    expect((await reorder(EVENT_CF_ORDER, idsOf(fields, wanted))).status).toBe(200);
    expect(await reorderLogCount(EVENT_CF_ORDER)).toBe(1);
  });

  it("answers 409 stale_write and changes nothing when the list is not the event's fields now", async () => {
    const fields = await seedFields(EVENT_CF_ORDER, ["a", "b", "c"]);
    const [a, b, c] = idsOf(fields, ["a", "b", "c"]);
    const foreign = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_OTHER, source_field: "foreign", label: "Foreign" },
    });
    try {
      for (const ids of [[a, b], [a, b, c, "no-such-field"], [a, b, foreign.id], [c, b, a, foreign.id]]) {
        const res = await reorder(EVENT_CF_ORDER, ids);
        expect(res.status).toBe(409);
        expect(((await res.json()) as { error: string }).error).toBe("stale_write");
      }
      expect(positionsOf(await listItems(EVENT_CF_ORDER))).toEqual([null, null, null]);
      expect(await reorderLogCount(EVENT_CF_ORDER)).toBe(0);
      expect((await prisma.eventCustomField.findUniqueOrThrow({ where: { id: foreign.id } })).display_order).toBeNull();
    } finally {
      await prisma.eventCustomField.delete({ where: { id: foreign.id } });
    }
  });

  it("leaves one of two reorders sent at once, whole: 0..n-1 and exactly the order of the one that ran last", async () => {
    const fields = await seedFields(EVENT_CF_ORDER, ["a", "b", "c", "d", "e"]);
    const first = idsOf(fields, ["e", "d", "c", "b", "a"]);
    const second = idsOf(fields, ["c", "a", "e", "b", "d"]);

    for (let round = 0; round < 8; round += 1) {
      const [x, y] = await Promise.all([reorder(EVENT_CF_ORDER, first), reorder(EVENT_CF_ORDER, second)]);
      expect([x.status, y.status]).toEqual([200, 200]);

      const items = await listItems(EVENT_CF_ORDER);
      expect(positionsOf(items)).toEqual([0, 1, 2, 3, 4]);
      const ids = items.map((item) => item.id);
      expect([first, second]).toContainEqual(ids);
    }
  });

  it("is serialised with a delete: no 500, and no field is left that the answer did not number", async () => {
    for (let round = 0; round < 4; round += 1) {
      const fields = await seedFields(EVENT_CF_ORDER, ["a", "b", "c", "d"]);
      const all = idsOf(fields, ["d", "c", "b", "a"]);
      const doomed = idsOf(fields, ["c"])[0]!;

      const [moved, removed] = await Promise.all([
        reorder(EVENT_CF_ORDER, all),
        app.request(`/api/admin/events/${EVENT_CF_ORDER}/custom-fields/${doomed}`, {
          method: "DELETE",
          headers: { Cookie: adminCookie, ...sameOrigin },
        }),
      ]);

      expect(removed.status).toBe(200);
      expect([200, 409]).toContain(moved.status);
      const left = await listItems(EVENT_CF_ORDER);
      expect(slugsOf(left)).not.toContain("c");
      const placed = left.map((item) => item.display_order).filter((value) => value !== null);
      expect(new Set(placed).size).toBe(placed.length);
    }
  });

  it("is serialised with a create: a field made meanwhile either waits its turn at the end, or the reorder is told to reload", async () => {
    for (let round = 0; round < 4; round += 1) {
      const fields = await seedFields(EVENT_CF_ORDER, ["a", "b", "c"]);
      const wanted = ["c", "b", "a"];

      const [moved, made] = await Promise.all([
        reorder(EVENT_CF_ORDER, idsOf(fields, wanted)),
        createField(EVENT_CF_ORDER, { source_field: "fresh" }),
      ]);

      expect(made.status).toBe(201);
      expect([200, 409]).toContain(moved.status);
      const items = await listItems(EVENT_CF_ORDER);
      if (moved.status === 200) {
        expect(slugsOf(items)).toEqual([...wanted, "fresh"]);
        expect(positionsOf(items)).toEqual([0, 1, 2, null]);
      } else {
        expect(slugsOf(items)).toEqual(["a", "b", "c", "fresh"]);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The answer types long text, date, date and time and phone, and the format rules (v0.8).
// ---------------------------------------------------------------------------------------------

type TypedFieldItem = FieldItem & { type: string; rules: Record<string, unknown> | null };

async function readField(res: Response): Promise<TypedFieldItem> {
  return (await res.json()) as TypedFieldItem;
}

/** What the rules column holds: "none" for the SQL NULL, never a JSON null. */
async function storedRules(id: string): Promise<{ isNull: boolean; rules: unknown }> {
  const [row] = await prisma.$queryRaw<{ is_null: boolean; rules: unknown }[]>`
    SELECT "rules" IS NULL AS is_null, "rules" FROM "EventCustomField" WHERE "id" = ${id}
  `;
  return { isNull: row!.is_null, rules: row!.rules };
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

const fieldCount = () => prisma.eventCustomField.count({ where: { event_id: EVENT_CF_ORDER } });

describe("the answer types of a field", () => {
  beforeEach(resetFormFixtures);

  it.each(["long_text", "date", "datetime", "phone"])("creates a %s field, with no rules", async (type) => {
    const res = await createField(EVENT_CF_ORDER, { source_field: `answer_${type}`, type, required: true });
    expect(res.status).toBe(201);
    const field = await readField(res);
    expect(field).toMatchObject({ type, required: true, rules: null });
    expect(await storedRules(field.id)).toEqual({ isNull: true, rules: null });
    expect((await listItems(EVENT_CF_ORDER)).map((item) => item.source_field)).toEqual([`answer_${type}`]);
  });

  it("keeps creating the three types it always had", async () => {
    expect((await readField(await createField(EVENT_CF_ORDER, { source_field: "t" }))).type).toBe("text");
    expect((await readField(await createField(EVENT_CF_ORDER, { source_field: "s", type: "select", options: ["A"] }))).type).toBe("select");
    expect((await readField(await createField(EVENT_CF_ORDER, { source_field: "b", type: "boolean" }))).type).toBe("boolean");
  });

  it("refuses a type it does not know, on create and on PATCH", async () => {
    for (const type of ["number", "multi_select", "email", "TEXT", "", null, 5]) {
      const res = await createField(EVENT_CF_ORDER, { source_field: "odd", type });
      expect(res.status, String(type)).toBe(400);
    }
    const created = await readField(await createField(EVENT_CF_ORDER, { source_field: "stays_text" }));
    expect((await patchField(EVENT_CF_ORDER, created.id, { type: "number" })).status).toBe(400);
    expect(await fieldCount()).toBe(1);
  });

  it("changes the type of an existing field to a new one, and back", async () => {
    const created = await readField(await createField(EVENT_CF_ORDER, { source_field: "retype" }));
    for (const type of ["long_text", "date", "datetime", "phone", "text"]) {
      const res = await patchField(EVENT_CF_ORDER, created.id, { type });
      expect(res.status, type).toBe(200);
      expect((await readField(res)).type).toBe(type);
    }
  });
});

describe("the format rules of a field", () => {
  beforeEach(resetFormFixtures);

  const RULES = { min_length: 3, max_length: 9, digits_only: true, example: "  600100200 " };

  it.each(["text", "long_text", "phone"])("stores the rules of a %s field and lists them", async (type) => {
    const res = await createField(EVENT_CF_ORDER, { source_field: "ruled", type, rules: RULES });
    expect(res.status).toBe(201);
    const field = await readField(res);
    expect(field.rules).toEqual({ min_length: 3, max_length: 9, digits_only: true, example: "600100200" });
    expect(await storedRules(field.id)).toEqual({
      isNull: false,
      rules: { min_length: 3, max_length: 9, digits_only: true, example: "600100200" },
    });
    expect((await listItems(EVENT_CF_ORDER))[0]).toMatchObject({ source_field: "ruled", rules: field.rules });
  });

  it("stores each rule on its own", async () => {
    let n = 0;
    for (const rules of [{ min_length: 4 }, { max_length: 4 }, { digits_only: true }, { example: "AB 12" }]) {
      n += 1;
      const field = await readField(await createField(EVENT_CF_ORDER, { source_field: `single_${n}`, rules }));
      expect(field.rules).toEqual(rules);
    }
  });

  it("stores no rules as the SQL NULL: left out, null, or an object with no rule", async () => {
    let n = 0;
    for (const body of [{}, { rules: null }, { rules: {} }]) {
      n += 1;
      const res = await createField(EVENT_CF_ORDER, { source_field: `none_${n}`, ...body });
      expect(res.status).toBe(201);
      const field = await readField(res);
      expect(field.rules).toBeNull();
      expect(await storedRules(field.id)).toEqual({ isNull: true, rules: null });
    }
  });

  it("refuses a shape that is not a rules object with 400, and creates nothing", async () => {
    for (const rules of [
      { pattern: "^[0-9]+$" },
      { regex: "a" },
      { suggestion: ["Vegan"] },
      { allow_other: true },
      { min_length: 3, unknown_rule: 1 },
      { min_length: 0 },
      { min_length: 1.5 },
      { min_length: "3" },
      { max_length: 1001 },
      { max_length: -1 },
      { min_length: 10, max_length: 9 },
      { digits_only: "yes" },
      { example: "" },
      { example: "x".repeat(101) },
      { example: "two\nlines" },
      { example: "nul\u0000" },
      "digits_only",
      ["min_length"],
      5,
      true,
    ]) {
      const res = await createField(EVENT_CF_ORDER, { source_field: "bad_rules", rules });
      expect(res.status, JSON.stringify(rules)).toBe(400);
      expect(await errorOf(res)).toBe("validation_failed");
    }
    expect(await fieldCount()).toBe(0);
  });

  it("refuses rules on a type that takes none with 422 invalid_field_rules, and creates nothing", async () => {
    for (const body of [
      { type: "date", rules: { example: "2026-11-04" } },
      { type: "datetime", rules: { digits_only: true } },
      { type: "boolean", rules: { min_length: 1 } },
      { type: "select", options: ["A", "B"], rules: { max_length: 5 } },
    ]) {
      const res = await createField(EVENT_CF_ORDER, { source_field: "no_rules_here", ...body });
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await errorOf(res)).toBe("invalid_field_rules");
    }
    expect(await fieldCount()).toBe(0);
  });

  it("refuses a length longer than the type can hold (100 for text, 16 for phone, 1000 for long text), and phone rules no number can meet", async () => {
    const cases = [
      ["text", { max_length: 100 }, 201],
      ["text", { max_length: 101 }, 422],
      ["text", { min_length: 101 }, 422],
      ["long_text", { max_length: 1000 }, 201],
      ["phone", { max_length: 16 }, 201],
      ["phone", { max_length: 17 }, 422],
      ["phone", { min_length: 17 }, 422],
      ["phone", { max_length: 2 }, 422],
      ["phone", { max_length: 3 }, 201],
      ["phone", { digits_only: true, min_length: 16 }, 422],
      ["phone", { min_length: 16 }, 201],
    ] as const;
    for (const [index, [type, rules, status]] of cases.entries()) {
      const res = await createField(EVENT_CF_ORDER, { source_field: `cap_${index}`, type, rules });
      expect(res.status, `${type} ${JSON.stringify(rules)}`).toBe(status);
      if (status === 422) expect(await errorOf(res)).toBe("invalid_field_rules");
    }
  });

  it("sets, replaces and clears the rules of an existing field with a PATCH", async () => {
    const created = await readField(await createField(EVENT_CF_ORDER, { source_field: "patched", type: "text" }));

    const set = await patchField(EVENT_CF_ORDER, created.id, { rules: { digits_only: true, min_length: 3 } });
    expect(set.status).toBe(200);
    expect((await readField(set)).rules).toEqual({ digits_only: true, min_length: 3 });

    // An object replaces the rules, it does not merge into them.
    const replaced = await patchField(EVENT_CF_ORDER, created.id, { rules: { max_length: 4 } });
    expect(replaced.status).toBe(200);
    expect((await readField(replaced)).rules).toEqual({ max_length: 4 });
    expect((await storedRules(created.id)).rules).toEqual({ max_length: 4 });

    // A PATCH that leaves the key out leaves the rules alone.
    expect((await readField(await patchField(EVENT_CF_ORDER, created.id, { label: "Renamed" }))).rules).toEqual({ max_length: 4 });

    const cleared = await readField(await patchField(EVENT_CF_ORDER, created.id, { rules: null }));
    expect(cleared.rules).toBeNull();
    expect(await storedRules(created.id)).toEqual({ isNull: true, rules: null });

    await patchField(EVENT_CF_ORDER, created.id, { rules: { example: "x" } });
    expect((await readField(await patchField(EVENT_CF_ORDER, created.id, { rules: {} }))).rules).toBeNull();
    expect((await storedRules(created.id)).isNull).toBe(true);
  });

  it("refuses a PATCH with a bad rules shape with 400, or rules the type does not take with 422, and changes nothing", async () => {
    const text = await readField(await createField(EVENT_CF_ORDER, { source_field: "keeps_rules", rules: { max_length: 5 } }));
    const date = await readField(await createField(EVENT_CF_ORDER, { source_field: "a_date", type: "date" }));

    expect((await patchField(EVENT_CF_ORDER, text.id, { rules: { pattern: "a" } })).status).toBe(400);
    expect((await patchField(EVENT_CF_ORDER, text.id, { rules: { min_length: 9, max_length: 2 } })).status).toBe(400);
    const tooLong = await patchField(EVENT_CF_ORDER, text.id, { rules: { max_length: 101 } });
    expect(tooLong.status).toBe(422);
    expect(await errorOf(tooLong)).toBe("invalid_field_rules");
    const onDate = await patchField(EVENT_CF_ORDER, date.id, { rules: { digits_only: true } });
    expect(onDate.status).toBe(422);

    expect((await storedRules(text.id)).rules).toEqual({ max_length: 5 });
    expect((await storedRules(date.id)).isNull).toBe(true);
  });

  it("judges the type and the rules as they will be once the PATCH is applied", async () => {
    const text = await readField(await createField(EVENT_CF_ORDER, { source_field: "retyped", rules: { max_length: 50, digits_only: true } }));

    // To a type that takes no rules, while the field still has them: refused, and nothing changes.
    for (const type of ["date", "datetime", "select", "boolean"]) {
      const body = type === "select" ? { type, options: ["A"] } : { type };
      const res = await patchField(EVENT_CF_ORDER, text.id, body);
      expect(res.status, type).toBe(422);
    }
    expect(await storedRules(text.id)).toEqual({ isNull: false, rules: { max_length: 50, digits_only: true } });
    expect((await prisma.eventCustomField.findUniqueOrThrow({ where: { id: text.id } })).type).toBe("text");

    // The same PATCH with the rules cleared goes through.
    const moved = await patchField(EVENT_CF_ORDER, text.id, { type: "date", rules: null });
    expect(moved.status).toBe(200);
    expect(await readField(moved)).toMatchObject({ type: "date", rules: null });

    // Between types that take rules, the rules that fit the new type are kept.
    await patchField(EVENT_CF_ORDER, text.id, { type: "text", rules: { max_length: 50 } });
    const longer = await patchField(EVENT_CF_ORDER, text.id, { type: "long_text", rules: { max_length: 500 } });
    expect(await readField(longer)).toMatchObject({ type: "long_text", rules: { max_length: 500 } });
    const kept = await patchField(EVENT_CF_ORDER, text.id, { type: "phone", rules: { max_length: 16 } });
    expect((await readField(kept)).rules).toEqual({ max_length: 16 });
  });

  it("refuses to turn a long text with a long maximum back into a text it cannot hold, unless the rules change with it", async () => {
    const long = await readField(await createField(EVENT_CF_ORDER, { source_field: "essay", type: "long_text", rules: { max_length: 500 } }));
    const back = await patchField(EVENT_CF_ORDER, long.id, { type: "text" });
    expect(back.status).toBe(422);
    expect((await prisma.eventCustomField.findUniqueOrThrow({ where: { id: long.id } })).type).toBe("long_text");
    expect((await patchField(EVENT_CF_ORDER, long.id, { type: "text", rules: { max_length: 80 } })).status).toBe(200);
  });

  it("reads rules a hand edit left unreadable as none, so the list still loads", async () => {
    const created = await readField(await createField(EVENT_CF_ORDER, { source_field: "tampered" }));
    await prisma.$executeRaw`UPDATE "EventCustomField" SET "rules" = '{"pattern": "^a$"}'::jsonb WHERE "id" = ${created.id}`;
    expect((await listItems(EVENT_CF_ORDER))[0]).toMatchObject({ source_field: "tampered", rules: null });
  });

  it("keeps the audit entry of a save free of the rules and the example", async () => {
    await prisma.attendeeActionLog.deleteMany({ where: { event_id: EVENT_CF_ORDER } });
    const created = await readField(await createField(EVENT_CF_ORDER, { source_field: "audited", rules: { example: "AB 12345" } }));
    await patchField(EVENT_CF_ORDER, created.id, { rules: { example: "CD 67890" } });
    const logs = await prisma.attendeeActionLog.findMany({
      where: { event_id: EVENT_CF_ORDER, action_type: { in: ["event_custom_field_created", "event_custom_field_updated"] } },
    });
    expect(logs).toHaveLength(2);
    for (const log of logs) expect(log.metadata).toEqual({ source_field: "audited" });
  });
});

// ---------------------------------------------------------------------------------------------
// The rules of the registration form: an icon, suggestions and a condition between fields (v0.8).
// ---------------------------------------------------------------------------------------------

const deleteField = (eventId: string, fieldId: string): Promise<Response> =>
  Promise.resolve(
    app.request(`/api/admin/events/${eventId}/custom-fields/${fieldId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    }),
  );

/** Creates a field and expects it to be created. */
async function makeField(eventId: string, body: Record<string, unknown>): Promise<TypedFieldItem> {
  const res = await createField(eventId, body);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return readField(res);
}

const whenParking = { show_when: { field: "parking", value: true } };
const whenBoth = { show_when: { field: "day", value: "Both" } };
const DAYS = ["Day 1", "Day 2", "Both"];

/** What the stored rows say about the field: its rules and its flags, for a check that a refusal changed nothing. */
async function stored(fieldId: string) {
  const row = await prisma.eventCustomField.findUniqueOrThrow({ where: { id: fieldId } });
  return { type: row.type, options: row.options, rules: row.rules, show_on_form: row.show_on_form, applies_to: row.applies_to };
}

/** The status and the error code of an answer. */
async function refusal(res: Response): Promise<[number, string]> {
  return [res.status, await errorOf(res)];
}

describe("the icon and the suggestions of a field", () => {
  beforeEach(resetFormFixtures);

  it("stores an icon on a field of every type, and lists it", async () => {
    for (const type of ["text", "long_text", "date", "datetime", "phone", "boolean"]) {
      const field = await makeField(EVENT_CF_ORDER, { source_field: `icon_${type}`, type, rules: { icon: "car" } });
      expect(field.rules, type).toEqual({ icon: "car" });
      expect((await storedRules(field.id)).rules).toEqual({ icon: "car" });
    }
    const select = await makeField(EVENT_CF_ORDER, { source_field: "icon_select", type: "select", options: ["A"], rules: { icon: "bed" } });
    expect(select.rules).toEqual({ icon: "bed" });
    expect((await listItems(EVENT_CF_ORDER)).every((item) => (item as TypedFieldItem).rules !== null)).toBe(true);
  });

  it("refuses an icon that is not on the list with 400, and creates nothing", async () => {
    for (const icon of ["rocket", "Parking", "map-pin", "", 5, null, ["car"]]) {
      const res = await createField(EVENT_CF_ORDER, { source_field: "odd_icon", rules: { icon } });
      expect([res.status, await errorOf(res)], JSON.stringify(icon)).toEqual([400, "validation_failed"]);
    }
    expect(await fieldCount()).toBe(0);
  });

  it("sets, replaces and clears an icon with a PATCH, and keeps the format rules next to it", async () => {
    const created = await makeField(EVENT_CF_ORDER, { source_field: "iconic", rules: { max_length: 20, icon: "food" } });
    expect(created.rules).toEqual({ max_length: 20, icon: "food" });
    const replaced = await patchField(EVENT_CF_ORDER, created.id, { rules: { max_length: 20, icon: "users" } });
    expect((await readField(replaced)).rules).toEqual({ max_length: 20, icon: "users" });
    const without = await patchField(EVENT_CF_ORDER, created.id, { rules: { max_length: 20 } });
    expect((await readField(without)).rules).toEqual({ max_length: 20 });
  });

  it("stores the suggestions of a text field, trimmed, in the order given", async () => {
    const field = await makeField(EVENT_CF_ORDER, {
      source_field: "diet",
      rules: { icon: "food", suggestions: ["  Vegan ", "Vegetarian", "Gluten-free"] },
    });
    expect(field.rules).toEqual({ icon: "food", suggestions: ["Vegan", "Vegetarian", "Gluten-free"] });
    expect((await storedRules(field.id)).rules).toEqual({ icon: "food", suggestions: ["Vegan", "Vegetarian", "Gluten-free"] });
  });

  it("refuses suggestions on every type but text with 422 invalid_field_rules, and creates nothing", async () => {
    for (const body of [
      { type: "long_text" },
      { type: "date" },
      { type: "datetime" },
      { type: "phone" },
      { type: "boolean" },
      { type: "select", options: ["A"] },
    ]) {
      const res = await createField(EVENT_CF_ORDER, { source_field: "no_suggestions", ...body, rules: { suggestions: ["Vegan"] } });
      expect(await refusal(res), JSON.stringify(body)).toEqual([422, "invalid_field_rules"]);
    }
    expect(await fieldCount()).toBe(0);
  });

  it("refuses a list that is empty, long, too long in an entry, or has an entry twice, with 400", async () => {
    const thirtyOne = Array.from({ length: 31 }, (_, index) => `Choice ${index}`);
    for (const suggestions of [[], thirtyOne, ["a".repeat(101)], ["Vegan", "vegan"], ["Vegan", " VEGAN "], [""], ["   "], "Vegan"]) {
      const res = await createField(EVENT_CF_ORDER, { source_field: "bad_list", rules: { suggestions } });
      expect(res.status, JSON.stringify(suggestions).slice(0, 40)).toBe(400);
    }
    const ok = await createField(EVENT_CF_ORDER, { source_field: "thirty", rules: { suggestions: thirtyOne.slice(0, 30) } });
    expect(ok.status).toBe(201);
  });

  it("judges the suggestions on the type the field will have: a text field with a list cannot become another type", async () => {
    const text = await makeField(EVENT_CF_ORDER, { source_field: "diet_text", rules: { suggestions: ["Vegan"] } });
    for (const type of ["long_text", "date", "phone"]) {
      expect(await refusal(await patchField(EVENT_CF_ORDER, text.id, { type })), type).toEqual([422, "invalid_field_rules"]);
    }
    expect(await refusal(await patchField(EVENT_CF_ORDER, text.id, { type: "select", options: ["A"] }))).toEqual([422, "invalid_field_rules"]);
    expect((await stored(text.id)).type).toBe("text");
    // With the list left out of the same PATCH, the type changes.
    const moved = await patchField(EVENT_CF_ORDER, text.id, { type: "long_text", rules: { icon: "food" } });
    expect(await readField(moved)).toMatchObject({ type: "long_text", rules: { icon: "food" } });
    // And a list cannot be added to a field that is not a text.
    expect(await refusal(await patchField(EVENT_CF_ORDER, text.id, { rules: { suggestions: ["Vegan"] } }))).toEqual([422, "invalid_field_rules"]);
  });

  it("keeps an icon when the type changes, and refuses format rules the new type does not take", async () => {
    const text = await makeField(EVENT_CF_ORDER, { source_field: "retype_icon", rules: { icon: "mail", max_length: 20 } });
    expect(await refusal(await patchField(EVENT_CF_ORDER, text.id, { type: "date" }))).toEqual([422, "invalid_field_rules"]);
    const moved = await patchField(EVENT_CF_ORDER, text.id, { type: "date", rules: { icon: "mail" } });
    expect(await readField(moved)).toMatchObject({ type: "date", rules: { icon: "mail" } });
  });
});

describe("a condition between fields, on create", () => {
  beforeEach(resetFormFixtures);

  it("stores a condition on a yes/no field, and on an option of a select field", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    await makeField(EVENT_CF_ORDER, { source_field: "day", type: "select", options: DAYS });
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: { ...whenParking, icon: "car", max_length: 10 } });
    const badge = await makeField(EVENT_CF_ORDER, { source_field: "badge", type: "phone", rules: { show_when: { field: "day", value: "  Both " } } });
    expect(plate.rules).toEqual({ show_when: { field: "parking", value: true }, icon: "car", max_length: 10 });
    expect(badge.rules).toEqual({ show_when: { field: "day", value: "Both" } });
    expect((await storedRules(plate.id)).rules).toEqual(plate.rules);
    expect((await listItems(EVENT_CF_ORDER)).map((item) => item.source_field)).toEqual(["parking", "day", "plate", "badge"]);
  });

  it("stores a condition on a field of every type", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    for (const type of ["text", "long_text", "date", "datetime", "phone", "boolean"]) {
      const field = await makeField(EVENT_CF_ORDER, { source_field: `when_${type}`, type, rules: whenParking });
      expect(field.rules, type).toEqual(whenParking);
    }
    const select = await makeField(EVENT_CF_ORDER, { source_field: "when_select", type: "select", options: ["A"], rules: whenParking });
    expect(select.rules).toEqual(whenParking);
  });

  it("refuses a condition on a field the event does not have, and one on a field that does not exist yet, with 422", async () => {
    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking }))).toEqual([422, "invalid_show_when"]);
    // The field cannot depend on itself.
    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean", rules: whenParking }))).toEqual([422, "invalid_show_when"]);
    // A field of another event does not count.
    await makeField(EVENT_CF_REG_OFF, { source_field: "parking", type: "boolean" });
    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking }))).toEqual([422, "invalid_show_when"]);
    expect(await fieldCount()).toBe(0);
  });

  it("refuses a condition on a field that is neither yes/no nor select, with 422", async () => {
    for (const type of ["text", "long_text", "date", "datetime", "phone"]) {
      await makeField(EVENT_CF_ORDER, { source_field: "parking", type });
      expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking })), type).toEqual([422, "invalid_show_when"]);
      await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_CF_ORDER } });
    }
  });

  it("refuses an answer the field cannot have, with 422", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    await makeField(EVENT_CF_ORDER, { source_field: "day", type: "select", options: DAYS });
    for (const show_when of [
      { field: "parking", value: "true" },
      { field: "day", value: true },
      { field: "day", value: "Day 3" },
      { field: "day", value: "both" },
      { field: "day", value: "Both days" },
    ]) {
      expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "plate", rules: { show_when } })), JSON.stringify(show_when)).toEqual([422, "invalid_show_when"]);
    }
    expect(await fieldCount()).toBe(2);
  });

  it("refuses a condition that is not one with 400", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    for (const show_when of [{ field: "parking" }, { value: true }, { field: "parking", value: false }, { field: "parking", value: true, extra: 1 }, "parking", null, [], { field: "Parking", value: true }]) {
      const res = await createField(EVENT_CF_ORDER, { source_field: "plate", rules: { show_when } });
      expect([res.status, await errorOf(res)], JSON.stringify(show_when)).toEqual([400, "validation_failed"]);
    }
  });

  it("refuses a condition on a field that has a condition itself: no chain of two", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "day", type: "select", options: DAYS });
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean", rules: whenBoth });
    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking }))).toEqual([422, "invalid_show_when"]);
    expect(await fieldCount()).toBe(2);
  });

  it("lets a field with a condition be on the form only when the field it depends on is", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean", show_on_form: false });
    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "plate", show_on_form: true, rules: whenParking }))).toEqual([422, "show_when_not_on_form"]);
    expect((await createField(EVENT_CF_ORDER, { source_field: "plate", show_on_form: false, rules: whenParking })).status).toBe(201);
    expect((await createField(EVENT_CF_ORDER, { source_field: "plate2", rules: whenParking })).status).toBe(201);
    await makeField(EVENT_CF_ORDER, { source_field: "day", type: "select", options: DAYS, show_on_form: true });
    expect((await createField(EVENT_CF_ORDER, { source_field: "badge", show_on_form: true, rules: whenBoth })).status).toBe(201);
  });

  it("holds an event that has a registration mode to the same rules, and one that has none, too", async () => {
    for (const eventId of [EVENT_CF_REG, EVENT_CF_REG_OFF]) {
      await makeField(eventId, { source_field: "parking", type: "boolean", show_on_form: false });
      expect(await refusal(await createField(eventId, { source_field: "plate", show_on_form: true, rules: whenParking })), eventId).toEqual([422, "show_when_not_on_form"]);
      expect(await refusal(await createField(eventId, { source_field: "plate", rules: { show_when: { field: "nothing", value: true } } })), eventId).toEqual([422, "invalid_show_when"]);
    }
  });

  it("does not put the condition in the audit entry", async () => {
    await prisma.attendeeActionLog.deleteMany({ where: { event_id: EVENT_CF_ORDER } });
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: { ...whenParking, suggestions: ["WA 12345"] } });
    const logs = await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT_CF_ORDER, action_type: "event_custom_field_created" } });
    expect(logs.map((log) => log.metadata)).toEqual(expect.arrayContaining([{ source_field: "parking" }, { source_field: "plate" }]));
  });
});

describe("a condition between fields, on PATCH", () => {
  beforeEach(resetFormFixtures);

  /** A yes/no field `parking`, a select field `day` and two fields that depend on them. */
  async function seedPairs() {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    const day = await makeField(EVENT_CF_ORDER, { source_field: "day", type: "select", options: DAYS });
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking });
    const badge = await makeField(EVENT_CF_ORDER, { source_field: "badge", rules: whenBoth });
    return { parking, day, plate, badge };
  }

  it("sets, moves and clears the condition of an existing field", async () => {
    const { plate, badge } = await seedPairs();
    const free = await makeField(EVENT_CF_ORDER, { source_field: "free_text" });
    expect((await readField(await patchField(EVENT_CF_ORDER, free.id, { rules: whenParking }))).rules).toEqual(whenParking);
    expect((await readField(await patchField(EVENT_CF_ORDER, plate.id, { rules: whenBoth }))).rules).toEqual(whenBoth);
    expect((await readField(await patchField(EVENT_CF_ORDER, badge.id, { rules: null }))).rules).toBeNull();
    expect((await readField(await patchField(EVENT_CF_ORDER, plate.id, { rules: { icon: "car" } }))).rules).toEqual({ icon: "car" });
  });

  it("refuses a condition that cannot be kept with 422, and changes nothing", async () => {
    const { plate } = await seedPairs();
    const before = await stored(plate.id);
    for (const show_when of [
      { field: "nothing", value: true },
      { field: "plate", value: true },
      { field: "badge", value: true },
      { field: "day", value: true },
      { field: "parking", value: "true" },
      { field: "day", value: "Day 3" },
    ]) {
      expect(await refusal(await patchField(EVENT_CF_ORDER, plate.id, { rules: { show_when } })), JSON.stringify(show_when)).toEqual([422, "invalid_show_when"]);
    }
    expect(await stored(plate.id)).toEqual(before);
  });

  it("refuses a yes/no or select field that depends on itself, and changes nothing", async () => {
    const solo = await makeField(EVENT_CF_ORDER, { source_field: "solo", type: "boolean" });
    const pick = await makeField(EVENT_CF_ORDER, { source_field: "pick", type: "select", options: ["A", "B"] });
    expect(await refusal(await patchField(EVENT_CF_ORDER, solo.id, { rules: { show_when: { field: "solo", value: true } } }))).toEqual([422, "invalid_show_when"]);
    expect(await refusal(await patchField(EVENT_CF_ORDER, pick.id, { rules: { show_when: { field: "pick", value: "A" } } }))).toEqual([422, "invalid_show_when"]);
    expect((await stored(solo.id)).rules).toBeNull();
    expect((await stored(pick.id)).rules).toBeNull();
  });

  it("refuses a condition for a field that others depend on: no chain of two, either way", async () => {
    const { parking } = await seedPairs();
    // `plate` depends on `parking`, so `parking` may not depend on `day`, which `badge` depends on.
    expect(await refusal(await patchField(EVENT_CF_ORDER, parking.id, { rules: whenBoth }))).toEqual([422, "invalid_show_when"]);
    expect((await stored(parking.id)).rules).toBeNull();
  });

  it("refuses a cycle, whichever of the two fields is saved last", async () => {
    const a = await makeField(EVENT_CF_ORDER, { source_field: "a", type: "boolean" });
    const b = await makeField(EVENT_CF_ORDER, { source_field: "b", type: "boolean" });
    expect((await patchField(EVENT_CF_ORDER, a.id, { rules: { show_when: { field: "b", value: true } } })).status).toBe(200);
    expect(await refusal(await patchField(EVENT_CF_ORDER, b.id, { rules: { show_when: { field: "a", value: true } } }))).toEqual([422, "invalid_show_when"]);
    expect((await stored(b.id)).rules).toBeNull();
    // Nor a field on its own.
    expect(await refusal(await patchField(EVENT_CF_ORDER, b.id, { rules: { show_when: { field: "b", value: true } } }))).toEqual([422, "invalid_show_when"]);
  });

  it("refuses to change the type of a field that others depend on with 409 field_controls_others", async () => {
    const { parking, day } = await seedPairs();
    const before = [await stored(parking.id), await stored(day.id)];
    for (const type of ["text", "long_text", "date", "datetime", "phone"]) {
      expect(await refusal(await patchField(EVENT_CF_ORDER, parking.id, { type })), `boolean to ${type}`).toEqual([409, "field_controls_others"]);
      expect(await refusal(await patchField(EVENT_CF_ORDER, day.id, { type })), `select to ${type}`).toEqual([409, "field_controls_others"]);
    }
    expect(await refusal(await patchField(EVENT_CF_ORDER, parking.id, { type: "select", options: ["true"] }))).toEqual([409, "field_controls_others"]);
    expect(await refusal(await patchField(EVENT_CF_ORDER, day.id, { type: "boolean", options: null }))).toEqual([409, "field_controls_others"]);
    expect([await stored(parking.id), await stored(day.id)]).toEqual(before);
  });

  it("refuses to remove or rename the option another field is shown for, and lets the others go", async () => {
    const { day } = await seedPairs();
    expect(await refusal(await patchField(EVENT_CF_ORDER, day.id, { options: ["Day 1", "Day 2"] }))).toEqual([409, "field_controls_others"]);
    expect(await refusal(await patchField(EVENT_CF_ORDER, day.id, { options: ["Day 1", "Day 2", "Both days"] }))).toEqual([409, "field_controls_others"]);
    expect(await refusal(await patchField(EVENT_CF_ORDER, day.id, { options: ["both"] }))).toEqual([409, "field_controls_others"]);
    expect((await stored(day.id)).options).toEqual(DAYS);
    expect((await patchField(EVENT_CF_ORDER, day.id, { options: ["Both", "Day 2"] })).status).toBe(200);
    expect((await patchField(EVENT_CF_ORDER, day.id, { options: ["Day 3", "Both", "Day 1"] })).status).toBe(200);
    expect((await stored(day.id)).options).toEqual(["Day 3", "Both", "Day 1"]);
  });

  it("lets the option go once nothing is shown for it", async () => {
    const { day, badge } = await seedPairs();
    expect((await patchField(EVENT_CF_ORDER, badge.id, { rules: null })).status).toBe(200);
    expect((await patchField(EVENT_CF_ORDER, day.id, { options: ["Day 1"] })).status).toBe(200);
  });

  it("lets a field that others depend on be changed in ways that do not matter to them", async () => {
    const { parking, day } = await seedPairs();
    expect((await patchField(EVENT_CF_ORDER, parking.id, { label: "Parking?", description: "Do you come by car?", required: true })).status).toBe(200);
    expect((await patchField(EVENT_CF_ORDER, parking.id, { rules: { icon: "parking" } })).status).toBe(200);
    expect((await patchField(EVENT_CF_ORDER, day.id, { options: [...DAYS, "Day 3"] })).status).toBe(200);
    expect((await patchField(EVENT_CF_ORDER, day.id, { options: [...DAYS].reverse() })).status).toBe(200);
  });

  it("lets a field with a condition change its type, its options and its other rules", async () => {
    const { plate } = await seedPairs();
    expect((await readField(await patchField(EVENT_CF_ORDER, plate.id, { type: "select", options: ["A"], rules: whenParking }))).type).toBe("select");
    expect((await readField(await patchField(EVENT_CF_ORDER, plate.id, { type: "text", options: null, rules: { ...whenParking, suggestions: ["A"] } }))).rules).toEqual({
      ...whenParking,
      suggestions: ["A"],
    });
  });

  it("lets a field with a condition be on the form only when the field it depends on is, and the other way round", async () => {
    const { parking, plate } = await seedPairs();
    // Both off the form: turning the dependent on is refused, turning the other on first makes it possible.
    expect(await refusal(await patchField(EVENT_CF_ORDER, plate.id, { show_on_form: true }))).toEqual([422, "show_when_not_on_form"]);
    expect((await stored(plate.id)).show_on_form).toBe(false);
    expect((await patchField(EVENT_CF_ORDER, parking.id, { show_on_form: true })).status).toBe(200);
    expect((await patchField(EVENT_CF_ORDER, plate.id, { show_on_form: true })).status).toBe(200);
    // Now the one it depends on may not leave the form.
    expect(await refusal(await patchField(EVENT_CF_ORDER, parking.id, { show_on_form: false }))).toEqual([422, "show_when_not_on_form"]);
    expect((await stored(parking.id)).show_on_form).toBe(true);
    // In the other order it may.
    expect((await patchField(EVENT_CF_ORDER, plate.id, { show_on_form: false })).status).toBe(200);
    expect((await patchField(EVENT_CF_ORDER, parking.id, { show_on_form: false })).status).toBe(200);
  });

  it("refuses to put on the form a field whose condition names one that is off it, also when the same PATCH sets the condition", async () => {
    const { plate } = await seedPairs();
    const free = await makeField(EVENT_CF_ORDER, { source_field: "free_on_form", show_on_form: true });
    expect(await refusal(await patchField(EVENT_CF_ORDER, free.id, { rules: whenParking }))).toEqual([422, "show_when_not_on_form"]);
    expect(await refusal(await patchField(EVENT_CF_ORDER, plate.id, { show_on_form: true, rules: whenParking }))).toEqual([422, "show_when_not_on_form"]);
  });

  it("keeps working in an event that takes registrations", async () => {
    await makeField(EVENT_CF_REG, { source_field: "parking", type: "boolean", show_on_form: true });
    const plate = await makeField(EVENT_CF_REG, { source_field: "plate", show_on_form: true, rules: whenParking });
    expect(await refusal(await patchField(EVENT_CF_REG, plate.id, { type: "select", options: ["A"], rules: { show_when: { field: "plate", value: true } } }))).toEqual([422, "invalid_show_when"]);
    expect((await patchField(EVENT_CF_REG, plate.id, { required: true })).status).toBe(200);
  });

  it("reads a condition a hand edit left naming no field, and still lets the field be saved", async () => {
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate" });
    await prisma.$executeRaw`UPDATE "EventCustomField" SET "rules" = '{"show_when": {"field": "gone", "value": true}}'::jsonb WHERE "id" = ${plate.id}`;
    expect((await listItems(EVENT_CF_ORDER))[0]).toMatchObject({ source_field: "plate", rules: { show_when: { field: "gone", value: true } } });
    expect((await patchField(EVENT_CF_ORDER, plate.id, { label: "Plate number", required: true })).status).toBe(200);
    // Saving the rules again is judged like any other save of a condition.
    expect(await refusal(await patchField(EVENT_CF_ORDER, plate.id, { rules: { show_when: { field: "gone", value: true } } }))).toEqual([422, "invalid_show_when"]);
    expect((await patchField(EVENT_CF_ORDER, plate.id, { rules: null })).status).toBe(200);
  });
});

describe("a condition between a question about the guest and one about their companion", () => {
  beforeEach(resetFormFixtures);

  /** A question about the companion, made straight in the database (the API makes them too: see the next block). */
  const makeCompanionField = (source_field: string, type = "boolean") =>
    prisma.eventCustomField.create({ data: { event_id: EVENT_CF_ORDER, source_field, label: source_field, type, show_on_form: true, applies_to: "companion" } });
  const whenPet = { show_when: { field: "pet", value: true } };

  it("refuses a question about the guest that is shown by a question about the companion, on create, with 422, and stores nothing", async () => {
    await makeCompanionField("pet");

    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "leash", show_on_form: true, rules: whenPet }))).toEqual([422, "invalid_show_when"]);

    expect(await prisma.eventCustomField.findMany({ where: { event_id: EVENT_CF_ORDER, applies_to: "guest" } })).toEqual([]);
  });

  it("refuses it on PATCH, and changes nothing", async () => {
    await makeCompanionField("pet");
    const leash = await makeField(EVENT_CF_ORDER, { source_field: "leash", show_on_form: true });
    const before = await stored(leash.id);

    expect(await refusal(await patchField(EVENT_CF_ORDER, leash.id, { rules: whenPet }))).toEqual([422, "invalid_show_when"]);
    expect(await stored(leash.id)).toEqual(before);
  });

  it("refuses a question about the companion that is shown by a question about the guest, on PATCH, with 422, and changes nothing", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean", show_on_form: true });
    const plate = await makeCompanionField("plate", "text");
    const before = await stored(plate.id);

    expect(await refusal(await patchField(EVENT_CF_ORDER, plate.id, { rules: whenParking }))).toEqual([422, "invalid_show_when"]);
    expect(await stored(plate.id)).toEqual(before);
  });

  it("keeps a condition between two questions about the companion, by the rules of any other: it is saved, and an answer it cannot have is refused", async () => {
    await makeCompanionField("pet");
    const leash = await makeCompanionField("leash", "text");

    expect((await readField(await patchField(EVENT_CF_ORDER, leash.id, { rules: whenPet }))).rules).toEqual(whenPet);
    expect((await stored(leash.id)).rules).toEqual(whenPet);
    expect(await refusal(await patchField(EVENT_CF_ORDER, leash.id, { rules: { show_when: { field: "pet", value: "Yes" } } }))).toEqual([422, "invalid_show_when"]);
  });

  it("still keeps a condition between two questions about the guest, as before", async () => {
    await makeCompanionField("pet");
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean", show_on_form: true });
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate", show_on_form: true, rules: whenParking });
    expect(plate.rules).toEqual(whenParking);
  });
});

describe("whose answer a question asks for", () => {
  beforeEach(resetFormFixtures);

  type Recipient = { applies_to: string };
  const recipientOf = async (res: Response): Promise<string> => ((await res.json()) as Recipient).applies_to;
  const makeCompanionQuestion = (body: Record<string, unknown>) => makeField(EVENT_CF_ORDER, { applies_to: "companion", ...body });

  it("is the guest's, and listed so, when the request names no recipient", async () => {
    const created = await createField(EVENT_CF_ORDER, { source_field: "shirt" });
    expect(created.status).toBe(201);
    expect(await recipientOf(created)).toBe("guest");
    expect((await prisma.eventCustomField.findFirstOrThrow({ where: { event_id: EVENT_CF_ORDER } })).applies_to).toBe("guest");
  });

  it("is the companion's when the request says so: stored, answered, and listed next to the guest's own", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "shirt" });
    const created = await createField(EVENT_CF_ORDER, { source_field: "badge", applies_to: "companion" });
    expect(created.status).toBe(201);
    const field = (await readField(created)) as TypedFieldItem & Recipient;
    expect(field.applies_to).toBe("companion");
    expect((await stored(field.id)).applies_to).toBe("companion");

    const listed = (await listItems(EVENT_CF_ORDER)) as (FieldItem & Recipient)[];
    expect(listed.map((item) => [item.source_field, item.applies_to])).toEqual([
      ["shirt", "guest"],
      ["badge", "companion"],
    ]);
  });

  it.each([["someone_else"], [null], [7], [""]])("refuses the recipient %j with 400, and creates nothing", async (appliesTo) => {
    const res = await createField(EVENT_CF_ORDER, { source_field: "badge", applies_to: appliesTo });
    expect(await refusal(res)).toEqual([400, "validation_failed"]);
    expect(await fieldCount()).toBe(0);
  });

  it("moves a question that nothing depends on to the other recipient, and back", async () => {
    const field = await makeField(EVENT_CF_ORDER, { source_field: "badge" });

    expect(await recipientOf(await patchField(EVENT_CF_ORDER, field.id, { applies_to: "companion" }))).toBe("companion");
    expect((await stored(field.id)).applies_to).toBe("companion");
    expect(await recipientOf(await patchField(EVENT_CF_ORDER, field.id, { applies_to: "guest" }))).toBe("guest");
    expect((await stored(field.id)).applies_to).toBe("guest");
  });

  it("changes nothing else when only the recipient is sent, and keeps the recipient when the same one is sent again", async () => {
    const field = await makeField(EVENT_CF_ORDER, { source_field: "badge", label: "Badge name", description: "On the badge", required: true, show_on_form: true });
    const kept = async () => {
      const { label, description, type, required, show_on_form, options, rules, display_order } = await prisma.eventCustomField.findUniqueOrThrow({ where: { id: field.id } });
      return { label, description, type, required, show_on_form, options, rules, display_order };
    };
    const before = await kept();

    expect((await patchField(EVENT_CF_ORDER, field.id, { applies_to: "guest" })).status).toBe(200);
    expect((await stored(field.id)).applies_to).toBe("guest");
    expect(await kept()).toEqual(before);

    expect((await patchField(EVENT_CF_ORDER, field.id, { applies_to: "companion" })).status).toBe(200);
    expect((await stored(field.id)).applies_to).toBe("companion");
    expect(await kept()).toEqual(before);
  });

  it("refuses to move a question that others are shown by, with 409 field_controls_others, and changes nothing", async () => {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking });
    const before = await stored(parking.id);

    expect(await refusal(await patchField(EVENT_CF_ORDER, parking.id, { applies_to: "companion" }))).toEqual([409, "field_controls_others"]);
    expect(await stored(parking.id)).toEqual(before);
  });

  it("refuses it for a question of the companion that other questions of the companion wait for, and lets it move once they are free", async () => {
    const parking = await makeCompanionQuestion({ source_field: "parking", type: "boolean", show_on_form: true });
    const plate = await makeCompanionQuestion({ source_field: "plate", show_on_form: true, rules: whenParking });

    expect(await refusal(await patchField(EVENT_CF_ORDER, parking.id, { applies_to: "guest" }))).toEqual([409, "field_controls_others"]);
    expect((await stored(parking.id)).applies_to).toBe("companion");

    expect((await patchField(EVENT_CF_ORDER, plate.id, { rules: null })).status).toBe(200);
    expect(await recipientOf(await patchField(EVENT_CF_ORDER, parking.id, { applies_to: "guest" }))).toBe("guest");
  });

  it("refuses to move a question that waits for another to the other recipient, with 422 invalid_show_when, and changes nothing", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking });
    const before = await stored(plate.id);

    expect(await refusal(await patchField(EVENT_CF_ORDER, plate.id, { applies_to: "companion" }))).toEqual([422, "invalid_show_when"]);
    expect(await stored(plate.id)).toEqual(before);
  });

  it("moves a question and its condition together to the other recipient when the same save does both", async () => {
    await makeCompanionQuestion({ source_field: "parking", type: "boolean" });
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate" });

    expect(await refusal(await patchField(EVENT_CF_ORDER, plate.id, { rules: whenParking }))).toEqual([422, "invalid_show_when"]);
    expect((await patchField(EVENT_CF_ORDER, plate.id, { applies_to: "companion", rules: whenParking })).status).toBe(200);
    expect(await stored(plate.id)).toMatchObject({ applies_to: "companion", rules: whenParking });
  });

  it("judges the condition of a new question by its recipient: one about the companion may wait for another about the companion, and not for one about the guest", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean", show_on_form: true });
    await makeCompanionQuestion({ source_field: "pet", type: "boolean", show_on_form: true });
    const whenPet = { show_when: { field: "pet", value: true } };

    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "plate", applies_to: "companion", show_on_form: true, rules: whenParking }))).toEqual([422, "invalid_show_when"]);
    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "leash", show_on_form: true, rules: whenPet }))).toEqual([422, "invalid_show_when"]);
    expect(await fieldCount()).toBe(2);

    const leash = await makeField(EVENT_CF_ORDER, { source_field: "leash", applies_to: "companion", show_on_form: true, rules: whenPet });
    expect(leash.rules).toEqual(whenPet);
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate", show_on_form: true, rules: whenParking });
    expect(plate.rules).toEqual(whenParking);
  });

  it("asks of a question about the companion what it asks of any question: a Required one must be on the form", async () => {
    for (const body of [
      { source_field: "needed", required: true, applies_to: "companion" },
      { source_field: "needed", required: true, show_on_form: false, applies_to: "companion" },
    ]) {
      expect(await refusal(await createField(EVENT_CF_REG, body))).toEqual([422, "required_field_not_on_form"]);
    }
    expect(await prisma.eventCustomField.count({ where: { event_id: EVENT_CF_REG } })).toBe(0);
    expect((await createField(EVENT_CF_REG, { source_field: "asked", required: true, show_on_form: true, applies_to: "companion" })).status).toBe(201);

    const hidden = await prisma.eventCustomField.create({
      data: { event_id: EVENT_CF_REG, source_field: "hidden", label: "Hidden", show_on_form: false, applies_to: "companion" },
    });
    expect(await refusal(await patchField(EVENT_CF_REG, hidden.id, { required: true }))).toEqual([422, "required_field_not_on_form"]);
    // Moving it to the guest does not make it ask for what it does not ask for.
    expect((await patchField(EVENT_CF_REG, hidden.id, { applies_to: "guest" })).status).toBe(200);
  });

  it("counts the questions of both recipients against the limit of the event", async () => {
    const rows = Array.from({ length: 19 }, (_, index) => ({
      event_id: EVENT_CF_ORDER,
      source_field: `q${index}`,
      label: `Question ${index}`,
      applies_to: index % 2 === 0 ? "guest" : "companion",
    }));
    await prisma.eventCustomField.createMany({ data: rows });

    expect((await createField(EVENT_CF_ORDER, { source_field: "twentieth", applies_to: "companion" })).status).toBe(201);
    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "twenty_first", applies_to: "companion" }))).toEqual([422, "field_limit_reached"]);
    expect(await refusal(await createField(EVENT_CF_ORDER, { source_field: "twenty_first", applies_to: "guest" }))).toEqual([422, "field_limit_reached"]);
  });

  it("is refused for an operator, and on an archived event, as every change of a field is", async () => {
    const field = await makeField(EVENT_CF_ORDER, { source_field: "badge" });
    const asOperator = await app.request(`/api/admin/events/${EVENT_CF_ORDER}/custom-fields/${field.id}`, {
      method: "PATCH",
      headers: { Cookie: opCookie, "Content-Type": "application/json", ...sameOrigin },
      body: JSON.stringify({ applies_to: "companion" }),
    });
    expect(asOperator.status).toBe(403);
    expect((await stored(field.id)).applies_to).toBe("guest");

    const archived = await prisma.eventCustomField.create({ data: { event_id: EVENT_CF_ARCHIVED, source_field: "badge", label: "Badge" } });
    try {
      const refused = await patchField(EVENT_CF_ARCHIVED, archived.id, { applies_to: "companion" });
      expect([refused.status, await refused.json()]).toEqual([403, { code: "event_archived" }]);
      expect((await stored(archived.id)).applies_to).toBe("guest");
      const createdThere = await createField(EVENT_CF_ARCHIVED, { source_field: "other", applies_to: "companion" });
      expect(createdThere.status).toBe(403);
    } finally {
      await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_CF_ARCHIVED } });
    }
  });
});

describe("deleting a field that others are shown by", () => {
  beforeEach(resetFormFixtures);

  it("is refused with 409 field_controls_others, and nothing is deleted", async () => {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    const day = await makeField(EVENT_CF_ORDER, { source_field: "day", type: "select", options: DAYS });
    await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking });
    await makeField(EVENT_CF_ORDER, { source_field: "badge", rules: whenBoth });

    expect(await refusal(await deleteField(EVENT_CF_ORDER, parking.id))).toEqual([409, "field_controls_others"]);
    expect(await refusal(await deleteField(EVENT_CF_ORDER, day.id))).toEqual([409, "field_controls_others"]);
    expect(await fieldCount()).toBe(4);
  });

  it("goes through once the fields that depend on it are changed or gone, in either way", async () => {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    const day = await makeField(EVENT_CF_ORDER, { source_field: "day", type: "select", options: DAYS });
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking });
    const badge = await makeField(EVENT_CF_ORDER, { source_field: "badge", rules: whenBoth });

    expect((await deleteField(EVENT_CF_ORDER, plate.id)).status).toBe(200);
    expect((await deleteField(EVENT_CF_ORDER, parking.id)).status).toBe(200);
    expect((await patchField(EVENT_CF_ORDER, badge.id, { rules: null })).status).toBe(200);
    expect((await deleteField(EVENT_CF_ORDER, day.id)).status).toBe(200);
    expect(await fieldCount()).toBe(1);
  });

  it("deletes a field with a condition at once, and a field that only looks like a controller", async () => {
    await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking });
    const other = await makeField(EVENT_CF_ORDER, { source_field: "parking_two", type: "boolean" });
    expect((await deleteField(EVENT_CF_ORDER, other.id)).status).toBe(200);
    expect((await deleteField(EVENT_CF_ORDER, plate.id)).status).toBe(200);
  });

  it("only looks at the fields of the same event", async () => {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    await makeField(EVENT_CF_REG_OFF, { source_field: "parking", type: "boolean" });
    await makeField(EVENT_CF_REG_OFF, { source_field: "plate", rules: whenParking });
    expect((await deleteField(EVENT_CF_ORDER, parking.id)).status).toBe(200);
  });

  it("is refused for a field that is also used by an item, as before", async () => {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking });
    await prisma.eventItem.create({ data: { event_id: EVENT_CF_ORDER, key: "parking_item", label: "Parking item", config: { content_fields: ["parking"] } } });
    try {
      expect(await refusal(await deleteField(EVENT_CF_ORDER, parking.id))).toEqual([409, "field_in_use"]);
    } finally {
      await prisma.eventItem.deleteMany({ where: { event_id: EVENT_CF_ORDER } });
    }
  });
});

describe("conditions between fields, saved at the same time", () => {
  beforeEach(resetFormFixtures);

  /** Runs `act` while this test holds the lock of the event's fields, so that every request it starts has passed its first
   * read and queues behind the lock. `act` changes the rows the way a request that committed meanwhile would. */
  async function whileLocked(eventId: string, start: () => Promise<Response>[], act: (tx: Prisma.TransactionClient) => Promise<void>): Promise<Response[]> {
    let pending: Promise<Response>[] = [];
    await prisma.$transaction(async (tx) => {
      await acquireEventCustomFieldsLock(tx, eventId);
      pending = start();
      await new Promise((resolve) => setTimeout(resolve, 250));
      await act(tx);
    });
    return Promise.all(pending);
  }

  it("creates no field that depends on a field deleted while the save waited", async () => {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    const [res] = await whileLocked(
      EVENT_CF_ORDER,
      () => [createField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking })],
      async (tx) => {
        await tx.eventCustomField.delete({ where: { id: parking.id } });
      },
    );
    expect(await refusal(res!)).toEqual([422, "invalid_show_when"]);
    expect(await fieldCount()).toBe(0);
  });

  it("does not delete a field that a field created while the delete waited depends on", async () => {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    const [res] = await whileLocked(
      EVENT_CF_ORDER,
      () => [deleteField(EVENT_CF_ORDER, parking.id)],
      async (tx) => {
        await tx.eventCustomField.create({ data: { event_id: EVENT_CF_ORDER, source_field: "plate", label: "Plate", rules: whenParking } });
      },
    );
    expect(await refusal(res!)).toEqual([409, "field_controls_others"]);
    expect(await fieldCount()).toBe(2);
  });

  it("does not change the type of a field that a field created while the PATCH waited depends on", async () => {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
    const [res] = await whileLocked(
      EVENT_CF_ORDER,
      () => [patchField(EVENT_CF_ORDER, parking.id, { type: "text" })],
      async (tx) => {
        await tx.eventCustomField.create({ data: { event_id: EVENT_CF_ORDER, source_field: "plate", label: "Plate", rules: whenParking } });
      },
    );
    expect(await refusal(res!)).toEqual([409, "field_controls_others"]);
    expect((await stored(parking.id)).type).toBe("boolean");
  });

  it("does not remove an option that a condition added while the PATCH waited names", async () => {
    const day = await makeField(EVENT_CF_ORDER, { source_field: "day", type: "select", options: DAYS });
    const [res] = await whileLocked(
      EVENT_CF_ORDER,
      () => [patchField(EVENT_CF_ORDER, day.id, { options: ["Day 1"] })],
      async (tx) => {
        await tx.eventCustomField.create({ data: { event_id: EVENT_CF_ORDER, source_field: "badge", label: "Badge", rules: whenBoth } });
      },
    );
    expect(await refusal(res!)).toEqual([409, "field_controls_others"]);
    expect((await stored(day.id)).options).toEqual(DAYS);
  });

  it("does not put a field on the form whose controller left it while the PATCH waited", async () => {
    const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean", show_on_form: true });
    const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking });
    const [res] = await whileLocked(
      EVENT_CF_ORDER,
      () => [patchField(EVENT_CF_ORDER, plate.id, { show_on_form: true })],
      async (tx) => {
        await tx.eventCustomField.update({ where: { id: parking.id }, data: { show_on_form: false } });
      },
    );
    expect(await refusal(res!)).toEqual([422, "show_when_not_on_form"]);
    expect((await stored(plate.id)).show_on_form).toBe(false);
  });

  it("never leaves a dependent without its controller when a delete and a create race", async () => {
    for (let round = 0; round < 6; round += 1) {
      await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_CF_ORDER } });
      const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
      const [removed, made] = await Promise.all([
        deleteField(EVENT_CF_ORDER, parking.id),
        createField(EVENT_CF_ORDER, { source_field: "plate", rules: whenParking }),
      ]);
      // One of the two wins. Whichever it is, the survivors are consistent.
      expect([removed.status, made.status].sort()).toSatisfy((statuses: number[]) => (statuses[0] === 200 || statuses[0] === 201) && statuses[1] !== undefined && statuses[1] >= 400);
      const rows = await prisma.eventCustomField.findMany({ where: { event_id: EVENT_CF_ORDER } });
      const dangling = rows.some((row) => row.source_field === "plate") && !rows.some((row) => row.source_field === "parking");
      expect(dangling).toBe(false);
    }
  });

  it("never closes a cycle when two fields are each given a condition on the other at once", async () => {
    for (let round = 0; round < 6; round += 1) {
      await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_CF_ORDER } });
      const a = await makeField(EVENT_CF_ORDER, { source_field: "a", type: "boolean" });
      const b = await makeField(EVENT_CF_ORDER, { source_field: "b", type: "boolean" });
      const [x, y] = await Promise.all([
        patchField(EVENT_CF_ORDER, a.id, { rules: { show_when: { field: "b", value: true } } }),
        patchField(EVENT_CF_ORDER, b.id, { rules: { show_when: { field: "a", value: true } } }),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 422]);
      const rows = await prisma.eventCustomField.findMany({ where: { event_id: EVENT_CF_ORDER } });
      expect(rows.filter((row) => row.rules !== null)).toHaveLength(1);
    }
  });

  it("never leaves a condition on a field that stopped being yes/no when a retype and a new condition race", async () => {
    for (let round = 0; round < 6; round += 1) {
      await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_CF_ORDER } });
      const parking = await makeField(EVENT_CF_ORDER, { source_field: "parking", type: "boolean" });
      const plate = await makeField(EVENT_CF_ORDER, { source_field: "plate" });
      const [retyped, conditioned] = await Promise.all([
        patchField(EVENT_CF_ORDER, parking.id, { type: "text" }),
        patchField(EVENT_CF_ORDER, plate.id, { rules: whenParking }),
      ]);
      expect([retyped.status, conditioned.status].sort()).toSatisfy((statuses: number[]) => statuses.includes(200) && statuses.some((status) => status >= 400));
      const rows = new Map((await prisma.eventCustomField.findMany({ where: { event_id: EVENT_CF_ORDER } })).map((row) => [row.source_field, row]));
      const dependsOnParking = rows.get("plate")?.rules !== null;
      expect(dependsOnParking && rows.get("parking")?.type !== "boolean").toBe(false);
    }
  });
});
