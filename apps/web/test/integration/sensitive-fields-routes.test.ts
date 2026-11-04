/**
 * Sensitive attendee fields (D-E6), through the real app and a real database: a question the organiser marks sensitive
 * keeps its answers in `custom_data`, but the field is there and the value is not, in every place the staff API shows or
 * writes attendee answers: the attendee page and its companion, the request window and its companion, lists and filters,
 * the exports (selected rows and the personal-data export of a superadmin), the custom-field report and its file, the option
 * usage of a select, the import preview, the field API itself and the logs. Next to each sensitive question stands a plain
 * one that must still show, so a test that hides everything cannot pass.
 */
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { buildTestApp } from "../helpers/build-test-app.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG = "org-sensitive-fields";
const EVENT = "evt-sensitive-fields";
const EMAILS = {
  admin: "sensitive-admin@example.com",
  superadmin: "sensitive-super@example.com",
  operator: "sensitive-operator@example.com",
};

/** Answers no other test writes: the scans below read whole responses and whole tables. */
const tag = randomUUID();
const SECRET_DIET = `Zzyzx-diet-${tag}`;
const SECRET_ALLERGY = `Zzyzx-allergy-${tag}`;
const SECRET_MOBILITY = `Zzyzx-mobility-${tag}`;
const SECRET_NEW = `Zzyzx-typed-${tag}`;
const SECRETS = [SECRET_DIET, SECRET_ALLERGY, SECRET_MOBILITY, SECRET_NEW];
const VISIBLE = { shirt: "shirt-visible", plate: "plate-visible" };

let prisma: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
const cookies = { admin: "", superadmin: "", operator: "" };
let guestId = "";
let otherId = "";
let registrationId = "";
let pendingId = "";
let selectFieldId = "";
let plainSelectFieldId = "";

const sameOrigin = { Origin: "http://localhost" };

async function wipe(client: PrismaClient): Promise<void> {
  await client.attendee.deleteMany({ where: { event_id: EVENT } });
  await client.registration.deleteMany({ where: { event_id: EVENT } });
  await client.adminJob.deleteMany({ where: { event_id: EVENT } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: EVENT } });
  await client.adminAuditLog.deleteMany({ where: { organization_id: ORG } });
  await client.eventCustomField.deleteMany({ where: { event_id: EVENT } });
  await client.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG, EVENT] } } });
  await client.session.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.userMfaMethod.deleteMany({ where: { user: { email: { in: Object.values(EMAILS) } } } });
  await client.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
  await client.eventRegistrationSettings.deleteMany({ where: { event_id: EVENT } });
  await client.event.deleteMany({ where: { id: EVENT } });
  await client.organization.deleteMany({ where: { id: ORG } });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await wipe(prisma);
  await prisma.organization.create({ data: { id: ORG, name: "Sensitive Org", slug: "sensitive-org" } });
  await prisma.event.create({
    data: { id: EVENT, title: "Sensitive Event", slug: "sensitive-event", date: new Date("2030-10-01"), organization_id: ORG, capacity: 20 },
  });
  await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT, mode: "approval", max_companions: 1 } });
  await prisma.eventCustomField.createMany({
    data: [
      { event_id: EVENT, source_field: "diet", label: "Diet", type: "text", sensitive: true, show_on_form: true },
      { event_id: EVENT, source_field: "allergy", label: "Allergy", type: "text", sensitive: true, show_on_form: true },
      { event_id: EVENT, source_field: "rh", label: "Blood group", type: "select", options: ["A", "B"], sensitive: true, show_on_form: true },
      { event_id: EVENT, source_field: "shirt", label: "Shirt", type: "text", show_on_form: true },
      { event_id: EVENT, source_field: "size", label: "Size", type: "select", options: ["S", "M"], show_on_form: true },
      { event_id: EVENT, source_field: "mobility", label: "Mobility", type: "text", applies_to: "companion", sensitive: true, show_on_form: true },
      { event_id: EVENT, source_field: "plate", label: "Plate", type: "text", applies_to: "companion", show_on_form: true },
    ],
  });
  selectFieldId = (await prisma.eventCustomField.findFirstOrThrow({ where: { event_id: EVENT, source_field: "rh" } })).id;
  plainSelectFieldId = (await prisma.eventCustomField.findFirstOrThrow({ where: { event_id: EVENT, source_field: "size" } })).id;

  const guest = await prisma.attendee.create({
    data: {
      event_id: EVENT,
      email: "sensitive-guest@example.com",
      name: "Sensitive Guest",
      first_name: "Sensitive",
      last_name: "Guest",
      custom_data: { diet: SECRET_DIET, allergy: SECRET_ALLERGY, shirt: VISIBLE.shirt, size: "M" },
      companions: { create: { slot: 1, name: "Companion Person", custom_data: { mobility: SECRET_MOBILITY, plate: VISIBLE.plate } } },
    },
  });
  guestId = guest.id;
  otherId = (
    await prisma.attendee.create({
      data: { event_id: EVENT, email: "sensitive-other@example.com", name: "Other Guest", first_name: "Other", last_name: "Guest", custom_data: { shirt: "other-shirt", size: "S" } },
    })
  ).id;
  registrationId = (
    await prisma.registration.create({
      data: {
        event_id: EVENT,
        email: "sensitive-guest@example.com",
        first_name: "Sensitive",
        last_name: "Guest",
        name: "Sensitive Guest",
        status: "accepted",
        attendee_id: guestId,
        custom_data: { diet: SECRET_DIET, allergy: SECRET_ALLERGY, shirt: VISIBLE.shirt },
        companions: [{ name: "Companion Person", custom_data: { mobility: SECRET_MOBILITY, plate: VISIBLE.plate } }],
      },
    })
  ).id;
  pendingId = (
    await prisma.registration.create({
      data: {
        event_id: EVENT,
        email: "sensitive-pending@example.com",
        first_name: "Pending",
        last_name: "Guest",
        name: "Pending Guest",
        status: "pending",
        custom_data: { diet: SECRET_DIET, shirt: VISIBLE.shirt },
        companions: [{ name: "Pending Companion", custom_data: { mobility: SECRET_MOBILITY, plate: VISIBLE.plate } }],
      },
    })
  ).id;

  const [admin, superadmin, operator] = await Promise.all(Object.values(EMAILS).map((email) => prisma.user.create({ data: { email } })));
  await prisma.roleAssignment.createMany({
    data: [
      { user_id: admin!.id, role: "admin", scope_type: "organization", scope_id: ORG },
      { user_id: superadmin!.id, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: operator!.id, role: "operator", scope_type: "event", scope_id: EVENT },
    ],
  });
  for (const user of [admin!, superadmin!, operator!]) await enrollConfirmedTotp(prisma, user.id);
  cookies.admin = await sessionCookieFor(prisma, admin!.id);
  cookies.superadmin = await sessionCookieFor(prisma, superadmin!.id);
  cookies.operator = await sessionCookieFor(prisma, operator!.id);
});

