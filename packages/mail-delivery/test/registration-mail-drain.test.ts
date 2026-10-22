/**
 * The registration mail drain (the worker job `registration_mail`): which mail goes to whom, what stays out of it,
 * and what happens to a row that cannot be sent. Runs against a migrated database, so every fixture is a row its
 * CHECK constraints accept.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { setMailTemplate } from "@admitto/mail-templates";
import { createMailer } from "@admitto/mailer";
import { generateToken } from "@admitto/tickets";
import {
  DEFAULT_REGISTRATION_MAIL_DRAIN_LIMIT,
  drainPendingDeliveries,
  drainRegistrationMails,
  sendTicketEmails,
} from "../src/index.js";
import { buildConfirmUrl } from "../src/links.js";
import { MAX_MAIL_DRAIN_ATTEMPTS } from "../src/drain-retry.js";
import { resetDb } from "./resetDb.js";
import { seedOrgAndEvent } from "./seedOrgAndEvent.js";
import {
  BASE_URL,
  TEST_ENV,
  collectMail,
  createRegistration,
  mailerAnswering,
  queueMail,
  queuedMailFor,
  uniqueEmail,
} from "./registrationMailFixtures.js";

vi.mock("@admitto/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/mailer")>();
  return { ...actual, createMailer: vi.fn(actual.createMailer) };
});

vi.mock("../src/send.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/send.js")>();
  return { ...actual, sendTicketEmails: vi.fn(actual.sendTicketEmails) };
});

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-regmail-drain";
const EVENT_SLUG = "registration-event";
const NO_MAIL_EVENT_ID = "evt-regmail-no-provider";

beforeAll(async () => {
  await resetDb();
  await seedOrgAndEvent(prisma, {
    orgId: "org-regmail",
    orgName: "Registration Mail Org",
    orgSlug: "registration-mail-org",
    eventId: EVENT_ID,
    eventTitle: "Registration Event",
    eventSlug: EVENT_SLUG,
  });
  // An organisation with no mail provider saved.
  await prisma.organization.create({ data: { id: "org-regmail-none", name: "No Mail Org", slug: "no-mail-org" } });
  await prisma.event.create({
    data: {
      id: NO_MAIL_EVENT_ID,
      organization_id: "org-regmail-none",
      title: "No Provider Event",
      slug: "no-provider-event",
      date: new Date("2026-09-01"),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  // Back to the real mailer and the real ticket send, whatever the test before them answered.
  vi.mocked(createMailer).mockReset();
  vi.mocked(createMailer).mockImplementation(async (...args) => {
    const actual = await vi.importActual<typeof import("@admitto/mailer")>("@admitto/mailer");
    return actual.createMailer(...args);
  });
  vi.mocked(sendTicketEmails).mockReset();
  vi.mocked(sendTicketEmails).mockImplementation(async (...args) => {
    const actual = await vi.importActual<typeof import("../src/send.js")>("../src/send.js");
    return actual.sendTicketEmails(...args);
  });
  // Rows of the registrations go with them: the mail queue, and the attendees' deliveries first.
  await prisma.emailDelivery.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.attendee.deleteMany();
  await prisma.mailTemplate.deleteMany();
});

const drain = (deps = {}, options: { limit?: number; nowMs?: number } = {}) =>
  drainRegistrationMails(prisma, TEST_ENV, deps, { baseUrl: BASE_URL, ...options });

const mailRow = (id: string) => prisma.registrationMail.findUniqueOrThrow({ where: { id } });

/** A row never holds the guest's address, however it failed. */
const expectNoPersonalData = (row: object, email: string) => {
  const text = JSON.stringify(row);
  expect(text).not.toContain(email);
  expect(text).not.toContain("example.com");
};

