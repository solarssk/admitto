/**
 * The host of the links a guest is sent (D-C6): a mail to a guest points at the event's own address once it is verified, and at the
 * instance's before that and when the event has none; the wallet links stay on the instance's address. The choice is made inside the
 * mail pipeline, per event, so one drain with two events of different addresses sends each guest to the right host. Every address in
 * the mail is looked at, not only the link the test is about, so the address of the panel cannot leave in the logo or a map.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { retryDelivery } from "../src/retry.js";
import { buildConfirmUrl } from "../src/links.js";
import { drainPendingDeliveries, drainRegistrationMails, resolveAttendeeMailLinks, sendTicketEmails } from "../src/index.js";
import { generateToken } from "@admitto/tickets";
import { resetDb } from "./resetDb.js";
import { seedOrgAndEvent } from "./seedOrgAndEvent.js";
import { BASE_URL, TEST_ENV, collectMail, queuedMailFor } from "./registrationMailFixtures.js";

const prisma = createTestPrismaClient();
const OWN_A = "summit.acme.example";
const OWN_B = "gala.other.example";
const EVENT_A = { id: "evt-origin-a", slug: "origin-event-a" };
const EVENT_B = { id: "evt-origin-b", slug: "origin-event-b" };
const EVENT_PLAIN = { id: "evt-origin-plain", slug: "origin-event-plain" };
const VERIFIED_AT = new Date("2026-11-11T10:00:00Z");
const templateIds = new Map<string, string>();

beforeAll(async () => {
  await resetDb();
  await seedOrgAndEvent(prisma, {
    orgId: "org-origin",
    orgName: "Origin Org",
    orgSlug: "origin-org",
    eventId: EVENT_A.id,
    eventTitle: "Origin Event A",
    eventSlug: EVENT_A.slug,
  });
  for (const event of [EVENT_B, EVENT_PLAIN]) {
    await prisma.event.create({
      data: { id: event.id, organization_id: "org-origin", title: `Event ${event.slug}`, slug: event.slug, date: new Date("2026-09-01") },
    });
  }
  // The wallet is configured on every event, so a wallet link has to be somewhere.
  await prisma.event.updateMany({
    data: { logo_url: "/uploads/org-origin/brand.png", wallet_enabled: true, wallet_template_id: "tmpl-1", wallet_api_key_enc: "enc", wallet_apple_enabled: true, wallet_google_enabled: true },
  });
  for (const [event, domain] of [[EVENT_A, OWN_A], [EVENT_B, OWN_B]] as const) {
    await prisma.eventRegistrationSettings.create({ data: { event_id: event.id, custom_domain: domain } });
  }
  // One template with every link a ticket mail can hold, so none can be missed by a test that looks at the default text.
  const body = [
    '<p><a href="{{ticket_url}}">Ticket</a> <a href="{{apple_wallet_url}}">Apple</a> <a href="{{google_wallet_url}}">Google</a></p>',
    '<p><img src="{{qr_image_url}}" alt="QR" /><img src="{{logo_url}}" alt="Logo" /></p>',
  ].join("");
  // The confirmation mail of the first event holds the logo too, so the host of the images of that mail is looked at.
  const confirmBody = '<p><a href="{{confirm_url}}">Confirm</a></p><p><img src="{{logo_url}}" alt="Logo" /></p>';
  await prisma.mailTemplate.create({
    data: {
      scope_type: "event",
      scope_id: EVENT_A.id,
      name: "registration-confirm",
      label: "Confirm",
      subject_template: "Confirm your address",
      body_template: confirmBody,
      compiled_html_template: confirmBody,
      template_format: "html",
    },
  });
  for (const event of [EVENT_A, EVENT_B, EVENT_PLAIN]) {
    const template = await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: event.id,
        name: "every-link",
        label: "Every link",
        subject_template: "Your ticket",
        body_template: body,
        compiled_html_template: body,
        template_format: "html",
      },
    });
    templateIds.set(event.id, template.id);
    await prisma.attendee.create({
      data: { id: `att-${event.id}`, event_id: event.id, email: `guest-${event.slug}@example.com`, name: "Gina Guest", public_ref: generateToken() },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.emailDelivery.deleteMany();
  await prisma.registrationMail.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.eventRegistrationSettings.updateMany({
    data: { custom_domain_verified_at: null, custom_domain_status: "unchecked", custom_domain_checked_at: null },
  });
});

const verify = (eventId: string) =>
  prisma.eventRegistrationSettings.update({ where: { event_id: eventId }, data: { custom_domain_verified_at: VERIFIED_AT, custom_domain_status: "ok" } });

/** The host of every absolute address in a mail (links, images), once each. */
function hostsIn(html: string): string[] {
  const urls = html.match(/https?:\/\/[^\s"'<>)\\]+/g) ?? [];
  return [...new Set(urls.map((url) => new URL(url).host))];
}

/** The hosts of a mail that belong to the product (the ones this test's events and instance can be at). */
const productHosts = (html: string) => hostsIn(html).filter((host) => [OWN_A, OWN_B, "tickets.example.com"].includes(host));

async function ticketMailFor(event: { id: string }) {
  const { messages, deps } = collectMail();
  const queued = await sendTicketEmails(event.id, { attendeeIds: [`att-${event.id}`], templateId: templateIds.get(event.id) }, prisma, TEST_ENV, deps);
  expect(queued.queued).toBe(1);
  await drainPendingDeliveries(prisma, TEST_ENV, deps, { eventId: event.id, baseUrl: BASE_URL });
  expect(messages).toHaveLength(1);
  return messages[0]!.html;
}

describe("the confirmation mail of a registration", () => {
  it("points at the instance while the address is not verified, and at the event's own address once it is", async () => {
    const { registration } = await queuedMailFor(prisma, EVENT_A.id, "registration-confirm");
    const before = collectMail();
    await drainRegistrationMails(prisma, TEST_ENV, before.deps, { baseUrl: BASE_URL });
    expect(before.messages[0]!.html).toContain(buildConfirmUrl(BASE_URL, EVENT_A.slug, registration.id));
    expect(before.messages[0]!.html).toContain(`${BASE_URL}/uploads/org-origin/brand.png`);
    expect(productHosts(before.messages[0]!.html)).toEqual(["tickets.example.com"]);

    await verify(EVENT_A.id);
    const { registration: again } = await queuedMailFor(prisma, EVENT_A.id, "registration-confirm");
    const after = collectMail();
    await drainRegistrationMails(prisma, TEST_ENV, after.deps, { baseUrl: BASE_URL });
    expect(after.messages[0]!.html).toContain(buildConfirmUrl(`https://${OWN_A}`, EVENT_A.slug, again.id));
    // Nothing of the panel's address is left in it: not the link, not the logo.
    expect(after.messages[0]!.html).toContain(`https://${OWN_A}/uploads/org-origin/brand.png`);
    expect(productHosts(after.messages[0]!.html)).toEqual([OWN_A]);
  });

  it("uses the instance for an event that has no address of its own", async () => {
    const { registration } = await queuedMailFor(prisma, EVENT_PLAIN.id, "registration-confirm");
    const { messages, deps } = collectMail();
    await drainRegistrationMails(prisma, TEST_ENV, deps, { baseUrl: BASE_URL });
    expect(messages[0]!.html).toContain(buildConfirmUrl(BASE_URL, EVENT_PLAIN.slug, registration.id));
    expect(productHosts(messages[0]!.html)).toEqual(["tickets.example.com"]);
  });
});

describe("the ticket mail", () => {
  it("points at the instance for every address in it while the address is not verified", async () => {
    const html = await ticketMailFor(EVENT_A);
    expect(productHosts(html)).toEqual(["tickets.example.com"]);
  });

  it("sends the ticket page and the QR image to the event's own address once it is verified, and the wallet to the instance", async () => {
    await verify(EVENT_A.id);
    const html = await ticketMailFor(EVENT_A);
    const urls = html.match(/https?:\/\/[^\s"'<>)\\]+/g) ?? [];
    const own = urls.filter((url) => new URL(url).host === OWN_A);
    const instance = urls.filter((url) => new URL(url).host === "tickets.example.com");
    // The ticket page, the QR image, the logo: on the event's own address.
    expect(own.some((url) => /\/t\/[^/]+$/.test(new URL(url).pathname))).toBe(true);
    expect(own.some((url) => new URL(url).pathname.startsWith("/q/"))).toBe(true);
    expect(own.some((url) => new URL(url).pathname.startsWith("/uploads/"))).toBe(true);
    // What is left on the instance's address is the wallet and nothing else.
    expect(instance.length).toBeGreaterThan(0);
    for (const url of instance) expect(new URL(url).pathname).toMatch(/^\/t\/[^/]+\/wallet\/(apple|google)$/);
  });

  it("chooses the host per event in one drain, and the retry of a row does too", async () => {
    await verify(EVENT_A.id);
    // B has an address that is not verified; the plain event has none.
    const { messages, deps } = collectMail();
    for (const event of [EVENT_A, EVENT_B, EVENT_PLAIN]) {
      await sendTicketEmails(event.id, { attendeeIds: [`att-${event.id}`], templateId: templateIds.get(event.id) }, prisma, TEST_ENV, deps);
    }
    const drained = await drainPendingDeliveries(prisma, TEST_ENV, deps, { baseUrl: BASE_URL });
    expect(drained).toMatchObject({ claimed: 3, sent: 3 });
    const byRecipient = new Map(messages.map((message) => [message.to, message.html]));
    expect(productHosts(byRecipient.get(`guest-${EVENT_A.slug}@example.com`)!).sort()).toEqual([OWN_A, "tickets.example.com"].sort());
    for (const event of [EVENT_B, EVENT_PLAIN]) {
      expect(productHosts(byRecipient.get(`guest-${event.slug}@example.com`)!)).toEqual(["tickets.example.com"]);
    }

    // The retry of a failed row of the verified event.
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_A.id } });
    await prisma.emailDelivery.update({ where: { id: row.id }, data: { status: "failed", retryable: true, error_code: "smtp_connect" } });
    const retried = collectMail();
    expect(await retryDelivery(row.id, prisma, TEST_ENV, retried.deps, { baseUrl: BASE_URL })).toMatchObject({ ok: true });
    expect(productHosts(retried.messages[0]!.html).sort()).toEqual([OWN_A, "tickets.example.com"].sort());
  });
});

describe("resolveAttendeeMailLinks", () => {
  it("reads the address from the event, so a caller that only knows the instance's address gets the right host", async () => {
    await sendTicketEmails(EVENT_A.id, { attendeeIds: [`att-${EVENT_A.id}`] }, prisma, TEST_ENV, collectMail().deps);
    const before = await resolveAttendeeMailLinks(`att-${EVENT_A.id}`, prisma, BASE_URL);
    expect(new URL(before.ticket_url).origin).toBe(BASE_URL);

    await verify(EVENT_A.id);
    const after = await resolveAttendeeMailLinks(`att-${EVENT_A.id}`, prisma, BASE_URL);
    expect(new URL(after.ticket_url).origin).toBe(`https://${OWN_A}`);
    expect(new URL(after.qr_image_url).origin).toBe(`https://${OWN_A}`);
    expect(new URL(after.apple_wallet_url).origin).toBe(BASE_URL);
    expect(new URL(after.google_wallet_url).origin).toBe(BASE_URL);
  });
});
