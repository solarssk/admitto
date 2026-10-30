import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";
import {
  EMAIL_DELIVERY_STATUS,
  REGISTRATION_ACCESS_METHOD,
  REGISTRATION_MAIL_STATUS,
  REGISTRATION_MAIL_TEMPLATE_NAME,
  REGISTRATION_MODE,
  REGISTRATION_STATUS,
} from "../src/status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-registration-schema";
const EVENT_ID = "evt-registration-schema";
const OTHER_EVENT_ID = "evt-registration-schema-other";

let prisma: PrismaClient;
let n = 0;

/** Runs a raw statement that must fail with this Postgres error code on this constraint. */
async function expectViolation(action: () => Promise<unknown>, code: "23514" | "23505" | "23503", name: string): Promise<void> {
  try {
    await action();
  } catch (err) {
    // Prisma 7 puts the Postgres code and the constraint name into the message of a failed raw query.
    const message = err instanceof Error ? err.message : String(err);
    expect(message).toContain(`Code: \`${code}\``);
    expect(message).toContain(name);
    return;
  }
  throw new Error(`Expected ${name} to be violated`);
}

type RegistrationRow = {
  event?: string;
  email?: string;
  status?: string;
  confirmExpiresAt?: string | null;
  attendeeId?: string | null;
  companions?: string;
  consents?: string;
};

/** Inserts a registration with raw SQL, so the constraints (not Prisma) are what is tested. */
async function insertRegistration(row: RegistrationRow = {}): Promise<string> {
  n += 1;
  const id = `reg-${n}`;
  const status = row.status ?? "pending";
  const expiresAt =
    row.confirmExpiresAt !== undefined ? row.confirmExpiresAt : status === "awaiting_email" ? "2030-01-01T00:00:00Z" : null;
  await prisma.$executeRaw`
    INSERT INTO "Registration"
      ("id", "event_id", "email", "first_name", "last_name", "name", "status", "confirm_expires_at", "attendee_id",
       "companions", "consents", "updated_at")
    VALUES
      (${id}, ${row.event ?? EVENT_ID}, ${row.email ?? `guest-${n}@example.com`}, 'Guest', 'Test', 'Guest Test',
       ${status}, ${expiresAt}::timestamp, ${row.attendeeId ?? null},
       ${row.companions ?? "[]"}::jsonb, ${row.consents ?? "{}"}::jsonb, now())`;
  return id;
}

async function createAttendee(email: string): Promise<string> {
  const attendee = await prisma.attendee.create({ data: { event_id: EVENT_ID, email, name: "Reg Attendee" } });
  return attendee.id;
}

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma migrate reset --force", { cwd: DB_ROOT, env: { ...process.env }, stdio: "pipe" });
  prisma = createTestPrismaClient();
  await prisma.organization.create({ data: { id: ORG_ID, name: "Registration Schema Org", slug: "registration-schema" } });
  for (const [id, slug] of [
    [EVENT_ID, "registration-schema"],
    [OTHER_EVENT_ID, "registration-schema-other"],
  ] as const) {
    await prisma.event.create({
      data: { id, title: id, slug, date: new Date("2030-09-01"), organization_id: ORG_ID },
    });
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("registration status lists", () => {
  it("match the values the CHECK constraints accept", async () => {
    for (const status of REGISTRATION_STATUS) {
      const attendeeId = status === "accepted" ? await createAttendee(`status-${status}@example.com`) : null;
      await expect(insertRegistration({ status, attendeeId })).resolves.toBeTruthy();
    }
    for (const mode of REGISTRATION_MODE) {
      await prisma.$executeRaw`INSERT INTO "EventRegistrationSettings" ("id", "event_id", "mode", "updated_at") VALUES (${"mode-" + mode}, ${mode === "automatic" ? EVENT_ID : OTHER_EVENT_ID}, ${mode}, now())`;
    }
    await prisma.$executeRaw`DELETE FROM "EventRegistrationSettings"`;
    await prisma.$executeRaw`DELETE FROM "Registration"`;
    await prisma.$executeRaw`DELETE FROM "Attendee"`;
  });

  it("reuses the EmailDelivery vocabulary for RegistrationMail.status", () => {
    expect([...REGISTRATION_MAIL_STATUS]).toEqual([...EMAIL_DELIVERY_STATUS]);
  });
});

describe("EventRegistrationSettings", () => {
  it("defaults to off with the documented defaults", async () => {
    const row = await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_ID } });
    expect(row).toMatchObject({
      mode: null,
      access_methods: [],
      password_hash: null,
      waitlist_enabled: true,
      verify_email: true,
      max_companions: 0,
      ask_company: false,
      ask_department: false,
      consent_keys: [],
      styled_form_controls: false,
    });
  });

  it("is one row per event", async () => {
    await expectViolation(
      () => prisma.$executeRaw`INSERT INTO "EventRegistrationSettings" ("id", "event_id", "updated_at") VALUES ('dup-settings', ${EVENT_ID}, now())`,
      "23505",
      "EventRegistrationSettings_event_id_key",
    );
  });

  it("accepts every mode and access method, and several methods at once", async () => {
    for (const mode of REGISTRATION_MODE) {
      const saved = await prisma.eventRegistrationSettings.update({
        where: { event_id: EVENT_ID },
        data: { mode },
      });
      expect(saved.mode).toBe(mode);
    }
    const saved = await prisma.eventRegistrationSettings.update({
      where: { event_id: EVENT_ID },
      data: { access_methods: [...REGISTRATION_ACCESS_METHOD] },
    });
    expect(saved.access_methods).toEqual([...REGISTRATION_ACCESS_METHOD]);
  });

  it("rejects an unknown mode, an unknown access method and a negative companion limit", async () => {
    await expectViolation(
      () => prisma.$executeRaw`UPDATE "EventRegistrationSettings" SET "mode" = 'invite_only' WHERE "event_id" = ${EVENT_ID}`,
      "23514",
      "EventRegistrationSettings_mode_check",
    );
    await expectViolation(
      () => prisma.$executeRaw`UPDATE "EventRegistrationSettings" SET "access_methods" = ARRAY['link', 'ftp']::TEXT[] WHERE "event_id" = ${EVENT_ID}`,
      "23514",
      "EventRegistrationSettings_access_methods_check",
    );
    await expectViolation(
      () => prisma.$executeRaw`UPDATE "EventRegistrationSettings" SET "access_methods" = NULL WHERE "event_id" = ${EVENT_ID}`,
      "23514",
      "EventRegistrationSettings_access_methods_check",
    );
    await expectViolation(
      () => prisma.$executeRaw`UPDATE "EventRegistrationSettings" SET "consent_keys" = NULL WHERE "event_id" = ${EVENT_ID}`,
      "23514",
      "EventRegistrationSettings_consent_keys_not_null",
    );
    await expectViolation(
      () => prisma.$executeRaw`UPDATE "EventRegistrationSettings" SET "max_companions" = -1 WHERE "event_id" = ${EVENT_ID}`,
      "23514",
      "EventRegistrationSettings_max_companions_check",
    );
  });
});