describe("a registration mail", () => {
  it("goes to the registration's address with the confirmation link, and the row records that it was sent", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    const { messages, deps } = collectMail();

    const result = await drain(deps);

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0, cancelled: 0, skipped: 0, eventIds: [EVENT_ID] });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ to: registration.email, subject: "Confirm your email for Registration Event" });
    expect(messages[0]!.html).toContain(buildConfirmUrl(BASE_URL, EVENT_SLUG, registration.id));
    // An unconfirmed address gets a greeting that names no one, and the way out for whoever did not register.
    expect(messages[0]!.html).toContain("Hello,");
    expect(messages[0]!.html).not.toContain("Hi ,");
    expect(messages[0]!.html).not.toContain(registration.first_name);
    expect(messages[0]!.html).toContain("you can ignore this email");
    expect(await mailRow(mail.id)).toMatchObject({
      status: "accepted",
      attempts: 1,
      retryable: null,
      error: null,
      error_code: null,
      sent_at: expect.any(Date),
      attempted_at: expect.any(Date),
    });
  });

  it("repeats the same link when the row is queued again, as the re-sent confirmation does", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    const { messages, deps } = collectMail();
    await drain(deps);
    await prisma.registrationMail.update({
      where: { id: mail.id },
      data: { status: "queued", attempts: 0, queued_at: new Date(), sent_at: null },
    });

    await drain(deps);

    const link = buildConfirmUrl(BASE_URL, EVENT_SLUG, registration.id);
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.html.includes(link))).toBe(true);
  });

  it("has the wording of its state: received, waiting list, declined", async () => {
    await queuedMailFor(prisma, EVENT_ID, "registration-received");
    await queuedMailFor(prisma, EVENT_ID, "registration-waitlist");
    await queuedMailFor(prisma, EVENT_ID, "registration-rejected", { decidedBy: "staff-1" });
    const { messages, deps } = collectMail();

    expect(await drain(deps)).toMatchObject({ claimed: 3, sent: 3 });

    expect(messages.map((message) => message.subject)).toEqual([
      "We received your registration for Registration Event",
      "You are on the waiting list for Registration Event",
      "Your registration for Registration Event",
    ]);
    // Only the confirmation mail carries a link to confirm.
    expect(messages.some((message) => message.html.includes("/confirm/"))).toBe(false);
  });

  it("is built from the event's own template when the organiser edited it", async () => {
    await setMailTemplate(
      { scopeType: "event", scopeId: EVENT_ID, name: "registration-waitlist" },
      {
        subject: "Waiting for {{event_name}}",
        body: "<mjml><mj-body><mj-section><mj-column><mj-text>Edited: {{contact_line}}</mj-text></mj-column></mj-section></mj-body></mjml>",
        format: "mjml",
      },
      prisma,
    );
    await prisma.eventContact.create({ data: { event_id: EVENT_ID, name: "Olive Organiser", email: "olive@example.com" } });
    await queuedMailFor(prisma, EVENT_ID, "registration-waitlist");
    const { messages, deps } = collectMail();

    await drain(deps);

    expect(messages[0]!.subject).toBe("Waiting for Registration Event");
    expect(messages[0]!.html).toContain("Edited: Questions? Contact Olive Organiser at olive@example.com.");
  });

  it("is not sent when its registration is no longer in the state the mail is for", async () => {
    // The row was queued for a pending registration; staff turned it down before the tick.
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-received");
    await prisma.registration.update({ where: { id: registration.id }, data: { status: "rejected", decided_by: "staff-1" } });
    const { messages, deps } = collectMail();

    const result = await drain(deps);

    expect(result).toMatchObject({ claimed: 1, sent: 0, cancelled: 1 });
    expect(messages).toHaveLength(0);
    expect(await mailRow(mail.id)).toMatchObject({
      status: "cancelled",
      retryable: false,
      error_code: "registration_changed",
      sent_at: null,
    });
  });

  it("is not sent for a confirmation link that has expired, whether or not the clean-up has run", async () => {
    const registration = await createRegistration(prisma, EVENT_ID, "awaiting_email", { expiresAt: new Date(Date.now() - 60_000) });
    const mail = await queueMail(prisma, registration, "registration-confirm");
    const { messages, deps } = collectMail();

    expect(await drain(deps)).toMatchObject({ claimed: 1, cancelled: 1 });

    expect(messages).toHaveLength(0);
    expect(await mailRow(mail.id)).toMatchObject({ status: "cancelled", error_code: "confirmation_expired" });
  });
});

