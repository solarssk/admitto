import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import type { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { createAdminAndOp } from "../helpers/seed-org-and-event.js";
import { bootSingleOrgFixture } from "../helpers/boot-single-org-fixture.js";

/**
 * A question about a companion (EventCustomField.applies_to = "companion") is answered into the companion's row, never into
 * the attendee's, so everything that reads or writes an attendee's own answers must not see it: the Attendees list, the
 * custom fields report and its export, and the staff forms. With such a question in the event, each answers as it does for
 * an event that has none.
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_ID = "org-companion-fields";
const EVENT_ID = "evt-companion-fields";
const EMAIL_ADMIN = "companion-fields-admin@example.com";
const EMAIL_OP = "companion-fields-op@example.com";

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
let adminCookie = "";
let counter = 0;

async function seed(client: PrismaClient) {
  await client.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await client.eventCustomField.deleteMany({ where: { event_id: EVENT_ID } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG_ID, EVENT_ID] } } });
  await client.session.deleteMany({ where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: EMAIL_ADMIN } } });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: EVENT_ID } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  await client.organization.create({ data: { id: ORG_ID, name: "Companion Fields Org", slug: "companion-fields-org" } });
  await client.event.create({
    data: { id: EVENT_ID, title: "Companion Fields Event", slug: "companion-fields-event", date: new Date("2030-11-04"), organization_id: ORG_ID },
  });
  await client.eventCustomField.createMany({
    data: [
      { event_id: EVENT_ID, source_field: "diet", label: "Diet", type: "select", options: ["vegan", "none"], display_order: 0 },
      { event_id: EVENT_ID, source_field: "badge", label: "Badge of the companion", type: "select", options: ["A", "B"], display_order: 1, applies_to: "companion" },
      { event_id: EVENT_ID, source_field: "plate", label: "Plate of the companion", type: "text", display_order: 2, applies_to: "companion" },
    ],
  });
  const { adminId, opId } = await createAdminAndOp(client, {
    adminEmail: EMAIL_ADMIN,
    opEmail: EMAIL_OP,
    passwordHash: await hashPassword("test-password"),
    orgId: ORG_ID,
    eventId: EVENT_ID,
  });
  await enrollConfirmedTotp(client, adminId);
  return { adminId, opId };
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  const { adminId, opId } = await seed(prisma);
  ({ app, adminCookie } = await bootSingleOrgFixture({
    prisma,
    adminId,
    opId,
    checkinToken: "checkin-token-checkin-token-checkin-token",
    adminDistRoot,
  }));
});

afterAll(async () => {
  await prisma?.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma?.eventCustomField.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma?.$disconnect();
});

const jsonAdmin = () => ({ Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin });

function createAttendee(custom_data: Record<string, unknown>): Promise<Response> {
  counter += 1;
  return Promise.resolve(
    app.request(`/api/admin/events/${EVENT_ID}/attendees`, {
      method: "POST",
      headers: jsonAdmin(),
      body: JSON.stringify({ email: `companion-fields-${counter}@example.com`, first_name: "Ann", last_name: `Guest${counter}`, custom_data }),
    }),
  );
}

async function listIds(query: string): Promise<string[]> {
  const res = await app.request(`/api/admin/events/${EVENT_ID}/attendees?pageSize=100${query}`, { headers: { Cookie: adminCookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: { id: string }[] }).items.map((item) => item.id);
}

describe("an event that asks about a companion", () => {
  it("has no filter on a question about a companion in the Attendees list: it filters on the guest's questions only", async () => {
    const vegan = (await (await createAttendee({ diet: "vegan" })).json()) as { id: string };
    const none = (await (await createAttendee({ diet: "none" })).json()) as { id: string };

    expect(await listIds("&cf_diet=vegan")).toEqual([vegan.id]);
    // The companion's question is no field of the attendee's: a filter on it is no filter, and the list is whole.
    expect((await listIds("&cf_badge=A")).sort()).toEqual([vegan.id, none.id].sort());
    expect((await listIds("&cf_plate=WA")).sort()).toEqual([vegan.id, none.id].sort());
  });

  it("leaves a question about a companion out of the custom fields report, as a chart and as a file", async () => {
    await createAttendee({ diet: "vegan" });

    const report = await app.request(`/api/admin/events/${EVENT_ID}/reports/custom-fields`, { headers: { Cookie: adminCookie } });
    expect(report.status).toBe(200);
    expect(((await report.json()) as { fields: { source_field: string }[] }).fields.map((field) => field.source_field)).toEqual(["diet"]);

    const file = await app.request(`/api/admin/events/${EVENT_ID}/reports/export?format=csv&report=customfields`, { headers: { Cookie: adminCookie } });
    expect(file.status).toBe(200);
    const csv = await file.text();
    expect(csv).toContain("Diet");
    expect(csv).not.toContain("Badge of the companion");
    expect(csv).not.toContain("Plate of the companion");
  });

  it("refuses an answer to a question about a companion when an attendee is added, as it refuses any unknown question", async () => {
    const res = await createAttendee({ diet: "vegan", badge: "A" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_custom_data_field", field: "badge" });
  });

  it("refuses to set one when an attendee's answers are edited, and leaves the attendee's answers as they were", async () => {
    const created = (await (await createAttendee({ diet: "vegan" })).json()) as { id: string };
    const updated = (await prisma.attendee.findUniqueOrThrow({ where: { id: created.id }, select: { updated_at: true } })).updated_at;

    const res = await app.request(`/api/admin/events/${EVENT_ID}/attendees/${created.id}`, {
      method: "PATCH",
      headers: jsonAdmin(),
      body: JSON.stringify({ custom_data_fields: { badge: "A" }, expected_updated_at: updated.toISOString() }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown_custom_data_field", field: "badge" });
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: created.id } })).custom_data).toEqual({ diet: "vegan" });
  });
});
