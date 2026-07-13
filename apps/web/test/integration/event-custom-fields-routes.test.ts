import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_CF = "org-custom-fields";
const EVENT_CF = "evt-custom-fields";
const EVENT_CF_OTHER = "evt-custom-fields-other";

const EMAIL_ADMIN = "custom-fields-admin@example.com";
const EMAIL_OP = "custom-fields-op@example.com";
const PASSWORD = "custom-fields-pass-123";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";

async function seed(client: PrismaClient) {
  await client.eventItem.deleteMany({ where: { event_id: { in: [EVENT_CF, EVENT_CF_OTHER] } } });
  await client.eventCustomField.deleteMany({ where: { event_id: { in: [EVENT_CF, EVENT_CF_OTHER] } } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_CF, EVENT_CF, EVENT_CF_OTHER] } } });
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: EMAIL_ADMIN } } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_CF, EVENT_CF_OTHER] } } });
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
    ],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_CF },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_CF },
    ],
  });

  await client.userMfaMethod.create({
    data: {
      user_id: adminId,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
}

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    checkinToken: "custom-fields-checkin-token-32-chr!",
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
  adminCookie = await sessionCookieFor(adminId);
  opCookie = await sessionCookieFor(opId);
});

afterAll(async () => {
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
});

describe("POST /api/admin/events/:eventId/custom-fields", () => {
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