describe("the guest's own words in a registration mail", () => {
  const WITH_NAMES = {
    subject: "Hello {{first_name}} {{last_name}} about {{event_name}}",
    body: "<mjml><mj-body><mj-section><mj-column><mj-text>Dear {{first_name}} {{last_name}} ({{full_name}})</mj-text></mj-column></mj-section></mj-body></mjml>",
    format: "mjml" as const,
  };

  async function sendWithEditedTemplate(registrationOptions: Parameters<typeof queuedMailFor>[3]) {
    await setMailTemplate({ scopeType: "event", scopeId: EVENT_ID, name: "registration-received" }, WITH_NAMES, prisma);
    await queuedMailFor(prisma, EVENT_ID, "registration-received", {
      firstName: "Mallory",
      lastName: "Mallet",
      ...registrationOptions,
    });
    const { messages, deps } = collectMail();
    await drain(deps);
    return messages[0]!;
  }

  it("are left out while the address is not confirmed and staff have not decided, even from an edited template", async () => {
    const message = await sendWithEditedTemplate({});

    expect(message.subject).toBe("Hello   about Registration Event");
    expect(message.html).not.toContain("Mallory");
    expect(message.html).not.toContain("Mallet");
  });

  it("are used once the guest confirmed the address", async () => {
    const message = await sendWithEditedTemplate({ verified: true });

    expect(message.subject).toBe("Hello Mallory Mallet about Registration Event");
    expect(message.html).toContain("Mallory Mallet");
  });

  it("are used once staff decided about the registration", async () => {
    const message = await sendWithEditedTemplate({ decidedBy: "staff-1" });

    expect(message.subject).toBe("Hello Mallory Mallet about Registration Event");
  });
});

