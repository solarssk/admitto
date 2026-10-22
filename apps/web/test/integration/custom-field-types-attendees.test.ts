import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { createAdminAndOp } from "../helpers/seed-org-and-event.js";
import { bootSingleOrgFixture } from "../helpers/boot-single-org-fixture.js";

// The answer types long text, date, date and time and phone, and the format rules, as the staff API,
// the Attendees list and the custom fields report read them (v0.8).

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_ID = "org-field-types-att";
const EVENT_ID = "evt-field-types-att";
const EMAIL_ADMIN = "field-types-att-admin@example.com";
const EMAIL_OP = "field-types-att-op@example.com";
const PASSWORD = "test-password";

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

  await client.organization.create({ data: { id: ORG_ID, name: "Field Types Org", slug: "field-types-org" } });
  await client.event.create({
    data: { id: EVENT_ID, title: "Field Types Event", slug: "field-types-event", date: new Date("2026-11-04"), organization_id: ORG_ID },
  });
  await client.eventCustomField.createMany({
    data: [
      { event_id: EVENT_ID, source_field: "notes", label: "Notes", type: "long_text", display_order: 0 },
      { event_id: EVENT_ID, source_field: "arrival", label: "Arrival date", type: "date", display_order: 1 },
      { event_id: EVENT_ID, source_field: "arrives_at", label: "Arrival time", type: "datetime", display_order: 2 },
      { event_id: EVENT_ID, source_field: "phone", label: "Mobile phone", type: "phone", display_order: 3 },
      {
        event_id: EVENT_ID,
        source_field: "plate",
        label: "Plate",
        type: "text",
        display_order: 4,
        rules: { digits_only: true, min_length: 3, max_length: 6, example: "123456" },
      },
      { event_id: EVENT_ID, source_field: "diet", label: "Diet", type: "text", display_order: 5 },
    ],
  });

  const passwordHash = await hashPassword(PASSWORD);
  const { adminId, opId } = await createAdminAndOp(client, {
    adminEmail: EMAIL_ADMIN,
    opEmail: EMAIL_OP,
    passwordHash,
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
  await prisma?.$disconnect();
});

const jsonAdmin = () => ({ Cookie: adminCookie, "Content-Type": "application/json", ...sameOrigin });

type CreatedAttendee = { id: string; custom_data: Record<string, string> | null };

function createAttendee(custom_data: Record<string, unknown>): Promise<Response> {
  counter += 1;
  return Promise.resolve(
    app.request(`/api/admin/events/${EVENT_ID}/attendees`, {
      method: "POST",
      headers: jsonAdmin(),
      body: JSON.stringify({ email: `field-types-${counter}@example.com`, first_name: "Ann", last_name: `Guest${counter}`, custom_data }),
    }),
  );
}

async function updatedAt(attendeeId: string): Promise<string> {
  return (await prisma.attendee.findUniqueOrThrow({ where: { id: attendeeId }, select: { updated_at: true } })).updated_at.toISOString();
}

async function patchAttendee(attendeeId: string, custom_data_fields: Record<string, string | null>): Promise<Response> {
  return app.request(`/api/admin/events/${EVENT_ID}/attendees/${attendeeId}`, {
    method: "PATCH",
    headers: jsonAdmin(),
    body: JSON.stringify({ custom_data_fields, expected_updated_at: await updatedAt(attendeeId) }),
  });
}

async function storedCustomData(attendeeId: string): Promise<unknown> {
  return (await prisma.attendee.findUniqueOrThrow({ where: { id: attendeeId } })).custom_data;
}