describe("Registration constraints", () => {
  it("rejects an unknown status", async () => {
    await expectViolation(() => insertRegistration({ status: "cancelled" }), "23514", "Registration_status_check");
  });

  it("rejects an address that is not lower case and trimmed", async () => {
    await expectViolation(() => insertRegistration({ email: "Guest@Example.com" }), "23514", "Registration_email_normalized");
    await expectViolation(() => insertRegistration({ email: " guest@example.com" }), "23514", "Registration_email_normalized");
  });

  it("rejects the reserved erased-attendee namespace", async () => {
    await expectViolation(
      () => insertRegistration({ email: "someone@erased.invalid" }),
      "23514",
      "Registration_email_not_erased_placeholder",
    );
  });

  it("allows one registration per address and event, in any state", async () => {
    await insertRegistration({ email: "twice@example.com" });
    await expectViolation(
      () => insertRegistration({ email: "twice@example.com", status: "rejected" }),
      "23505",
      "Registration_event_id_email_key",
    );
    await expect(insertRegistration({ email: "twice@example.com", event: OTHER_EVENT_ID })).resolves.toBeTruthy();
  });

  it("ties status accepted to an attendee, both ways", async () => {
    const attendeeId = await createAttendee("tied@example.com");
    await expectViolation(() => insertRegistration({ status: "accepted" }), "23514", "Registration_accepted_iff_attendee");
    await expectViolation(
      () => insertRegistration({ status: "pending", attendeeId }),
      "23514",
      "Registration_accepted_iff_attendee",
    );
    await expect(insertRegistration({ status: "accepted", attendeeId })).resolves.toBeTruthy();
  });

  it("allows an attendee to belong to one registration only", async () => {
    const attendeeId = await createAttendee("single@example.com");
    await insertRegistration({ status: "accepted", attendeeId });
    await expectViolation(
      () => insertRegistration({ status: "accepted", attendeeId }),
      "23505",
      "Registration_attendee_id_event_id_key",
    );
  });

  it("refuses an attendee of another event on a registration", async () => {
    const attendeeId = await createAttendee("other-event-attendee@example.com");
    await expectViolation(
      () => insertRegistration({ status: "accepted", attendeeId, event: OTHER_EVENT_ID }),
      "23503",
      "Registration_attendee_id_event_id_fkey",
    );
  });

  it("refuses a queued mail whose event is not its registration's event", async () => {
    const registrationId = await insertRegistration({ email: "mail-event@example.com" });
    await expectViolation(
      () =>
        prisma.$executeRaw`
          INSERT INTO "RegistrationMail" ("id", "registration_id", "event_id", "template_name", "updated_at")
          VALUES ('mail-cross-event', ${registrationId}, ${OTHER_EVENT_ID}, 'registration-received', now())`,
      "23503",
      "RegistrationMail_registration_id_event_id_fkey",
    );
  });

  it("ties awaiting_email to an expiry, both ways", async () => {
    await expectViolation(
      () => insertRegistration({ status: "awaiting_email", confirmExpiresAt: null }),
      "23514",
      "Registration_awaiting_email_iff_expiry",
    );
    await expectViolation(
      () => insertRegistration({ status: "pending", confirmExpiresAt: "2030-01-01T00:00:00Z" }),
      "23514",
      "Registration_awaiting_email_iff_expiry",
    );
  });

  it("keeps companions an array and consents an object", async () => {
    await expectViolation(() => insertRegistration({ companions: '{"name":"x"}' }), "23514", "Registration_companions_is_array");
    await expectViolation(() => insertRegistration({ consents: "[]" }), "23514", "Registration_consents_is_object");
    await expect(
      insertRegistration({ companions: '[{"name":"Plus One","custom_data":{}}]', consents: '{"photos":"2030-01-01T00:00:00Z"}' }),
    ).resolves.toBeTruthy();
  });

  it("deletes the registration with its attendee and with its event, and its mail with it", async () => {
    const attendeeId = await createAttendee("cascade@example.com");
    const accepted = await insertRegistration({ status: "accepted", attendeeId });
    await prisma.registrationMail.create({
      data: { registration_id: accepted, event_id: EVENT_ID, template_name: "ticket" },
    });
    await prisma.attendee.delete({ where: { id: attendeeId } });
    expect(await prisma.registration.count({ where: { id: accepted } })).toBe(0);
    expect(await prisma.registrationMail.count({ where: { registration_id: accepted } })).toBe(0);

    const inOther = await insertRegistration({ event: OTHER_EVENT_ID, email: "event-cascade@example.com" });
    await prisma.registrationMail.create({
      data: { registration_id: inOther, event_id: OTHER_EVENT_ID, template_name: "registration-received" },
    });
    await prisma.event.delete({ where: { id: OTHER_EVENT_ID } });
    expect(await prisma.registration.count({ where: { event_id: OTHER_EVENT_ID } })).toBe(0);
    expect(await prisma.registrationMail.count({ where: { event_id: OTHER_EVENT_ID } })).toBe(0);
  });

  it("has the partial index for unconfirmed registrations, with its predicate", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'Registration' AND indexname = 'Registration_awaiting_email_expiry_idx'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain("confirm_expires_at");
    expect(rows[0]!.indexdef).toContain("awaiting_email");
  });
});