describe("a row that cannot be sent", () => {
  it("does not stop the queue: its template cannot be rendered, so it fails for good and the others go out", async () => {
    // A system template saved straight into the table with a ticket link, which no registration mail can fill.
    await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: EVENT_ID,
        name: "registration-waitlist",
        label: "Registration: waiting list",
        subject_template: "Waiting for {{event_name}}",
        body_template: '<p><a href="{{ticket_url}}">Ticket</a></p>',
        compiled_html_template: '<p><a href="{{ticket_url}}">Ticket</a></p>',
        template_format: "html",
      },
    });
    const bad = await queuedMailFor(prisma, EVENT_ID, "registration-waitlist");
    const good = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    const { messages, deps } = collectMail();

    const result = await drain(deps);

    expect(result).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
    expect(messages.map((message) => message.to)).toEqual([good.registration.email]);
    expect(await mailRow(bad.mail.id)).toMatchObject({
      status: "failed",
      retryable: false,
      attempts: 1,
      error_code: "message_unusable",
      error: "The message cannot be built from the current template.",
    });
    expect((await mailRow(good.mail.id)).status).toBe("accepted");
  });

  it("does not send the confirmation mail when its edited template has lost the link: the row fails for good", async () => {
    // Saved straight into the table, as one saved before the link was required would be.
    await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: EVENT_ID,
        name: "registration-confirm",
        label: "Registration: confirm your email",
        subject_template: "Confirm {{event_name}}",
        body_template: "<p>Welcome to {{event_name}}</p>",
        compiled_html_template: "<p>Welcome to {{event_name}}</p>",
        template_format: "html",
      },
    });
    const { mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    const { messages, deps } = collectMail();

    expect(await drain(deps)).toMatchObject({ claimed: 1, sent: 0, failed: 1 });

    expect(messages).toEqual([]);
    expect(await mailRow(mail.id)).toMatchObject({
      status: "failed",
      retryable: false,
      error_code: "message_unusable",
      error: "The message cannot be built from the current template.",
    });
  });

  it("is tried again, with the delay of the ticket mail, and gives up after the attempts the ticket mail has", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    const network = new Error(`connect ECONNREFUSED 10.0.0.5:25 while sending to ${registration.email}`);
    const unreachable = mailerAnswering({ status: "failed", provider: "smtp", retryable: true, error: network.message });
    vi.mocked(createMailer).mockResolvedValue(unreachable);

    expect(await drain()).toMatchObject({ claimed: 1, failed: 1 });

    const first = await mailRow(mail.id);
    expect(first).toMatchObject({
      status: "failed",
      attempts: 1,
      retryable: true,
      error_code: "send_failed",
      error: "The mail provider could not send the message.",
    });
    expectNoPersonalData(first, registration.email);
    expect(unreachable.sent[0]!.idempotencyKey).toBe(`registration-mail:${mail.id}`);

    // The backoff of the ticket mail: not at once, but after 30 seconds.
    expect(await drain({}, { nowMs: Date.now() })).toMatchObject({ claimed: 0 });
    expect(await drain({}, { nowMs: Date.now() + 31_000 })).toMatchObject({ claimed: 1, failed: 1 });
    expect(unreachable.sent[1]!.idempotencyKey).toBe(`registration-mail:${mail.id}:retry`);

    let later = Date.now();
    for (let attempt = 2; attempt < MAX_MAIL_DRAIN_ATTEMPTS; attempt += 1) {
      later += 600_000;
      await drain({}, { nowMs: later }); // NOSONAR - each attempt waits for the one before it
    }
    const last = await mailRow(mail.id);
    expect(last).toMatchObject({ status: "failed", attempts: MAX_MAIL_DRAIN_ATTEMPTS, retryable: false });
    expectNoPersonalData(last, registration.email);
    expect(await drain({}, { nowMs: later + 600_000 })).toMatchObject({ claimed: 0 });
  });

  it("takes a due retry even when more older rows than a batch are still in backoff", async () => {
    const now = Date.now();
    const rows = await Promise.all(Array.from({ length: 6 }, () => queuedMailFor(prisma, EVENT_ID, "registration-confirm")));
    // Five older rows that failed a second ago (the backoff of 30 seconds has not run out), and a newer one that failed
    // two minutes ago: with a batch of one, the old reading of four rows never got past the first five.
    await Promise.all(
      rows.map(({ mail }, index) =>
        prisma.registrationMail.update({
          where: { id: mail.id },
          data: {
            status: "failed",
            retryable: true,
            attempts: 1,
            attempted_at: new Date(now - (index < 5 ? 1_000 : 120_000)),
            queued_at: new Date(now - 3_600_000 + index * 1_000),
          },
        }),
      ),
    );
    const { messages, deps } = collectMail();

    expect(await drain(deps, { limit: 1, nowMs: now })).toMatchObject({ claimed: 1, sent: 1 });

    expect(messages.map((message) => message.to)).toEqual([rows[5]!.registration.email]);
    expect((await mailRow(rows[5]!.mail.id)).status).toBe("accepted");
    expect((await mailRow(rows[0]!.mail.id)).status).toBe("failed");
  });

  it("does not take a retry whose backoff has not run out, whatever its attempts, and takes one at the cap after five minutes", async () => {
    const now = Date.now();
    const rows = await Promise.all(Array.from({ length: 3 }, () => queuedMailFor(prisma, EVENT_ID, "registration-confirm")));
    // attempts 3 waits two minutes, attempts 7 waits the cap of five.
    const states = [
      { attempts: 3, ago: 100_000 },
      { attempts: 3, ago: 130_000 },
      { attempts: 7, ago: 301_000 },
    ];
    await Promise.all(
      rows.map(({ mail }, index) =>
        prisma.registrationMail.update({
          where: { id: mail.id },
          data: { status: "failed", retryable: true, attempts: states[index]!.attempts, attempted_at: new Date(now - states[index]!.ago) },
        }),
      ),
    );
    const { messages, deps } = collectMail();

    expect(await drain(deps, { nowMs: now })).toMatchObject({ claimed: 2 });

    expect(messages.map((message) => message.to).sort()).toEqual([rows[1]!.registration.email, rows[2]!.registration.email].sort());
    expect((await mailRow(rows[0]!.mail.id)).status).toBe("failed");
  });

  it("is recorded as a failure with no text of the error when the mailer throws", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    vi.mocked(createMailer).mockResolvedValue(mailerAnswering(new Error(`550 no such user <${registration.email}>`)));

    expect(await drain()).toMatchObject({ failed: 1 });

    const row = await mailRow(mail.id);
    expect(row).toMatchObject({ status: "failed", retryable: true, error_code: "send_failed" });
    expectNoPersonalData(row, registration.email);
  });

  it("fails for good, with no text of the reply, when the provider refuses the message", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    vi.mocked(createMailer).mockResolvedValue(
      mailerAnswering({ status: "rejected", provider: "smtp", retryable: false, error: `invalid recipient ${registration.email}` }),
    );

    await drain();

    const row = await mailRow(mail.id);
    expect(row).toMatchObject({ status: "failed", retryable: false, error_code: "send_rejected" });
    expectNoPersonalData(row, registration.email);
  });

  it("records the provider's id when it gives one, and the status it reports", async () => {
    const { mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    vi.mocked(createMailer).mockResolvedValue(mailerAnswering({ status: "sent", provider: "graph", providerMessageId: "message-1" }));

    await drain();

    expect(await mailRow(mail.id)).toMatchObject({ status: "sent", provider_message_id: "message-1", sent_at: expect.any(Date) });
  });

  it("fails and is tried again when no mail provider is saved for the event", async () => {
    const registration = await createRegistration(prisma, NO_MAIL_EVENT_ID, "awaiting_email");
    const mail = await queueMail(prisma, registration, "registration-confirm");

    expect(await drain()).toMatchObject({ claimed: 1, failed: 1 });

    const row = await mailRow(mail.id);
    expect(row).toMatchObject({ status: "failed", retryable: true, error_code: "mail_unavailable" });
    expectNoPersonalData(row, registration.email);
  });

  it("fails and is tried again when its template cannot be read, without keeping the error", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    vi.spyOn(prisma.mailTemplate, "findUnique").mockRejectedValue(new Error(`could not read a template for ${registration.email}`));

    expect(await drain()).toMatchObject({ failed: 1 });

    const row = await mailRow(mail.id);
    expect(row).toMatchObject({ status: "failed", retryable: true, error_code: "internal_error" });
    expectNoPersonalData(row, registration.email);
  });

  it("is recorded as an internal failure, with a fixed text, when the last check itself breaks", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error(`could not serialize access for ${registration.email}`));
    const { messages, deps } = collectMail();

    expect(await drain(deps)).toMatchObject({ failed: 1 });

    expect(messages).toHaveLength(0);
    const row = await mailRow(mail.id);
    expect(row).toMatchObject({ status: "failed", retryable: true, error_code: "internal_error" });
    expectNoPersonalData(row, registration.email);
  });

  it("counts as failed, and is left as it is, when even the failure cannot be recorded", async () => {
    const { mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    vi.spyOn(prisma, "$transaction").mockRejectedValue(new Error("connection terminated"));
    vi.spyOn(prisma.registrationMail, "updateMany").mockRejectedValue(new Error("connection terminated"));

    expect(await drain()).toMatchObject({ claimed: 1, failed: 1 });

    vi.restoreAllMocks();
    expect(await mailRow(mail.id)).toMatchObject({ status: "queued", attempts: 0 });
  });
});

