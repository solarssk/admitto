import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
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
