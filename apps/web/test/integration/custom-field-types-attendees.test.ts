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

// A question that is asked only for a certain answer to another one, as the staff API reads it (v0.8).

describe("a question with a condition, in the staff API", () => {
  const EVENT_COND = "evt-field-conditions-att";
  let condCounter = 0;

  beforeAll(async () => {
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_COND } });
    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_COND } });
    await prisma.event.deleteMany({ where: { id: EVENT_COND } });
    await prisma.event.create({
      data: { id: EVENT_COND, title: "Conditions Event", slug: "conditions-event", date: new Date("2026-11-05"), organization_id: ORG_ID },
    });
    await prisma.eventCustomField.createMany({
      data: [
        { event_id: EVENT_COND, source_field: "parking", label: "Parking", type: "boolean", display_order: 0 },
        {
          event_id: EVENT_COND,
          source_field: "plate",
          label: "Plate",
          type: "text",
          required: true,
          display_order: 1,
          rules: { show_when: { field: "parking", value: true } },
        },
        { event_id: EVENT_COND, source_field: "day", label: "Day", type: "select", options: ["Day 1", "Day 2", "Both"], display_order: 2 },
        {
          event_id: EVENT_COND,
          source_field: "badge",
          label: "Badge",
          type: "text",
          display_order: 3,
          rules: { show_when: { field: "day", value: "Both" } },
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma?.attendee.deleteMany({ where: { event_id: EVENT_COND } });
    await prisma?.eventCustomField.deleteMany({ where: { event_id: EVENT_COND } });
    await prisma?.event.deleteMany({ where: { id: EVENT_COND } });
  });

  function addAttendee(custom_data: Record<string, unknown>): Promise<Response> {
    condCounter += 1;
    return Promise.resolve(
      app.request(`/api/admin/events/${EVENT_COND}/attendees`, {
        method: "POST",
        headers: jsonAdmin(),
        body: JSON.stringify({ email: `conditions-${condCounter}@example.com`, first_name: "Ann", last_name: `Guest${condCounter}`, custom_data }),
      }),
    );
  }

  /** Adds an attendee and returns its id, expecting it to be added. */
  async function added(custom_data: Record<string, unknown>): Promise<string> {
    const res = await addAttendee(custom_data);
    expect(res.status, JSON.stringify(custom_data)).toBe(201);
    return ((await res.json()) as CreatedAttendee).id;
  }

  async function edit(attendeeId: string, body: Record<string, unknown>): Promise<Response> {
    return app.request(`/api/admin/events/${EVENT_COND}/attendees/${attendeeId}`, {
      method: "PATCH",
      headers: jsonAdmin(),
      body: JSON.stringify({ ...body, expected_updated_at: await updatedAt(attendeeId) }),
    });
  }

  const editAnswers = (attendeeId: string, custom_data_fields: Record<string, string | null>) => edit(attendeeId, { custom_data_fields });

  async function refused(res: Response): Promise<[number, unknown]> {
    return [res.status, await res.json()];
  }

  describe("when an attendee is added", () => {
    it("stores the answer to a question that is asked", async () => {
      const id = await added({ parking: "yes", plate: "WA 12345" });
      expect(await storedCustomData(id)).toEqual({ parking: "true", plate: "WA 12345" });
      const day = await added({ day: "Both", badge: "Blue" });
      expect(await storedCustomData(day)).toEqual({ day: "Both", badge: "Blue" });
    });

    it("drops the answer to a question that is not asked, and answers 201 with no word of it", async () => {
      for (const answers of [{ parking: "no", plate: "WA 12345" }, { plate: "WA 12345" }, { parking: "", plate: "WA 12345" }]) {
        const res = await addAttendee(answers);
        expect(res.status, JSON.stringify(answers)).toBe(201);
        const body = (await res.json()) as CreatedAttendee;
        expect(body.custom_data?.plate).toBeUndefined();
        expect((await storedCustomData(body.id) as Record<string, string> | null)?.plate).toBeUndefined();
      }
      const day = await added({ day: "Day 1", badge: "Blue" });
      expect(await storedCustomData(day)).toEqual({ day: "Day 1" });
    });

    it("does not require an answer to a question that is not asked", async () => {
      expect(await storedCustomData(await added({ parking: "no" }))).toEqual({ parking: "false" });
      expect(await storedCustomData(await added({}))).toBeNull();
    });

    it("requires it once the question is asked, naming the field", async () => {
      expect(await refused(await addAttendee({ parking: "yes" }))).toEqual([400, { error: "required_custom_data_field_missing", field: "plate" }]);
      expect(await refused(await addAttendee({ parking: "true", plate: "  " }))).toEqual([400, { error: "required_custom_data_field_missing", field: "plate" }]);
    });

    it("does not look at an answer to a question that is not asked, however wrong it is", async () => {
      // Longer than any answer may be, and shorter than the request limit that a body is held to before anything is read.
      expect((await addAttendee({ parking: "no", plate: "p".repeat(1500) })).status).toBe(201);
      expect((await addAttendee({ day: "Day 2", badge: "b".repeat(101) })).status).toBe(201);
    });

    it("refuses a wrong answer to a question that is asked, and a controller that has no such answer", async () => {
      expect(await refused(await addAttendee({ parking: "yes", plate: "p".repeat(101) }))).toEqual([400, { error: "validation_failed", field: "plate" }]);
      expect(await refused(await addAttendee({ parking: "maybe", plate: "WA 12345" }))).toEqual([400, { error: "validation_failed", field: "parking" }]);
      expect(await refused(await addAttendee({ day: "Day 3", badge: "Blue" }))).toEqual([400, { error: "validation_failed", field: "day" }]);
    });
  });

  describe("when an attendee is edited", () => {
    it("keeps the answer stored while the question was asked, and asks for nothing more of it", async () => {
      const id = await added({ parking: "true", plate: "WA 12345" });
      expect((await editAnswers(id, { parking: "no" })).status).toBe(200);
      expect(await storedCustomData(id)).toEqual({ parking: "false", plate: "WA 12345" });
      // Other edits keep working: the plate is not asked, so it is not required, and it is not touched.
      expect((await edit(id, { first_name: "Anna", last_name: "Guest" })).status).toBe(200);
      expect(await storedCustomData(id)).toEqual({ parking: "false", plate: "WA 12345" });
    });

    it("does not store an answer to a question that is not asked, and says nothing of it", async () => {
      const id = await added({ parking: "no" });
      const res = await editAnswers(id, { plate: "WA 99999" });
      expect(res.status).toBe(200);
      expect(await storedCustomData(id)).toEqual({ parking: "false" });
      const kept = await added({ parking: "no" });
      expect((await editAnswers(kept, { plate: "p".repeat(500) })).status).toBe(200);
      expect(await storedCustomData(kept)).toEqual({ parking: "false" });
    });

    it("stores both when one edit answers the question and asks it", async () => {
      const id = await added({ parking: "no" });
      expect((await editAnswers(id, { plate: "WA 5", parking: "yes" })).status).toBe(200);
      expect(await storedCustomData(id)).toEqual({ parking: "true", plate: "WA 5" });
    });

    it("drops the answer of an edit that stops asking the question", async () => {
      const id = await added({ parking: "yes", plate: "OLD 1" });
      expect((await editAnswers(id, { plate: "NEW 2", parking: "no" })).status).toBe(200);
      expect(await storedCustomData(id)).toEqual({ parking: "false", plate: "OLD 1" });
    });

    it("clears an answer to a question that is not asked, when the staff clear it", async () => {
      const id = await added({ parking: "yes", plate: "OLD 1" });
      expect((await editAnswers(id, { parking: "no" })).status).toBe(200);
      expect((await editAnswers(id, { plate: null })).status).toBe(200);
      expect(await storedCustomData(id)).toEqual({ parking: "false" });
    });

    it("refuses to clear a required answer to a question that is asked, and to ask a required question without an answer", async () => {
      const asked = await added({ parking: "yes", plate: "WA 1" });
      expect(await refused(await editAnswers(asked, { plate: null }))).toEqual([400, { error: "required_custom_data_field_missing", field: "plate" }]);
      const quiet = await added({ parking: "no" });
      expect(await refused(await editAnswers(quiet, { parking: "yes" }))).toEqual([400, { error: "required_custom_data_field_missing", field: "plate" }]);
      expect((await editAnswers(quiet, { parking: "yes", plate: "WA 2" })).status).toBe(200);
      expect(await storedCustomData(asked)).toEqual({ parking: "true", plate: "WA 1" });
    });

    it("holds an attendee whose question is asked and unanswered to the rule at every other edit, as for any required field", async () => {
      const id = await added({ parking: "no" });
      // Written straight to the database, as an older save might have left it.
      await prisma.attendee.update({ where: { id }, data: { custom_data: { parking: "true" } } });
      expect(await refused(await edit(id, { first_name: "Anna", last_name: "Guest" }))).toEqual([400, { error: "required_custom_data_field_missing", field: "plate" }]);
      expect((await editAnswers(id, { plate: "WA 3" })).status).toBe(200);
    });

    it("works the same for a select question", async () => {
      const id = await added({ day: "Day 1" });
      expect((await editAnswers(id, { badge: "Blue" })).status).toBe(200);
      expect(await storedCustomData(id)).toEqual({ day: "Day 1" });
      expect((await editAnswers(id, { day: "Both", badge: "Blue" })).status).toBe(200);
      expect(await storedCustomData(id)).toEqual({ day: "Both", badge: "Blue" });
      expect((await editAnswers(id, { day: "Day 2" })).status).toBe(200);
      expect(await storedCustomData(id)).toEqual({ day: "Day 2", badge: "Blue" });
    });
  });

  describe("when the organiser changes the condition later", () => {
    it("reads the answers already stored under the condition as it is now", async () => {
      const id = await added({ parking: "yes", plate: "WA 7" });
      await prisma.eventCustomField.update({
        where: { event_id_source_field: { event_id: EVENT_COND, source_field: "plate" } },
        data: { rules: { show_when: { field: "parking", value: true }, max_length: 3 } },
      });
      try {
        // The stored answer breaks the new length rule: the edit is refused until it is fixed, as for any rule.
        expect(await refused(await editAnswers(id, { day: "Day 1" }))).toEqual([400, { error: "validation_failed", field: "plate" }]);
        expect((await editAnswers(id, { plate: "W7" })).status).toBe(200);
      } finally {
        await prisma.eventCustomField.update({
          where: { event_id_source_field: { event_id: EVENT_COND, source_field: "plate" } },
          data: { rules: { show_when: { field: "parking", value: true } } },
        });
      }
    });
  });
});
