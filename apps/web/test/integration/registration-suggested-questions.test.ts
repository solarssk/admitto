/**
 * The suggested questions on the guest's side, against a real database through the real app: an event gets them from
 * "Add suggested questions" (the staff route), and the registration form then draws them, in order, and takes a guest's
 * answers. A change to the form, or to the rules a question has to meet, must not close the form of an event that used
 * the button (the form answers 404 when it cannot draw a question), and must not refuse what the set asks a guest.
 * The route itself is in ./event-custom-fields-suggested.test.ts, the form in ./registration-form-route.test.ts and
 * the submission in ./registration-submit-route.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { SUGGESTED_EVENT_FIELDS } from "@admitto/shared";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { ORIGIN, eventSeeder, harness } from "../helpers/registration-submit-harness.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

const ORG = "org-reg114-suggested";
const ADMIN_EMAIL = "reg114-admin@example.com";
const KEYS = SUGGESTED_EVENT_FIELDS.map((suggested) => suggested.source_field);

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let adminCookie = "";
let slugCounter = 0;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
  await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  const admin = await prisma.user.create({ data: { email: ADMIN_EMAIL } });
  await prisma.roleAssignment.create({ data: { user_id: admin.id, role: "admin", scope_type: "organization", scope_id: ORG } });
  await enrollConfirmedTotp(prisma, admin.id);
  adminCookie = await sessionCookieFor(prisma, admin.id);
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.session.deleteMany({ where: { user: { email: ADMIN_EMAIL } } });
  await prisma?.userMfaMethod.deleteMany({ where: { user: { email: ADMIN_EMAIL } } });
  await prisma?.roleAssignment.deleteMany({ where: { scope_id: ORG } });
  await prisma?.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  await prisma?.$disconnect();
});

/** An event that registers guests at once, whose organiser has pressed "Add suggested questions". */
async function eventWithSuggestedQuestions() {
  slugCounter += 1;
  const slug = `reg114-suggested-${slugCounter}`;
  const eventId = await seeder.addEvent(slug, { settings: { mode: "automatic", verify_email: true } });
  const h = harness({ prisma });
  const added = await h.app.request(`${ORIGIN}/api/admin/events/${eventId}/custom-fields/suggested`, {
    method: "POST",
    headers: { Cookie: adminCookie, Origin: ORIGIN, "Content-Type": "application/json" },
    body: "{}",
  });
  expect(added.status).toBe(201);
  return { slug, eventId, h };
}

/** The markup of one question: from its own `data-custom` to the next question's. */
function blockOf(html: string, key: string): string {
  const start = html.indexOf(`data-custom="${key}"`);
  expect(start, key).toBeGreaterThan(-1);
  const next = html.indexOf('data-custom="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

/** The `custom_data` of the registration an address left. */
async function answersOf(eventId: string, email: string) {
  return (await prisma.registration.findUnique({ where: { event_id_email: { event_id: eventId, email } } }))?.custom_data;
}

describe("the registration form of an event that has the suggested questions", () => {
  it("opens, and draws the five questions in the order of the set, each with its own icon but the choice", async () => {
    const { slug, h } = await eventWithSuggestedQuestions();

    const res = await h.get(`/r/${slug}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    const drawn = [...new Set([...html.matchAll(/data-custom="([a-z_]+)"/g)].map((match) => match[1]))];
    expect(drawn).toEqual(KEYS);
    for (const [key, symbol] of [
      ["parking", "i-parking"],
      ["parking_plate", "i-car"],
      ["arrival", "i-clock"],
      ["accommodation", "i-bed"],
    ] as const) {
      expect(blockOf(html, key), key).toContain(`href="#${symbol}"`);
    }
    expect(blockOf(html, "travel")).toContain('<option value="Car">Car</option><option value="Train">Train</option><option value="Plane">Plane</option><option value="Other">Other</option>');
  });

  it("asks for the registration number only after a yes to parking, and tells a guest what it may look like", async () => {
    const { slug, h } = await eventWithSuggestedQuestions();

    const html = await (await h.get(`/r/${slug}`)).text();

    expect(html).toContain('data-custom="parking_plate" data-show-when-field="parking" data-show-when-value="true"');
    expect(html).toContain("Up to 12 characters. For example: AB 123 CD");
  });
});

describe("a guest answering the suggested questions", () => {
  it("is taken with an answer to every one of them, and the answers are kept as given", async () => {
    const { slug, eventId, h } = await eventWithSuggestedQuestions();
    const answers = { parking: "true", parking_plate: "AB 123 CD", travel: "Plane", arrival: "2099-09-30T14:30", accommodation: "true" };
    const payload = h.body(slug, { custom_data: answers });

    expect((await h.post(slug, payload)).status).toBe(200);

    expect(await answersOf(eventId, payload.email)).toEqual(answers);
  });

  it("is taken with no answer at all: no question of the set is required", async () => {
    const { slug, eventId, h } = await eventWithSuggestedQuestions();
    const payload = h.body(slug);

    expect((await h.post(slug, payload)).status).toBe(200);

    expect(await prisma.registration.count({ where: { event_id: eventId, email: payload.email } })).toBe(1);
  });

  it("has a registration number that nobody asked for dropped, and keeps the answers to the questions that were asked", async () => {
    const { slug, eventId, h } = await eventWithSuggestedQuestions();
    const payload = h.body(slug, { custom_data: { parking_plate: "AB 123 CD", travel: "Car" } });

    expect((await h.post(slug, payload)).status).toBe(200);

    expect(await answersOf(eventId, payload.email)).toEqual({ travel: "Car" });
  });

  it.each([
    ["a way of travelling that is not one of the options", { travel: "Rocket" }, "custom_data.travel"],
    ["a registration number longer than the question takes", { parking: "true", parking_plate: "A".repeat(13) }, "custom_data.parking_plate"],
    ["a date and time that is not one", { arrival: "tomorrow" }, "custom_data.arrival"],
  ])("refuses %s, names the question, and stores nothing", async (_name, customData, key) => {
    const { slug, eventId, h } = await eventWithSuggestedQuestions();
    const payload = h.body(slug, { custom_data: customData });

    const res = await h.post(slug, payload);

    expect(res.status).toBe(422);
    expect(Object.keys(((await res.json()) as { errors: Record<string, string> }).errors)).toEqual([key]);
    expect(await prisma.registration.count({ where: { event_id: eventId, email: payload.email } })).toBe(0);
  });
});