describe("creating an attendee with the new answer types", () => {
  it("stores each answer in its normal form", async () => {
    const res = await createAttendee({
      notes: "Two seats,\r\nplease.",
      arrival: "2026-11-04",
      arrives_at: "2026-11-04T10:30",
      phone: "+48 600-100-200",
      plate: "123456",
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as CreatedAttendee;
    const expected = {
      notes: "Two seats,\nplease.",
      arrival: "2026-11-04",
      arrives_at: "2026-11-04T10:30",
      phone: "+48600100200",
      plate: "123456",
    };
    expect(created.custom_data).toMatchObject(expected);
    expect(await storedCustomData(created.id)).toMatchObject(expected);
  });

  it.each([
    ["a date that does not exist", { arrival: "2026-02-30" }, "arrival"],
    ["a date and time with a zone", { arrives_at: "2026-11-04T10:30Z" }, "arrives_at"],
    ["a phone number with too few digits", { phone: "12" }, "phone"],
    ["a phone number with letters", { phone: "call me" }, "phone"],
    ["text with a letter, for digits only", { plate: "12a" }, "plate"],
    ["text shorter than the rule", { plate: "12" }, "plate"],
    ["text longer than the rule", { plate: "1234567" }, "plate"],
    ["a long text of 1001 characters", { notes: "n".repeat(1001) }, "notes"],
    ["a text of 101 characters, which staff input has always refused", { diet: "d".repeat(101) }, "diet"],
  ])("refuses %s with 400 validation_failed naming the field, and echoes no value", async (_label, answers, field) => {
    const res = await createAttendee(answers);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "validation_failed", field });
    for (const value of Object.values(answers)) expect(text).not.toContain(String(value));
  });

  it("accepts a long text of exactly 1000 characters and a text of exactly 100", async () => {
    const res = await createAttendee({ notes: "n".repeat(1000), diet: "d".repeat(100) });
    expect(res.status).toBe(201);
    expect(await storedCustomData(((await res.json()) as CreatedAttendee).id)).toMatchObject({
      notes: "n".repeat(1000),
      diet: "d".repeat(100),
    });
  });

  it("refuses a value that is far longer than any field takes without reading it as an answer", async () => {
    expect((await createAttendee({ notes: "n".repeat(2001) })).status).toBe(400);
    expect((await createAttendee({ notes: "n".repeat(100_000) })).status).toBe(400);
  });

  it("keeps refusing an answer to a field the event does not have", async () => {
    const res = await createAttendee({ no_such_field: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_custom_data_field", field: "no_such_field" });
  });
});

describe("editing the answers of an attendee", () => {
  it("writes the canonical phone number and date, and a long text of 1000 characters", async () => {
    const created = (await (await createAttendee({ diet: "vegan" })).json()) as CreatedAttendee;

    const res = await patchAttendee(created.id, { phone: "(22) 123-45-67", arrival: " 2026-11-05 ", notes: "n".repeat(1000) });
    expect(res.status).toBe(200);
    expect(await storedCustomData(created.id)).toEqual({
      diet: "vegan",
      phone: "221234567",
      arrival: "2026-11-05",
      notes: "n".repeat(1000),
    });
  });

  it("refuses a wrong answer, a long text of 1001 characters and a text over 100 characters, and changes nothing", async () => {
    const created = (await (await createAttendee({ phone: "600100200" })).json()) as CreatedAttendee;

    for (const [field, value] of [
      ["arrival", "2026-02-30"],
      ["phone", "12"],
      ["plate", "12a"],
      ["notes", "n".repeat(1001)],
      ["diet", "d".repeat(101)],
    ] as const) {
      const res = await patchAttendee(created.id, { [field]: value });
      expect(res.status, field).toBe(400);
      expect(await res.json()).toEqual({ error: "validation_failed", field });
    }
    expect(await storedCustomData(created.id)).toEqual({ phone: "600100200" });
  });

  it("clears an answer with null, whatever its type", async () => {
    const created = (await (await createAttendee({ phone: "600100200", arrival: "2026-11-04", notes: "hello" })).json()) as CreatedAttendee;
    const res = await patchAttendee(created.id, { phone: null, arrival: null, notes: null });
    expect(res.status).toBe(200);
    expect(await storedCustomData(created.id)).toEqual({});
  });

  it("holds the answers already stored to the rules, so an older answer must be fixed before the attendee is saved again", async () => {
    const created = (await (await createAttendee({ diet: "vegan" })).json()) as CreatedAttendee;
    // An answer from before the rule: written straight to the database.
    await prisma.attendee.update({ where: { id: created.id }, data: { custom_data: { diet: "vegan", plate: "12a" } } });

    const blocked = await patchAttendee(created.id, { diet: "halal" });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: "validation_failed", field: "plate" });

    const fixed = await patchAttendee(created.id, { diet: "halal", plate: "123" });
    expect(fixed.status).toBe(200);
    expect(await storedCustomData(created.id)).toEqual({ diet: "halal", plate: "123" });
  });
});

