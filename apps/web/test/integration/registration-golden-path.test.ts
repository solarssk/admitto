/**
 * The golden path of guest registration, from the form to the door and the report, through the real app and a real
 * database, with nothing in the middle stubbed but what is outside the product (Cloudflare's siteverify and the mail
 * provider's wire): the form, the confirmation of the address, the decision (automatic and by staff), the queue row,
 * the worker, the ticket delivery, the scan of the ticket from the mail at the door, the companion marked in, and the
 * report. Also what an import and the form do to each other when they meet on one address (D-A3, D-B13, D-B14), in
 * both orders. The parts have tests of their own; this file is the one that fails when they stop fitting together.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { commitImport } from "@admitto/import";
import { drainPendingDeliveries, drainRegistrationMails } from "@admitto/mail-delivery";
import { setMailSettings } from "@admitto/mailer-config";
import type { MailMessage } from "@admitto/mailer";
import { buildConfirmUrl } from "@admitto/mail-delivery";
import { countSeatsInUse } from "@admitto/tickets";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";
import { documentOf } from "../helpers/registration-form-fixtures.js";
import { ORIGIN, eventSeeder, harness, nextEmail, type EventSeed } from "../helpers/registration-submit-harness.js";

const ORG = "org-reg116b-golden";
const STAFF_EMAIL = "golden-admin@example.com";
const OPERATOR_BEARER = "reg95c-submit-checkin-token-32-chars";
const ENV = { NODE_ENV: "test", BASE_URL: ORIGIN };

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let staffCookie = "";
let slugCounter = 0;
const nextSlug = (label: string) => `reg116b-${label}-${(slugCounter += 1)}`;
const eventIds: string[] = [];

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
  // Mail leaves through the export-only provider: every message is handed to the sink the test passes to the worker.
  await setMailSettings({ scopeType: "organization", scopeId: ORG }, { provider: "export_only", fromAddress: "events@example.com" }, prisma);
  const staff = await prisma.user.create({ data: { email: STAFF_EMAIL } });
  await prisma.roleAssignment.create({ data: { user_id: staff.id, role: "admin", scope_type: "organization", scope_id: ORG } });
  await enrollConfirmedTotp(prisma, staff.id);
  staffCookie = await sessionCookieFor(prisma, staff.id);
});

afterAll(async () => {
  if (prisma) {
    await prisma.emailDelivery.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.checkIn.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.attendeeItemState.deleteMany({ where: { attendee: { event_id: { in: eventIds } } } });
    await prisma.eventItem.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.attendeeActionLog.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.session.deleteMany({ where: { user: { email: STAFF_EMAIL } } });
    await prisma.userMfaMethod.deleteMany({ where: { user: { email: STAFF_EMAIL } } });
    await prisma.roleAssignment.deleteMany({ where: { scope_id: ORG } });
    await prisma.user.deleteMany({ where: { email: STAFF_EMAIL } });
    await prisma.mailSettings.deleteMany({ where: { scope_id: ORG } });
  }
  await seeder?.wipe();
  await prisma?.$disconnect();
});

/** The questions of an event that takes a companion. */
const FIELDS: NonNullable<EventSeed["fields"]> = [
  { source_field: "diet", label: "Diet", type: "select", options: ["Vegan", "None"] },
  { source_field: "badge", label: "Badge name", applies_to: "companion", required: true },
];

async function seedEvent(label: string, seed: EventSeed = {}) {
  const slug = nextSlug(label);
  const eventId = await seeder.addEvent(slug, { capacity: 10, ...seed });
  eventIds.push(eventId);
  return { slug, eventId };
}

/** What the worker sent since the test began: every message the export-only provider was handed. */
function outbox() {
  const messages: MailMessage[] = [];
  const deps = {
    exportSink: (payload: { message: MailMessage }) => {
      messages.push(payload.message);
    },
  };
  return {
    messages,
    /** One tick of each job, as the worker runs them: the registration queue, then the ticket deliveries it created. */
    tick: async () => ({
      queue: await drainRegistrationMails(prisma, ENV, deps, { baseUrl: ORIGIN }),
      deliveries: await drainPendingDeliveries(prisma, ENV, deps, { baseUrl: ORIGIN }),
    }),
    to: (email: string) => messages.filter((message) => message.to === email),
  };
}

const ticketUrlOf = (message: MailMessage) => /https:\/\/tickets\.example\.com\/t\/[\w-]{20,}/.exec(message.html)?.[0];