describe("RegistrationMail", () => {
  it("accepts the five templates and every delivery status", async () => {
    const registrationId = await insertRegistration({ email: "mails@example.com" });
    for (const template_name of REGISTRATION_MAIL_TEMPLATE_NAME) {
      await prisma.registrationMail.create({ data: { registration_id: registrationId, event_id: EVENT_ID, template_name } });
    }
    for (const status of REGISTRATION_MAIL_STATUS) {
      await prisma.registrationMail.updateMany({ where: { registration_id: registrationId, template_name: "ticket" }, data: { status } });
    }
    const first = await prisma.registrationMail.findFirstOrThrow({ where: { registration_id: registrationId, template_name: "ticket" } });
    expect(first).toMatchObject({ attempts: 0, retryable: null });
  });

  it("rejects an unknown template or status, and a second row for the same template", async () => {
    const registrationId = await insertRegistration({ email: "mails-bad@example.com" });
    await expectViolation(
      () => prisma.$executeRaw`INSERT INTO "RegistrationMail" ("id", "registration_id", "event_id", "template_name", "updated_at") VALUES ('bad-template', ${registrationId}, ${EVENT_ID}, 'ticket-2', now())`,
      "23514",
      "RegistrationMail_template_name_check",
    );
    await prisma.registrationMail.create({
      data: { registration_id: registrationId, event_id: EVENT_ID, template_name: "registration-confirm" },
    });
    await expectViolation(
      () => prisma.$executeRaw`UPDATE "RegistrationMail" SET "status" = 'bogus' WHERE "registration_id" = ${registrationId}`,
      "23514",
      "RegistrationMail_status_check",
    );
    await expectViolation(
      () => prisma.$executeRaw`INSERT INTO "RegistrationMail" ("id", "registration_id", "event_id", "template_name", "updated_at") VALUES ('dup-template', ${registrationId}, ${EVENT_ID}, 'registration-confirm', now())`,
      "23505",
      "RegistrationMail_registration_id_template_name_key",
    );
  });
});