describe("a row that is not the drain's to send", () => {
  it("is skipped when its registration is deleted between the read of the queue and the last check", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    const original = prisma.registrationMail.findMany.bind(prisma.registrationMail);
    vi.spyOn(prisma.registrationMail, "findMany").mockImplementationOnce(async (args) => {
      const rows = await original(args);
      await prisma.registration.delete({ where: { id: registration.id } });
      return rows;
    });
    const { messages, deps } = collectMail();

    expect(await drain(deps)).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });

    expect(messages).toHaveLength(0);
    expect(await prisma.registrationMail.count({ where: { id: mail.id } })).toBe(0);
  });

  it("writes no result, and puts no row back, for a registration deleted while its mail was being sent", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    const sent: string[] = [];
    const deps = {
      exportSink: async ({ message }: { message: { to: string } }) => {
        sent.push(message.to);
        await prisma.registration.delete({ where: { id: registration.id } });
      },
    };

    expect(await drain(deps)).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });

    // The mail was already with the provider when the registration went: it left once, and nothing was written back.
    expect(sent).toEqual([registration.email]);
    expect(await prisma.registrationMail.count({ where: { id: mail.id } })).toBe(0);
  });

  it("records no failure for a row whose registration is gone, and says it skipped it", async () => {
    const { registration, mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    // The mailer cannot be set up, and the registration is erased while it is tried.
    vi.mocked(createMailer).mockImplementation(async () => {
      await prisma.registration.delete({ where: { id: registration.id } });
      throw new Error("no provider");
    });

    expect(await drain()).toMatchObject({ claimed: 1, failed: 0, skipped: 1 });

    expect(await prisma.registrationMail.count({ where: { id: mail.id } })).toBe(0);
  });

  it("keeps a retry that reset the row while its mail was being sent", async () => {
    const { mail } = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    const deps = {
      exportSink: async () => {
        await prisma.registrationMail.update({ where: { id: mail.id }, data: { queued_at: new Date(Date.now() + 5_000) } });
      },
    };

    expect(await drain(deps)).toMatchObject({ claimed: 1, skipped: 1 });

    expect(await mailRow(mail.id)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("goes out once when two drains run on the same queue", async () => {
    const mails = await Promise.all(
      Array.from({ length: 6 }, () => queuedMailFor(prisma, EVENT_ID, "registration-confirm")),
    );
    const { messages, deps } = collectMail();

    const [first, second] = await Promise.all([drain(deps), drain(deps)]);

    // Each address once, whichever drain sent it.
    expect(messages).toHaveLength(6);
    expect(messages.map((message) => message.to)).toEqual(expect.arrayContaining(mails.map((entry) => entry.registration.email)));
    expect(first.sent + second.sent).toBe(6);
    for (const { mail } of mails) expect((await mailRow(mail.id)).attempts).toBe(1);
  });
});

describe("what a tick takes", () => {
  it("is 20 rows by default, the oldest first, and the rest on the next tick", async () => {
    expect(DEFAULT_REGISTRATION_MAIL_DRAIN_LIMIT).toBe(20);
    const mails = [];
    for (let index = 0; index < 25; index += 1) {
      mails.push(await queuedMailFor(prisma, EVENT_ID, "registration-confirm")); // NOSONAR - the order of the queue is the point
    }
    const { messages, deps } = collectMail();

    expect(await drain(deps)).toMatchObject({ claimed: 20, sent: 20 });
    expect(messages.map((message) => message.to)).toEqual(mails.slice(0, 20).map((entry) => entry.registration.email));
    expect(await drain(deps)).toMatchObject({ claimed: 5, sent: 5 });
    expect(await drain(deps)).toMatchObject({ claimed: 0 });
  });

  it("is the limit given, or the default when that is not a positive number", async () => {
    for (let index = 0; index < 3; index += 1) await queuedMailFor(prisma, EVENT_ID, "registration-confirm"); // NOSONAR - fixtures
    const { deps } = collectMail();

    expect(await drain(deps, { limit: 2 })).toMatchObject({ claimed: 2 });
    expect(await drain(deps, { limit: 0 })).toMatchObject({ claimed: 1 });
  });

  it("takes the queued rows before the failed ones that are due again", async () => {
    const failed = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    await prisma.registrationMail.update({
      where: { id: failed.mail.id },
      data: { status: "failed", retryable: true, attempts: 1, attempted_at: new Date(Date.now() - 3_600_000) },
    });
    const fresh = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    const { messages, deps } = collectMail();

    expect(await drain(deps, { limit: 1 })).toMatchObject({ claimed: 1 });
    expect(messages.map((message) => message.to)).toEqual([fresh.registration.email]);
    expect(await drain(deps, { limit: 1 })).toMatchObject({ claimed: 1 });
    expect(messages.map((message) => message.to)).toEqual([fresh.registration.email, failed.registration.email]);
  });

  it("is nothing when the queue is empty or holds only mail that is done or cannot be tried again", async () => {
    const done = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    await prisma.registrationMail.update({ where: { id: done.mail.id }, data: { status: "sent" } });
    const exhausted = await queuedMailFor(prisma, EVENT_ID, "registration-confirm");
    await prisma.registrationMail.update({
      where: { id: exhausted.mail.id },
      data: { status: "failed", retryable: false, attempts: MAX_MAIL_DRAIN_ATTEMPTS },
    });

    expect(await drain()).toEqual({ claimed: 0, sent: 0, failed: 0, cancelled: 0, skipped: 0, eventIds: [] });
  });
});

describe("a ticket row", () => {
  async function acceptedAttendee(status = "registered") {
    const attendee = await prisma.attendee.create({
      data: { event_id: EVENT_ID, email: uniqueEmail("attendee"), name: "Ada Attendee", public_ref: generateToken(), status },
    });
    const registration = await createRegistration(prisma, EVENT_ID, "accepted", { attendeeId: attendee.id, email: attendee.email });
    const mail = await queueMail(prisma, registration, "ticket");
    return { attendee, registration, mail };
  }

  const deliveriesOf = (attendeeId: string) => prisma.emailDelivery.findMany({ where: { attendee_id: attendeeId } });

  it("only triggers the usual ticket send: an EmailDelivery appears, and the ticket drain sends the one mail", async () => {
    const { attendee, mail } = await acceptedAttendee();
    const { messages, deps } = collectMail();

    expect(await drain(deps)).toMatchObject({ claimed: 1, sent: 1, failed: 0 });

    // The registration drain sent no mail of its own.
    expect(messages).toHaveLength(0);
    expect(await mailRow(mail.id)).toMatchObject({ status: "sent", attempts: 1, error_code: null });
    const deliveries = await deliveriesOf(attendee.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ purpose: "initial", status: "queued" });

    await drainPendingDeliveries(prisma, TEST_ENV, deps, { baseUrl: BASE_URL });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.to).toBe(attendee.email);
    expect((await deliveriesOf(attendee.id))[0]!.status).toBe("accepted");
  });

  it("makes no second mail when staff sent the ticket by hand before the tick", async () => {
    const { attendee, mail } = await acceptedAttendee();
    const { messages, deps } = collectMail();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [attendee.id] }, prisma, TEST_ENV, deps);
    await drainPendingDeliveries(prisma, TEST_ENV, deps, { baseUrl: BASE_URL });
    expect(messages).toHaveLength(1);

    expect(await drain(deps)).toMatchObject({ claimed: 1, sent: 1 });
    await drainPendingDeliveries(prisma, TEST_ENV, deps, { baseUrl: BASE_URL });

    // The row is done without a send: no attempt was made, and no resend was created.
    expect(await mailRow(mail.id)).toMatchObject({ status: "sent", attempts: 0 });
    expect(await deliveriesOf(attendee.id)).toHaveLength(1);
    expect(messages).toHaveLength(1);
  });

  it("makes no second delivery when staff queued the ticket by hand and the ticket drain has not sent it yet", async () => {
    const { attendee, mail } = await acceptedAttendee();
    const { messages, deps } = collectMail();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [attendee.id] }, prisma, TEST_ENV, deps);

    expect(await drain(deps)).toMatchObject({ claimed: 1, sent: 1 });
    await drainPendingDeliveries(prisma, TEST_ENV, deps, { baseUrl: BASE_URL });

    expect(await mailRow(mail.id)).toMatchObject({ status: "sent", attempts: 1 });
    expect(await deliveriesOf(attendee.id)).toHaveLength(1);
    expect(messages).toHaveLength(1);
  });

  it("is cancelled, with no delivery, when the attendee can no longer get a ticket", async () => {
    const { attendee, mail } = await acceptedAttendee("revoked");
    const { deps } = collectMail();

    expect(await drain(deps)).toMatchObject({ claimed: 1, sent: 0, cancelled: 1 });

    expect(await mailRow(mail.id)).toMatchObject({ status: "cancelled", error_code: "ticket_not_issuable" });
    expect(await deliveriesOf(attendee.id)).toHaveLength(0);
  });

  it("is cancelled when the attendee is erased but the registration is still there, which a real erasure does not leave", async () => {
    const { attendee, mail } = await acceptedAttendee();
    await prisma.$executeRaw`
      UPDATE "Attendee" SET "erased_at" = NOW(), "name" = 'Erased attendee', "public_ref" = NULL,
        "email" = 'erased-' || "id" || '@erased.invalid'
      WHERE "id" = ${attendee.id}
    `;
    const { deps } = collectMail();

    expect(await drain(deps)).toMatchObject({ claimed: 1, cancelled: 1 });

    expect(await mailRow(mail.id)).toMatchObject({ status: "cancelled", error_code: "ticket_not_issuable" });
    expect(await deliveriesOf(attendee.id)).toHaveLength(0);
  });

  it("fails and is tried again, with no error text, when the ticket send cannot start", async () => {
    const attendee = await prisma.attendee.create({
      data: { event_id: NO_MAIL_EVENT_ID, email: uniqueEmail("attendee"), name: "No Provider", public_ref: generateToken() },
    });
    const registration = await createRegistration(prisma, NO_MAIL_EVENT_ID, "accepted", { attendeeId: attendee.id });
    const mail = await queueMail(prisma, registration, "ticket");

    expect(await drain()).toMatchObject({ claimed: 1, failed: 1 });

    const row = await mailRow(mail.id);
    expect(row).toMatchObject({ status: "failed", retryable: true, error_code: "ticket_failed" });
    expectNoPersonalData(row, attendee.email);
  });

  it("is cancelled when its attendee is not found any more, and fails for a reason that is only an error text", async () => {
    const { mail } = await acceptedAttendee();
    const none = { batchId: "b", queued: 0, sent: 0, deliveries: [], resolvedTemplateId: undefined };
    vi.mocked(sendTicketEmails).mockResolvedValueOnce({ ...none, skipped: [] });
    expect(await drain()).toMatchObject({ claimed: 1, cancelled: 1 });
    expect(await mailRow(mail.id)).toMatchObject({ status: "cancelled", error_code: "registration_changed" });

    await prisma.registrationMail.update({
      where: { id: mail.id },
      data: { status: "queued", attempts: 0, queued_at: new Date(), error: null, error_code: null },
    });
    // The ticket send reports an error's own text as the reason it skipped an attendee (a token that is missing, say).
    vi.mocked(sendTicketEmails).mockResolvedValueOnce({
      ...none,
      skipped: [{ attendeeId: "a", reason: "Attendee a is issued but token_enc is missing" }],
    });
    expect(await drain()).toMatchObject({ claimed: 1, failed: 1 });
    const row = await mailRow(mail.id);
    expect(row).toMatchObject({ status: "failed", retryable: true, error_code: "ticket_failed" });
    expect(JSON.stringify(row)).not.toContain("token_enc");
  });
});