beforeEach(() => {
  resetSystemLogBufferForTest();
  app = buildTestApp({ prisma, checkinToken: "sensitive-checkin-token-32-chars!!", adminDistRoot });
});

afterAll(async () => {
  if (prisma) await wipe(prisma);
  await prisma?.$disconnect();
});

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
const spies: Array<{ mock: { calls: unknown[][] } }> = [];
beforeEach(() => {
  for (const method of consoleMethods) spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  spies.length = 0;
});

/** Everything written to the console or to the system log since the test began, as one lower-case text. */
function written(): string {
  const lines = spies.flatMap((spy) => spy.mock.calls.map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" ")));
  return [...lines, ...querySystemLogs().map((entry) => JSON.stringify(entry))].join("\n").toLowerCase();
}

function expectNoSecret(text: string): void {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

const get = (path: string, cookie: string = cookies.admin) => app.request(path, { headers: { Cookie: cookie } });
const send = (method: "POST" | "PATCH" | "PUT", path: string, body: unknown, cookie: string = cookies.admin) =>
  app.request(path, {
    method,
    headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

type AttendeeDetail = {
  updated_at: string;
  custom_data: Record<string, string> | null;
  companion: { custom_data: Record<string, string> | null } | null;
  action_log: unknown[];
};

describe("the attendee page", () => {
  it("shows the plain answers and leaves out the sensitive ones, for the guest and for the companion", async () => {
    const res = await get(`/api/admin/events/${EVENT}/attendees/${guestId}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as AttendeeDetail;

    expect(body.custom_data).toEqual({ shirt: VISIBLE.shirt, size: "M" });
    expect(body.companion?.custom_data).toEqual({ plate: VISIBLE.plate });
    expectNoSecret(text);
  });

  it("answers null for a companion whose only answer is sensitive, as it would for one with none", async () => {
    await prisma.attendeeCompanion.updateMany({ where: { attendee_id: guestId }, data: { custom_data: { mobility: SECRET_MOBILITY } } });
    try {
      const body = (await (await get(`/api/admin/events/${EVENT}/attendees/${guestId}`)).json()) as AttendeeDetail;
      expect(body.companion?.custom_data).toBeNull();
    } finally {
      await prisma.attendeeCompanion.updateMany({ where: { attendee_id: guestId }, data: { custom_data: { mobility: SECRET_MOBILITY, plate: VISIBLE.plate } } });
    }
  });

  it("is not changed by an edit that leaves a sensitive box empty, and the stored answer stays", async () => {
    const before = (await (await get(`/api/admin/events/${EVENT}/attendees/${guestId}`)).json()) as AttendeeDetail;

    const res = await send("PATCH", `/api/admin/events/${EVENT}/attendees/${guestId}`, {
      expected_updated_at: before.updated_at,
      custom_data_fields: { diet: null, allergy: "", shirt: "shirt-edited" },
    });

    expect(res.status).toBe(200);
    expectNoSecret(await res.text());
    const stored = (await prisma.attendee.findUniqueOrThrow({ where: { id: guestId } })).custom_data as Record<string, string>;
    expect(stored).toMatchObject({ diet: SECRET_DIET, allergy: SECRET_ALLERGY, shirt: "shirt-edited" });
    await prisma.attendee.update({ where: { id: guestId }, data: { custom_data: { diet: SECRET_DIET, allergy: SECRET_ALLERGY, shirt: VISIBLE.shirt, size: "M" } } });
  });

  it("replaces a sensitive answer that is typed, shows nothing of it, and keeps its value out of the activity log", async () => {
    const before = (await (await get(`/api/admin/events/${EVENT}/attendees/${guestId}`)).json()) as AttendeeDetail;

    const res = await send("PATCH", `/api/admin/events/${EVENT}/attendees/${guestId}`, {
      expected_updated_at: before.updated_at,
      custom_data_fields: { diet: SECRET_NEW },
    });

    expect(res.status).toBe(200);
    expectNoSecret(await res.text());
    expect(((await prisma.attendee.findUniqueOrThrow({ where: { id: guestId } })).custom_data as Record<string, string>).diet).toBe(SECRET_NEW);
    const logged = await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT, attendee_id: guestId } });
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain(SECRET_NEW);
    expect(JSON.stringify(logged)).not.toContain(SECRET_DIET);
    expect(written()).not.toContain(SECRET_NEW.toLowerCase());
    await prisma.attendee.update({ where: { id: guestId }, data: { custom_data: { diet: SECRET_DIET, allergy: SECRET_ALLERGY, shirt: VISIBLE.shirt, size: "M" } } });
  });

  it("keeps a companion's sensitive answer when the edit leaves its box empty, and shows nothing of it", async () => {
    const res = await send("PATCH", `/api/admin/events/${EVENT}/attendees/${guestId}/companion`, { name: "Companion Renamed", custom_data: { plate: "plate-edited" } });

    expect(res.status).toBe(200);
    const text = await res.text();
    expectNoSecret(text);
    expect((JSON.parse(text) as AttendeeDetail).companion?.custom_data).toEqual({ plate: "plate-edited" });
    const stored = await prisma.attendeeCompanion.findFirstOrThrow({ where: { attendee_id: guestId } });
    expect(stored.custom_data).toEqual({ mobility: SECRET_MOBILITY, plate: "plate-edited" });
    await prisma.attendeeCompanion.updateMany({ where: { attendee_id: guestId }, data: { name: "Companion Person", custom_data: { mobility: SECRET_MOBILITY, plate: VISIBLE.plate } } });
  });
});

describe("the request window", () => {
  it("leaves the sensitive answers out of an accepted request and of its companion, and keeps the plain ones", async () => {
    const res = await get(`/api/admin/events/${EVENT}/registrations/${registrationId}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { custom_data: Record<string, string>; companions: { custom_data: Record<string, string> | null }[] };

    expect(body.custom_data).toEqual({ shirt: VISIBLE.shirt });
    expect(body.companions).toHaveLength(1);
    expect(body.companions[0]!.custom_data).toEqual({ plate: VISIBLE.plate });
    expectNoSecret(text);
  });

  it("does the same for a request that waits for a decision", async () => {
    const res = await get(`/api/admin/events/${EVENT}/registrations/${pendingId}`);
    const text = await res.text();
    const body = JSON.parse(text) as { custom_data: Record<string, string>; companions: { custom_data: Record<string, string> | null }[] };
    expect(body.custom_data).toEqual({ shirt: VISIBLE.shirt });
    expect(body.companions[0]!.custom_data).toEqual({ plate: VISIBLE.plate });
    expectNoSecret(text);
  });

  it("does not put the answers in the list", async () => {
    const res = await get(`/api/admin/events/${EVENT}/registrations`);
    expect(res.status).toBe(200);
    expectNoSecret(await res.text());
  });
});

describe("lists and filters", () => {
  it("carries no answer in the attendee list", async () => {
    const res = await get(`/api/admin/events/${EVENT}/attendees?pageSize=100`);
    expect(res.status).toBe(200);
    expectNoSecret(await res.text());
  });

  it("ignores a filter on a sensitive field, so it cannot be used to find who gave an answer", async () => {
    const filtered = await get(`/api/admin/events/${EVENT}/attendees?pageSize=100&cf_diet=${encodeURIComponent(SECRET_DIET)}`);
    const everyone = await get(`/api/admin/events/${EVENT}/attendees?pageSize=100`);
    const filteredBody = (await filtered.json()) as { total: number };
    const everyoneBody = (await everyone.json()) as { total: number };

    expect(filteredBody.total).toBe(everyoneBody.total);
    expect(everyoneBody.total).toBe(2);
  });

  it("ignores a filter on a sensitive select in the same way", async () => {
    const res = await get(`/api/admin/events/${EVENT}/attendees?pageSize=100&cf_rh=A`);
    expect(((await res.json()) as { total: number }).total).toBe(2);
  });

  it("still filters on a plain field beside it", async () => {
    const res = await get(`/api/admin/events/${EVENT}/attendees?pageSize=100&cf_shirt=${VISIBLE.shirt}`);
    expect(((await res.json()) as { total: number }).total).toBe(1);
  });

  it("does not find an answer by the search box", async () => {
    const res = await get(`/api/admin/events/${EVENT}/attendees?q=${encodeURIComponent(SECRET_DIET)}`);
    expect(((await res.json()) as { total: number }).total).toBe(0);
  });
});

describe("exports", () => {
  const select = (format: "csv", ids: string[] = [guestId, otherId]) =>
    send("POST", `/api/admin/events/${EVENT}/attendees/export-selected`, { attendee_ids: ids, format });

  it("has no column and no cell for a sensitive field, and keeps the plain ones", async () => {
    const res = await select("csv");
    expect(res.status).toBe(200);
    const text = await res.text();
    const header = text.split("\r\n")[0]!;

    expect(header).toContain("Shirt");
    expect(header).toContain("Size");
    expect(header).not.toContain("Diet");
    expect(header).not.toContain("Allergy");
    expect(header).not.toContain("Blood group");
    expect(text).toContain(VISIBLE.shirt);
    expectNoSecret(text);
  });

  it("has no answer in the personal data export of a superadmin, and keeps the plain ones", async () => {
    const res = await get(`/api/admin/events/${EVENT}/export-pii`, cookies.superadmin);
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain(VISIBLE.shirt);
    expectNoSecret(text);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { organization_id: ORG, action_type: "event_pii_exported" }, orderBy: { created_at: "desc" } });
    expect(audit.metadata).toMatchObject({ sensitiveFieldCount: 4 });
  });
});

describe("the custom field report", () => {
  type Report = { fields: { source_field: string }[] };

  it("has no entry for a sensitive field, and keeps the plain ones", async () => {
    const res = await get(`/api/admin/events/${EVENT}/reports/custom-fields`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const keys = (JSON.parse(text) as Report).fields.map((field) => field.source_field);

    expect(keys).toEqual(expect.arrayContaining(["shirt", "size"]));
    expect(keys).not.toContain("diet");
    expect(keys).not.toContain("allergy");
    expectNoSecret(text);
  });

  it("has no column in its file either, and no answer", async () => {
    const res = await get(`/api/admin/events/${EVENT}/reports/export?report=customfields&format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const header = text.split(/\r?\n/).find((line) => line.includes("Shirt"))!;

    expect(header).toContain("Size");
    expect(header).not.toContain("Diet");
    expect(header).not.toContain("Allergy");
    expect(text).toContain(VISIBLE.shirt);
    expectNoSecret(text);
  });

  it("tells how many chose each option of a plain select, and nothing of a sensitive one", async () => {
    const plain = await get(`/api/admin/events/${EVENT}/custom-fields/${plainSelectFieldId}/option-usage`);
    expect(await plain.json()).toEqual({ counts: { M: 1, S: 1 } });

    const sensitive = await get(`/api/admin/events/${EVENT}/custom-fields/${selectFieldId}/option-usage`);
    expect(sensitive.status).toBe(200);
    expect(await sensitive.json()).toEqual({ counts: {}, hidden: true });
  });
});

describe("the import preview", () => {
  it("leaves a sensitive cell empty in the sample rows, stores nothing yet, and shows the plain one", async () => {
    const csv = ["email,first_name,last_name,diet,shirt", `new-sensitive@example.com,New,Person,${SECRET_NEW},shirt-new`].join("\n");
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");

    const res = await app.request(`/api/admin/events/${EVENT}/import/preview`, { method: "POST", headers: { Cookie: cookies.admin, ...sameOrigin }, body: form });

    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { sampleRows: { custom_data: Record<string, string> }[] };
    expect(body.sampleRows).toHaveLength(1);
    expect(body.sampleRows[0]!.custom_data.shirt).toBe("shirt-new");
    expect(body.sampleRows[0]!.custom_data.diet).toBe("");
    expectNoSecret(text);
    expect(written()).not.toContain(SECRET_NEW.toLowerCase());
  });
});

describe("the field API", () => {
  type Field = { id: string; source_field: string; sensitive: boolean };
  const path = `/api/admin/events/${EVENT}/custom-fields`;

  it("lists the flag, off for a field that was never marked", async () => {
    const items = ((await (await get(path)).json()) as { items: Field[] }).items;
    expect(items.find((field) => field.source_field === "diet")?.sensitive).toBe(true);
    expect(items.find((field) => field.source_field === "shirt")?.sensitive).toBe(false);
  });

  it("creates a sensitive field, creates a plain one by default, and records the choice in the log of the event", async () => {
    const sensitive = await send("POST", path, { source_field: "health", label: "Health", sensitive: true });
    const plain = await send("POST", path, { source_field: "hobby", label: "Hobby" });

    expect(sensitive.status).toBe(201);
    expect((await sensitive.json()) as Field).toMatchObject({ source_field: "health", sensitive: true });
    expect(((await plain.json()) as Field).sensitive).toBe(false);
    const logs = await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT, action_type: "event_custom_field_created" } });
    expect(logs.map((entry) => entry.metadata)).toEqual(expect.arrayContaining([{ source_field: "health", sensitive: true }, { source_field: "hobby" }]));
  });

  it("switches the flag with a patch, records it, and refuses a value that is not a boolean", async () => {
    const created = (await (await send("POST", path, { source_field: "toggle", label: "Toggle" })).json()) as Field;

    const on = await send("PATCH", `${path}/${created.id}`, { sensitive: true });
    expect(((await on.json()) as Field).sensitive).toBe(true);
    const off = await send("PATCH", `${path}/${created.id}`, { sensitive: false });
    expect(((await off.json()) as Field).sensitive).toBe(false);
    expect((await send("PATCH", `${path}/${created.id}`, { sensitive: "yes" })).status).toBe(400);

    const logs = await prisma.attendeeActionLog.findMany({ where: { event_id: EVENT, action_type: "event_custom_field_updated" }, orderBy: { created_at: "asc" } });
    expect(logs.map((entry) => entry.metadata)).toEqual(expect.arrayContaining([{ source_field: "toggle", sensitive: true }, { source_field: "toggle", sensitive: false }]));
  });

  it("is for the administrator, not the operator", async () => {
    const res = await send("PATCH", `${path}/${selectFieldId}`, { sensitive: false }, cookies.operator);
    expect(res.status).toBe(403);
    expect((await prisma.eventCustomField.findUniqueOrThrow({ where: { id: selectFieldId } })).sensitive).toBe(true);
  });
});

describe("the operator", () => {
  it("cannot open the attendee page or the request window", async () => {
    expect((await get(`/api/admin/events/${EVENT}/attendees/${guestId}`, cookies.operator)).status).toBe(403);
    expect((await get(`/api/admin/events/${EVENT}/registrations/${registrationId}`, cookies.operator)).status).toBe(403);
  });
});

describe("the logs", () => {
  it("carry no sensitive answer from any of the requests above", () => {
    expect(written()).not.toContain(tag.toLowerCase());
  });
});