const staffRequest = (app: ReturnType<typeof harness>["app"], path: string, body?: unknown) =>
  app.request(`${ORIGIN}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: staffCookie, Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const door = (app: ReturnType<typeof harness>["app"], path: string, body: Record<string, unknown>) =>
  app.request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPERATOR_BEARER}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "gate-1", ...body }),
  });

describe("the golden path", () => {
  it("takes a guest with a companion from the form to the door: confirm the address, a ticket in the mail, a scan, the companion marked in, and the report", async () => {
    const { slug, eventId } = await seedEvent("auto", {
      fields: FIELDS,
      settings: { mode: "automatic", verify_email: true, max_companions: 1 },
    });
    const h = harness({ prisma });
    const mail = outbox();
    const email = nextEmail("golden");

    // The form is open, and the guest sends it.
    const page = await h.get(`/r/${slug}`);
    expect(page.status).toBe(200);
    expect(documentOf(await page.text()).querySelector("form")).not.toBeNull();
    const payload = h.body(slug, { email, custom_data: { diet: "Vegan" }, companions: [{ name: "Piotr Companion", answers: { badge: "Piotr" } }] });
    expect((await h.post(slug, payload)).status).toBe(200);

    const waiting = await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email } } });
    expect(waiting.status).toBe("awaiting_email");
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(0);

    // The worker sends the confirmation mail, and only that.
    await mail.tick();
    expect(mail.to(email)).toHaveLength(1);
    const confirmUrl = buildConfirmUrl(ORIGIN, slug, waiting.id);
    expect(mail.to(email)[0]!.html).toContain(confirmUrl);

    // Opening the link confirms nothing; the button does, and the registration is accepted at once.
    const link = new URL(confirmUrl).pathname;
    expect((await h.get(link)).status).toBe(200);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("awaiting_email");
    const confirmed = await h.app.request(`${ORIGIN}${link}`, { method: "POST", headers: { Origin: ORIGIN } });
    expect(confirmed.status).toBeLessThan(400);
    const accepted = await prisma.registration.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(accepted.status).toBe("accepted");
    const attendee = await prisma.attendee.findUniqueOrThrow({ where: { id: accepted.attendee_id! }, include: { companions: true } });
    expect(attendee.companions.map((row) => [row.slot, row.name])).toEqual([[1, "Piotr Companion"]]);
    expect(await countSeatsInUse(prisma, eventId)).toBe(2);
    expect((await prisma.registrationMail.findMany({ where: { registration_id: waiting.id }, select: { template_name: true } })).map((row) => row.template_name).sort((a, b) => a.localeCompare(b, "en"))).toEqual(
      ["registration-confirm", "ticket"],
    );

    // The worker hands the ticket row to the usual send, the delivery goes out, and the mail carries the link of the ticket.
    const second = await mail.tick();
    expect(second.queue.sent).toBeGreaterThanOrEqual(1);
    expect(await prisma.emailDelivery.count({ where: { attendee_id: attendee.id, status: { in: ["sent", "accepted"] } } })).toBe(1);
    const ticketMail = mail.to(email).at(-1)!;
    const ticketUrl = ticketUrlOf(ticketMail);
    expect(ticketUrl).toBeDefined();
    expect(mail.to(email)).toHaveLength(2);

    // At the door the ticket from the mail is scanned: the guest is let in once, and the second scan says so.
    const scan = await door(h.app, "/api/checkin/scan", { eventId, scanned: ticketUrl });
    expect(scan.status).toBe(200);
    expect(await scan.json()).toMatchObject({ status: "VALID", confirmed: true });
    expect(await (await door(h.app, "/api/checkin/scan", { eventId, scanned: ticketUrl })).json()).toMatchObject({ status: "ALREADY_CHECKED_IN" });

    // The card of the guest offers the companion, and the operator marks them in.
    const marked = await door(h.app, "/api/checkin/items/companion", { eventId, attendeeId: attendee.id, targetState: "issued" });
    expect(marked.status).toBe(200);

    // The report counts the guest, and the companion beside them.
    const reports = await staffRequest(h.app, `/api/admin/events/${eventId}/reports`);
    expect(reports.status).toBe(200);
    const body = (await reports.json()) as { summary: { total_attendees: number; admitted: number; companions_admitted: number } };
    expect(body.summary).toMatchObject({ total_attendees: 1, admitted: 1, companions_admitted: 1 });
    const overview = await staffRequest(h.app, `/api/admin/events/${eventId}/overview`);
    expect(((await overview.json()) as { seats_in_use: number }).seats_in_use).toBe(2);
  });

  it("takes a guest of an event with approval to the door once staff accept: no ticket before the decision, no companion counted when none came", async () => {
    const { slug, eventId } = await seedEvent("approval", { settings: { mode: "approval", verify_email: false } });
    const h = harness({ prisma });
    const mail = outbox();
    const email = nextEmail("approval");

    expect((await h.post(slug, h.body(slug, { email }))).status).toBe(200);
    const pending = await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email } } });
    expect(pending.status).toBe("pending");

    // The guest is told that the request was received, and no ticket exists yet.
    await mail.tick();
    expect(mail.to(email)).toHaveLength(1);
    expect(mail.to(email)[0]!.html).not.toMatch(/\/t\/[\w-]{20,}/);
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(0);

    const decision = await staffRequest(h.app, `/api/admin/events/${eventId}/registrations/accept`, { ids: [pending.id] });
    expect(decision.status).toBe(200);
    expect(await decision.json()).toMatchObject({ results: [{ id: pending.id, outcome: "accepted" }] });

    await mail.tick();
    const ticketUrl = ticketUrlOf(mail.to(email).at(-1)!);
    expect(ticketUrl).toBeDefined();
    expect(await (await door(h.app, "/api/checkin/scan", { eventId, scanned: ticketUrl })).json()).toMatchObject({ status: "VALID" });

    const body = (await (await staffRequest(h.app, `/api/admin/events/${eventId}/reports`)).json()) as {
      summary: { admitted: number; companions_admitted: number };
    };
    expect(body.summary).toMatchObject({ admitted: 1, companions_admitted: 0 });
  });

  it("sends each mail once when two ticks of the worker run at the same time", async () => {
    const { slug, eventId } = await seedEvent("ticks", { settings: { mode: "automatic", verify_email: false } });
    const h = harness({ prisma });
    const mail = outbox();
    const emails = [nextEmail("tick"), nextEmail("tick"), nextEmail("tick")];
    for (const email of emails) expect((await h.post(slug, h.body(slug, { email }))).status).toBe(200);
    expect(await prisma.attendee.count({ where: { event_id: eventId } })).toBe(3);

    await Promise.all([mail.tick(), mail.tick()]);
    await mail.tick();

    for (const email of emails) expect(mail.to(email)).toHaveLength(1);
    expect(await prisma.emailDelivery.count({ where: { event_id: eventId } })).toBe(3);
  });
});

/** A row of an import file, as the parser hands it over. */
const importRow = (email: string, first: string, last: string) => ({ rowIndex: 1, first_name: first, last_name: last, email });

describe("an import and the form on one address (D-A3, D-B13, D-B14)", () => {
  it("lets the import win when it comes first: the form is answered as for any address, and nobody is registered twice", async () => {
    const { slug, eventId } = await seedEvent("import-first", { settings: { mode: "automatic", verify_email: false } });
    const h = harness({ prisma });
    const email = nextEmail("imported");
    const summary = await commitImport(eventId, [importRow(email, "Ines", "Imported")], {}, prisma);
    expect(summary.created).toBe(1);

    const stranger = await h.post(slug, h.body(slug, { email: nextEmail("stranger") }));
    const same = await h.post(slug, h.body(slug, { email, first_name: "Other", last_name: "Person" }));
    expect(same.status).toBe(stranger.status);
    expect(await same.json()).toEqual(await stranger.json());

    const attendees = await prisma.attendee.findMany({ where: { event_id: eventId, email } });
    expect(attendees).toHaveLength(1);
    expect(attendees[0]).toMatchObject({ first_name: "Ines", last_name: "Imported" });
  });

  it("refuses the registration with `already_attendee` and deletes it when the import came after the form but before the decision", async () => {
    const { slug, eventId } = await seedEvent("import-between", { settings: { mode: "approval", verify_email: false } });
    const h = harness({ prisma });
    const email = nextEmail("between");
    expect((await h.post(slug, h.body(slug, { email }))).status).toBe(200);
    const pending = await prisma.registration.findUniqueOrThrow({ where: { event_id_email: { event_id: eventId, email } } });
    expect((await commitImport(eventId, [importRow(email, "Ines", "Imported")], {}, prisma)).created).toBe(1);

    const decision = await staffRequest(h.app, `/api/admin/events/${eventId}/registrations/accept`, { ids: [pending.id] });
    expect(await decision.json()).toMatchObject({ results: [{ id: pending.id, outcome: "already_attendee" }] });
    expect(await prisma.registration.count({ where: { id: pending.id } })).toBe(0);
    expect(await prisma.attendee.count({ where: { event_id: eventId, email } })).toBe(1);
    expect(await prisma.registrationMail.count({ where: { registration_id: pending.id } })).toBe(0);
  });

  it("skips the row of an import that comes after the registration was accepted, and leaves what the guest gave as it was", async () => {
    const { slug, eventId } = await seedEvent("import-after", { settings: { mode: "automatic", verify_email: false } });
    const h = harness({ prisma });
    const email = nextEmail("first");
    expect((await h.post(slug, h.body(slug, { email, first_name: "Ada", last_name: "Guest" }))).status).toBe(200);

    const summary = await commitImport(eventId, [importRow(email, "Ines", "Imported")], {}, prisma);

    expect(summary).toMatchObject({ created: 0, updated: 0 });
    expect(summary.skipped).toHaveLength(1);
    const attendees = await prisma.attendee.findMany({ where: { event_id: eventId, email } });
    expect(attendees).toHaveLength(1);
    expect(attendees[0]).toMatchObject({ first_name: "Ada", last_name: "Guest" });
  });
});