describe("filtering the Attendees list by the new types", () => {
  let one: CreatedAttendee;
  let two: CreatedAttendee;

  // Values no other test of this file writes, so a filter finds exactly these attendees.
  beforeAll(async () => {
    one = (await (
      await createAttendee({
        phone: "+48 777 100 200",
        arrival: "2027-03-14",
        arrives_at: "2027-03-14T09:41",
        notes: "Quokka seats, front row",
      })
    ).json()) as CreatedAttendee;
    two = (await (await createAttendee({ phone: "778 555 000", arrival: "2027-04-01", notes: "Wombat lunch" })).json()) as CreatedAttendee;
  });

  async function filtered(query: Record<string, string>): Promise<string[]> {
    const qs = new URLSearchParams({ pageSize: "100", ...query });
    const res = await app.request(`/api/admin/events/${EVENT_ID}/attendees?${qs.toString()}`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: { id: string }[] }).items.map((item) => item.id);
  }

  it("matches the text a date, a date and time, a phone number or a long text contains", async () => {
    expect(await filtered({ cf_arrival: "2027-03" })).toEqual([one.id]);
    expect((await filtered({ cf_arrival: "2027-0" })).sort()).toEqual([one.id, two.id].sort());
    expect(await filtered({ cf_arrives_at: "T09:41" })).toEqual([one.id]);
    expect(await filtered({ cf_notes: "front row" })).toEqual([one.id]);
    expect(await filtered({ cf_notes: "WOMBAT" })).toEqual([two.id]);
  });

  it("searches a phone number by its digits, however the person typing writes it", async () => {
    for (const typed of ["+48777", "+48 777 100", "48777", "(+48) 777", "777-100"]) {
      expect(await filtered({ cf_phone: typed }), typed).toEqual([one.id]);
    }
    expect(await filtered({ cf_phone: "778 555" })).toEqual([two.id]);
    // Nothing is left of the text once the letters are gone, so there is no filter at all.
    expect((await filtered({ cf_phone: "abc" })).length).toBeGreaterThanOrEqual(2);
  });

  it("clamps the text it looks for to 200 characters, as for a text field", async () => {
    expect(await filtered({ cf_notes: "x".repeat(300) })).toEqual([]);
  });
});

describe("the custom fields report with the new types", () => {
  it("charts each as a fill rate, like a text field, and keeps the order of the fields", async () => {
    await createAttendee({ phone: "600100200", arrival: "2026-11-04" });
    const res = await app.request(`/api/admin/events/${EVENT_ID}/reports/custom-fields`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_attendees: number;
      fields: { source_field: string; type: string; distribution: unknown; response_rate: { answered: number; pct: number } | null }[];
    };
    expect(body.fields.map((field) => field.source_field)).toEqual(["notes", "arrival", "arrives_at", "phone", "plate", "diet"]);
    for (const field of body.fields) {
      expect(field.type, field.source_field).toBe("text");
      expect(field.distribution).toBeNull();
      expect(field.response_rate?.answered).toBeGreaterThanOrEqual(0);
    }
    const phone = body.fields.find((field) => field.source_field === "phone")!;
    expect(phone.response_rate!.answered).toBeGreaterThanOrEqual(1);
    expect(phone.response_rate!.pct).toBeGreaterThan(0);
  });

  it("exports the report as CSV and PDF without failing on a new type", async () => {
    const csv = await app.request(`/api/admin/events/${EVENT_ID}/reports/export?format=csv&report=customfields`, { headers: { Cookie: adminCookie } });
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text).toContain('"Notes","Arrival date","Arrival time","Mobile phone","Plate","Diet"');
    expect(text).toContain("2026-11-04");

    const pdf = await app.request(`/api/admin/events/${EVENT_ID}/reports/export?format=pdf&report=customfields`, { headers: { Cookie: adminCookie } });
    expect(pdf.status).toBe(200);
    const html = await pdf.text();
    expect(html).toContain("Mobile phone");
    expect(html).toContain("Answered");
  });
});
