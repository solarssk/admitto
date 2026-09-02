import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@admitto/db";
import type { EventCustomFieldReportsResponse } from "@admitto/shared";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE, updateSessionDeviceLabel } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

const ORG_REP = "org-reports-test";
const ORG_REP_B = "org-reports-test-b";
const EVENT_REP = "evt-reports-test";
const EVENT_REP_B = "evt-reports-test-b";
const EVENT_EMPTY = "evt-reports-empty";
const EVENT_MISSING = "evt-reports-missing";
const EVENT_WALLETS = "evt-reports-wallets";
const EVENT_WALLETS_APPLE_ONLY = "evt-reports-wallets-apple-only";
const EVENT_CUSTOM_FIELDS = "evt-reports-custom-fields";
// Minimal, separate event (not EVENT_CUSTOM_FIELDS above) so this doesn't need to mutate a
// fixture several other tests in this file already depend on - proves the tie-breaker on its
// own two-attendee, exactly-tied dataset (same reasoning as EVENT_WALLETS_APPLE_ONLY below).
const EVENT_CUSTOM_FIELDS_TIE = "evt-reports-custom-fields-tie";

const EMAIL_ADMIN = "reports-admin@example.com";
const EMAIL_ADMIN_B = "reports-admin-b@example.com";
const EMAIL_ADMIN_WALLETS = "reports-admin-wallets@example.com";
const EMAIL_OP = "reports-op@example.com";
const PASSWORD = "reports-test-pass-123";

const ATT_VIP_1 = "att-reports-vip-1";
const ATT_VIP_2 = "att-reports-vip-2";
const ATT_STD_1 = "att-reports-std-1";
const ATT_STD_2 = "att-reports-std-2";
const ATT_STD_3 = "att-reports-std-3";
const ATT_NO_SHOW = "att-reports-no-show";

const ATT_W_APPLE = "att-reports-w-apple";
const ATT_W_BOTH = "att-reports-w-both";
const ATT_W_GOOGLE = "att-reports-w-google";
const ATT_W_NOT_INSTALLED = "att-reports-w-not-installed";
const ATT_W_VOIDED = "att-reports-w-voided";
const ATT_W_NOPASS = "att-reports-w-nopass";
const ATT_W_NOTYPE = "att-reports-w-notype";
const ATT_W_LEGACY_TYPE = "att-reports-w-legacy-type";
const ATT_W_APPLE_ONLY_EVENT = "att-reports-w-apple-only-event";
const ATT_W_GOOGLE_ONLY_EVENT = "att-reports-w-google-only-event";

const ATT_CF_1 = "att-reports-cf-1";
const ATT_CF_2 = "att-reports-cf-2";
const ATT_CF_3 = "att-reports-cf-3";
const ATT_CF_4 = "att-reports-cf-4";
const ATT_CF_5 = "att-reports-cf-5";
const ATT_CF_TIE_1 = "att-reports-cf-tie-1";
const ATT_CF_TIE_2 = "att-reports-cf-tie-2";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminId: string;
let adminBId: string;
let adminWalletsId: string;
let opId: string;
let adminCookie = "";
let adminBCookie = "";
let opCookie = "";
// A dedicated admin session for the wallets export tests (rather than reusing adminCookie) -
// admin:export rate-limits per user+route (hono/route's routePath, not the eventId param), so
// reusing adminCookie here would share a single 10-per-hour budget with every admissions export
// test above and trip the limiter (Codecov coverage follow-up, PR #1125).
let adminWalletsCookie = "";

function mkAttendeeToken() {
  const token = generateToken();
  return {
    token_hash: hashToken(token),
    token_enc: encryptToString(token),
  };
}

/** Simulates an attendee row whose ticket_type doesn't (or won't) match any TicketType row - data
 * written outside the app's normal write paths, which the (event_id, ticket_type) FK (migration
 * 20260714210009_add_attendee_ticket_type_fk) now enforces for every real insert. Bypassed here
 * with Postgres's standard session_replication_role mechanism (same technique used in
 * packages/db/test/backfill-ticket-types.test.ts), scoped to one transaction so it can't leak. */
async function createUnvalidatedAttendees(
  client: PrismaClient,
  data: Prisma.AttendeeCreateManyInput[],
): Promise<void> {
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET session_replication_role = replica`);
    await tx.attendee.createMany({ data });
    await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);
  });
}

async function seed(client: PrismaClient) {
  const eventIds = [
    EVENT_REP,
    EVENT_REP_B,
    EVENT_EMPTY,
    EVENT_WALLETS,
    EVENT_WALLETS_APPLE_ONLY,
    EVENT_CUSTOM_FIELDS,
    EVENT_CUSTOM_FIELDS_TIE,
  ];
  await client.checkIn.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.emailDelivery.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.walletPass.deleteMany({ where: { attendee: { event_id: { in: eventIds } } } });
  await client.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.ticketType.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_REP, ORG_REP_B, ...eventIds] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_ADMIN_B, EMAIL_ADMIN_WALLETS, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_ADMIN_B, EMAIL_ADMIN_WALLETS] } } },
  });
  await client.user.deleteMany({
    where: { email: { in: [EMAIL_ADMIN, EMAIL_ADMIN_B, EMAIL_ADMIN_WALLETS, EMAIL_OP] } },
  });
  await client.event.deleteMany({ where: { id: { in: eventIds } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_REP, ORG_REP_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_REP, name: "Reports Org", slug: "reports-org" },
      { id: ORG_REP_B, name: "Reports Org B", slug: "reports-org-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_REP,
        title: "Reports Event",
        slug: "reports-event",
        date: new Date("2026-10-01T12:00:00.000Z"),
        capacity: 500,
        organization_id: ORG_REP,
      },
      {
        id: EVENT_REP_B,
        title: "Reports Event B",
        slug: "reports-event-b",
        date: new Date("2026-11-01T12:00:00.000Z"),
        organization_id: ORG_REP_B,
      },
      {
        id: EVENT_EMPTY,
        title: "Empty Reports Event",
        slug: "reports-empty",
        date: new Date("2026-12-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
      {
        id: EVENT_WALLETS,
        title: "Wallets Reports Event",
        slug: "reports-wallets",
        date: new Date("2027-06-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
      // Minimal, separate event (not EVENT_WALLETS above) so this doesn't need to mutate a
      // fixture several other tests in this file already depend on - proves the route handler
      // actually reads wallet_apple_enabled/wallet_google_enabled from the DB and threads them
      // through to the aggregation, on top of aggregateWalletPasses' own unit coverage
      // (wallet-reports-helpers.test.ts) for the filtering logic itself.
      {
        id: EVENT_WALLETS_APPLE_ONLY,
        title: "Apple-Only Wallets Event",
        slug: "reports-wallets-apple-only",
        date: new Date("2027-07-01T12:00:00.000Z"),
        organization_id: ORG_REP,
        wallet_google_enabled: false,
      },
      {
        id: EVENT_CUSTOM_FIELDS,
        title: "Custom Fields Reports Event",
        slug: "reports-custom-fields",
        date: new Date("2027-08-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
      {
        id: EVENT_CUSTOM_FIELDS_TIE,
        title: "Custom Fields Tie Event",
        slug: "reports-custom-fields-tie",
        date: new Date("2027-08-02T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    ],
  });

  await client.ticketType.createMany({
    data: [
      { event_id: EVENT_REP, key: "Standard", label: "Standard", sort_order: 0 },
      { event_id: EVENT_REP, key: "VIP", label: "VIP", color: "purple", sort_order: 1 },
      { event_id: EVENT_WALLETS, key: "General", label: "General", sort_order: 0 },
    ],
  });

  await createUnvalidatedAttendees(client, [
    {
      id: ATT_W_APPLE_ONLY_EVENT,
      event_id: EVENT_WALLETS_APPLE_ONLY,
      name: "Apple-Only Event Attendee",
      email: "apple-only-event@example.com",
      ticket_type: "General",
      ...mkAttendeeToken(),
    },
  ]);
  await client.walletPass.create({
    data: {
      attendee_id: ATT_W_APPLE_ONLY_EVENT,
      status: "active",
      issued_at: new Date("2027-06-15T00:00:00.000Z"),
      apple_active_registrations: 1,
      google_active_registrations: 1,
    },
  });
  // A pass registered only on the platform this event has since disabled - the reclassification
  // check above already covers a both-platform pass staying "confirmed" via its still-enabled
  // Apple registration alone; this one has no Apple registration at all, so it only demonstrates
  // the bug if admission_by_wallet's own DB filter (confirmedWalletFilter) is built from
  // enabledPlatforms too, not just aggregateWalletPasses (CodeRabbit review).
  await createUnvalidatedAttendees(client, [
    {
      id: ATT_W_GOOGLE_ONLY_EVENT,
      event_id: EVENT_WALLETS_APPLE_ONLY,
      name: "Google-Only Event Attendee",
      email: "google-only-event@example.com",
      ticket_type: "General",
      ...mkAttendeeToken(),
    },
  ]);
  await client.walletPass.create({
    data: {
      attendee_id: ATT_W_GOOGLE_ONLY_EVENT,
      status: "active",
      issued_at: new Date("2027-06-15T00:00:00.000Z"),
      apple_active_registrations: 0,
      google_active_registrations: 1,
    },
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const adminBUser = await client.user.create({ data: { email: EMAIL_ADMIN_B, password_hash } });
  const adminWalletsUser = await client.user.create({ data: { email: EMAIL_ADMIN_WALLETS, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  adminId = adminUser.id;
  adminBId = adminBUser.id;
  adminWalletsId = adminWalletsUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_REP },
      { user_id: adminBId, role: "admin", scope_type: "organization", scope_id: ORG_REP_B },
      { user_id: adminWalletsId, role: "admin", scope_type: "organization", scope_id: ORG_REP },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_REP },
    ],
  });

  for (const userId of [adminId, adminBId, adminWalletsId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }

  const admittedMorning = new Date("2026-10-01T08:15:00.000Z");
  const admittedPeak1 = new Date("2026-10-01T14:05:00.000Z");
  const admittedPeak2 = new Date("2026-10-01T14:22:00.000Z");
  const admittedPeak3 = new Date("2026-10-01T14:40:00.000Z");
  const admittedEvening = new Date("2026-10-01T18:30:00.000Z");

  await client.attendee.createMany({
    data: [
      {
        id: ATT_VIP_1,
        event_id: EVENT_REP,
        email: "vip1@example.com",
        name: "VIP One",
        ticket_type: "VIP",
        admitted_at: admittedMorning,
        admitted_by: adminId,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_VIP_2,
        event_id: EVENT_REP,
        email: "vip2@example.com",
        name: "VIP Two",
        ticket_type: "VIP",
        admitted_at: admittedPeak1,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_STD_1,
        event_id: EVENT_REP,
        email: "std1@example.com",
        name: "Standard One",
        ticket_type: "Standard",
        admitted_at: admittedPeak2,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_STD_2,
        event_id: EVENT_REP,
        email: "std2@example.com",
        name: "Standard Two",
        ticket_type: "Standard",
        admitted_at: admittedPeak3,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_STD_3,
        event_id: EVENT_REP,
        email: "std3@example.com",
        name: "Standard Three",
        ticket_type: "Standard",
        admitted_at: admittedEvening,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_NO_SHOW,
        event_id: EVENT_REP,
        email: "noshow@example.com",
        name: "No Show Guest",
        ticket_type: "Standard",
        ...mkAttendeeToken(),
      },
    ],
  });

  await client.checkIn.createMany({
    data: [
      {
        attendee_id: ATT_VIP_1,
        event_id: EVENT_REP,
        checked_in_at: admittedMorning,
        status: "VALID",
        source: "scan",
        device_id: "scanner-01",
      },
      {
        attendee_id: ATT_VIP_2,
        event_id: EVENT_REP,
        checked_in_at: admittedPeak1,
        status: "VALID",
        source: "manual",
        device_id: "desk-01",
      },
      {
        attendee_id: ATT_STD_1,
        event_id: EVENT_REP,
        checked_in_at: admittedPeak2,
        status: "VALID",
        source: "scan",
        device_id: "scanner-02",
      },
    ],
  });

  const walletIssuedAt = new Date("2026-01-15T10:00:00.000Z");
  const walletAdmittedAt = new Date("2026-01-16T09:00:00.000Z");

  await client.attendee.createMany({
    data: [
      {
        id: ATT_W_APPLE,
        event_id: EVENT_WALLETS,
        email: "w-apple@example.com",
        name: "Wallets Apple",
        ticket_type: "General",
        admitted_at: walletAdmittedAt,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_W_BOTH,
        event_id: EVENT_WALLETS,
        email: "w-both@example.com",
        name: "Wallets Both",
        ticket_type: "General",
        admitted_at: walletAdmittedAt,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_W_GOOGLE,
        event_id: EVENT_WALLETS,
        email: "w-google@example.com",
        name: "Wallets Google",
        ticket_type: "General",
        ...mkAttendeeToken(),
      },
      {
        id: ATT_W_NOT_INSTALLED,
        event_id: EVENT_WALLETS,
        email: "w-not-installed@example.com",
        name: "Wallets Not Installed",
        ticket_type: "General",
        admitted_at: walletAdmittedAt,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_W_VOIDED,
        event_id: EVENT_WALLETS,
        email: "w-voided@example.com",
        name: "Wallets Voided",
        ticket_type: "General",
        ...mkAttendeeToken(),
      },
      {
        id: ATT_W_NOPASS,
        event_id: EVENT_WALLETS,
        email: "w-nopass@example.com",
        name: "Wallets No Pass",
        ticket_type: "General",
        admitted_at: walletAdmittedAt,
        ...mkAttendeeToken(),
      },
      {
        id: ATT_W_NOTYPE,
        event_id: EVENT_WALLETS,
        email: "w-notype@example.com",
        name: "Wallets No Type",
        ticket_type: null,
        admitted_at: walletAdmittedAt,
        ...mkAttendeeToken(),
      },
    ],
  });

  // ticket_type "Retired" has no TicketType catalog row for EVENT_WALLETS - the FK added in
  // migration 20260714210009_add_attendee_ticket_type_fk requires bypassing normal inserts, same
  // as createUnvalidatedAttendees' own doc comment explains.
  await createUnvalidatedAttendees(client, [
    {
      id: ATT_W_LEGACY_TYPE,
      event_id: EVENT_WALLETS,
      email: "w-legacy-type@example.com",
      name: "Wallets Legacy Type",
      ticket_type: "Retired",
      ...mkAttendeeToken(),
    },
  ]);

  await client.walletPass.createMany({
    data: [
      {
        attendee_id: ATT_W_APPLE,
        status: "active",
        issued_at: walletIssuedAt,
        // time_to_wallet_tap now reads first_confirmed_at, not issued_at (see computeTapDays'
        // own doc comment) - both confirmed passes below (this one and ATT_W_GOOGLE) get one, the
        // same value as walletIssuedAt since only the gap to their own EmailDelivery matters.
        first_confirmed_at: walletIssuedAt,
        apple_active_registrations: 1,
        google_active_registrations: 0,
        registration_checked_at: new Date("2026-01-16T00:00:00.000Z"),
      },
      {
        attendee_id: ATT_W_BOTH,
        status: "active",
        issued_at: walletIssuedAt,
        apple_active_registrations: 2,
        google_active_registrations: 1,
        registration_checked_at: new Date("2026-01-20T00:00:00.000Z"),
      },
      {
        attendee_id: ATT_W_GOOGLE,
        status: "active",
        issued_at: walletIssuedAt,
        first_confirmed_at: walletIssuedAt,
        apple_active_registrations: 0,
        google_active_registrations: 3,
        registration_checked_at: new Date("2026-01-10T00:00:00.000Z"),
      },
      {
        attendee_id: ATT_W_NOT_INSTALLED,
        status: "active",
        issued_at: walletIssuedAt,
        apple_active_registrations: 0,
        google_active_registrations: 0,
      },
      {
        attendee_id: ATT_W_VOIDED,
        status: "voided",
        issued_at: walletIssuedAt,
        voided_at: new Date("2026-01-18T00:00:00.000Z"),
        apple_active_registrations: 0,
        google_active_registrations: 0,
      },
      {
        attendee_id: ATT_W_NOTYPE,
        status: "active",
        issued_at: walletIssuedAt,
        apple_active_registrations: 1,
        google_active_registrations: 0,
      },
      {
        attendee_id: ATT_W_LEGACY_TYPE,
        status: "active",
        issued_at: walletIssuedAt,
        apple_active_registrations: 1,
        google_active_registrations: 0,
      },
    ],
  });

  // 3 whole days before walletIssuedAt (ATT_W_APPLE's own first_confirmed_at) - exercises
  // time_to_wallet_tap's "1_3" bucket. ATT_W_NOT_INSTALLED deliberately gets no EmailDelivery
  // here (or first_confirmed_at at all - it's never actually installed, apple/google active
  // registrations both 0), so it stays excluded from the average/bucket entirely, same as any
  // other wallet attendee below with no EmailDelivery row (earliestDeliverySuccessAt returns null
  // with no successful delivery, and computeTapDays returns null with no first_confirmed_at
  // either way). status "accepted" with only accepted_at set (no sent_at) - not "sent" - is
  // deliberate: it's the only status any configured mailer adapter actually reports (see
  // earliestDeliverySuccessAt's own comment in reports-routes.ts), so this is the realistic
  // shape a real ticket-email send produces, and is what production data looked like when this
  // whole card was reporting "Not enough data yet." despite thousands of real sends.
  await client.emailDelivery.create({
    data: {
      organization_id: ORG_REP,
      event_id: EVENT_WALLETS,
      attendee_id: ATT_W_APPLE,
      purpose: "initial",
      provider: "export_only",
      status: "accepted",
      accepted_at: new Date("2026-01-12T10:00:00.000Z"),
    },
  });

  // A hard-bounced initial send followed by a successful resend - regression coverage for
  // WALLET_PASS_AGGREGATE_SELECT/WALLET_EXPORT_ATTENDEE_SELECT only counting the earliest
  // non-bounced delivery across both purposes, not just "initial" (bot review on PR #1125:
  // applyBounceResult retains sent_at on a hard bounce, so a "purpose: initial" filter alone
  // would still pick the bounced send's timestamp). On ATT_W_GOOGLE, not ATT_W_NOT_INSTALLED -
  // time_to_wallet_tap needs a genuinely confirmed pass (first_confirmed_at) to count this
  // attendee's delivery at all now, and ATT_W_GOOGLE already has one above. The bounced initial
  // is 10 whole days before walletIssuedAt (would land in the "8_plus" bucket if wrongly used);
  // the resend is 5 whole days before (lands in "4_7") - a wrong pick here changes both the
  // bucket and the average.
  await client.emailDelivery.createMany({
    data: [
      {
        organization_id: ORG_REP,
        event_id: EVENT_WALLETS,
        attendee_id: ATT_W_GOOGLE,
        purpose: "initial",
        provider: "export_only",
        status: "bounced",
        sent_at: new Date("2026-01-05T10:00:00.000Z"),
        failed_at: new Date("2026-01-05T11:00:00.000Z"),
      },
      {
        organization_id: ORG_REP,
        event_id: EVENT_WALLETS,
        attendee_id: ATT_W_GOOGLE,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        sent_at: new Date("2026-01-10T10:00:00.000Z"),
      },
    ],
  });

  // One field of each EventCustomField type - covers the report's generic per-type behavior
  // (select/boolean chart as a distribution, text only gets a fill-rate stat), not any single
  // field's own meaning. EventCustomField.event_id cascades on Event delete (schema.prisma), so
  // no separate cleanup is needed in this file's own deleteMany block above.
  await client.eventCustomField.createMany({
    data: [
      {
        event_id: EVENT_CUSTOM_FIELDS,
        source_field: "dietary",
        label: "Dietary requirements",
        type: "text",
        description: "Let us know about any allergies or dietary preferences.",
      },
      {
        event_id: EVENT_CUSTOM_FIELDS,
        source_field: "shirt_size",
        label: "Shirt size",
        type: "select",
        options: ["S", "M", "L"],
        // description deliberately omitted (stays null) - covers the report's fallback text.
      },
      { event_id: EVENT_CUSTOM_FIELDS, source_field: "vegetarian", label: "Vegetarian", type: "boolean" },
      // Answered by every attendee below (unlike the three above) - covers the "not answered"
      // bucket being omitted entirely once nobody is missing a value, per
      // EventCustomFieldReportsResponse's own doc comment.
      { event_id: EVENT_CUSTOM_FIELDS, source_field: "newsletter_optin", label: "Newsletter opt-in", type: "boolean" },
    ],
  });

  await client.attendee.createMany({
    data: [
      {
        id: ATT_CF_1,
        event_id: EVENT_CUSTOM_FIELDS,
        email: "cf1@example.com",
        name: "CF One",
        custom_data: { dietary: "Vegan", shirt_size: "M", vegetarian: "true", newsletter_optin: "true" },
        ...mkAttendeeToken(),
      },
      {
        id: ATT_CF_2,
        event_id: EVENT_CUSTOM_FIELDS,
        email: "cf2@example.com",
        name: "CF Two",
        custom_data: { dietary: "None", shirt_size: "M", vegetarian: "false", newsletter_optin: "false" },
        ...mkAttendeeToken(),
      },
      {
        id: ATT_CF_3,
        event_id: EVENT_CUSTOM_FIELDS,
        email: "cf3@example.com",
        name: "CF Three",
        // dietary deliberately unanswered - exercises the "not answered" bucket/fill-rate math.
        custom_data: { shirt_size: "L", vegetarian: "true", newsletter_optin: "true" },
        ...mkAttendeeToken(),
      },
      {
        id: ATT_CF_4,
        event_id: EVENT_CUSTOM_FIELDS,
        email: "cf4@example.com",
        name: "CF Four",
        // dietary/shirt_size/vegetarian all deliberately unanswered.
        custom_data: { newsletter_optin: "false" },
        ...mkAttendeeToken(),
      },
      {
        id: ATT_CF_5,
        event_id: EVENT_CUSTOM_FIELDS,
        email: "cf5@example.com",
        name: "CF Five",
        custom_data: { dietary: "Gluten-free", newsletter_optin: "true" },
        ...mkAttendeeToken(),
      },
    ],
  });

  // Two options, each picked by exactly one attendee - a genuine tie the raw SQL GROUP BY
  // (countAttendeesByCustomFieldValue) has no ORDER BY to break deterministically on its own.
  // "B" is created and answered before "A" so an accidental insertion-order or creation-order
  // "fix" wouldn't hide a missing tie-breaker - only sorting by the value itself keeps this
  // A-then-B regardless of DB/query-plan behavior.
  await client.eventCustomField.create({
    data: {
      event_id: EVENT_CUSTOM_FIELDS_TIE,
      source_field: "tie_field",
      label: "Tie field",
      type: "select",
      options: ["B", "A"],
    },
  });
  await client.attendee.createMany({
    data: [
      {
        id: ATT_CF_TIE_1,
        event_id: EVENT_CUSTOM_FIELDS_TIE,
        email: "cf-tie1@example.com",
        name: "CF Tie One",
        custom_data: { tie_field: "B" },
        ...mkAttendeeToken(),
      },
      {
        id: ATT_CF_TIE_2,
        event_id: EVENT_CUSTOM_FIELDS_TIE,
        email: "cf-tie2@example.com",
        name: "CF Tie Two",
        custom_data: { tie_field: "A" },
        ...mkAttendeeToken(),
      },
    ],
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });

  const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  const adminBSession = await createSession(prisma, { userId: adminBId, stage: SESSION_STAGE.FULL });
  const adminWalletsSession = await createSession(prisma, { userId: adminWalletsId, stage: SESSION_STAGE.FULL });
  const opSession = await createSession(prisma, { userId: opId, stage: SESSION_STAGE.FULL });
  adminCookie = `admitto_session=${adminSession.rawToken}`;
  adminBCookie = `admitto_session=${adminBSession.rawToken}`;
  adminWalletsCookie = `admitto_session=${adminWalletsSession.rawToken}`;
  opCookie = `admitto_session=${opSession.rawToken}`;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("GET /api/admin/events/:eventId/reports", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator (staff admin gate)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin without event org access", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for missing event (no existence leak to org admins)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/reports`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns 403 for cross-org admin on missing event (same as forbidden)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/reports`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns zero-admission summary for empty event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/reports`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { total_attendees: number; admitted: number; no_shows: number };
      by_hour: Array<{ hour: string; count: number }>;
      admission_log: unknown[];
    };
    expect(body.summary.total_attendees).toBe(0);
    expect(body.summary.admitted).toBe(0);
    expect(body.summary.no_shows).toBe(0);
    expect(body.by_hour).toHaveLength(24);
    expect(body.by_hour.every((row) => row.count === 0)).toBe(true);
    expect(body.admission_log).toEqual([]);
  });

  it("returns aggregated stats, hourly buckets, ticket types, and admission log", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as {
      event: { id: string; title: string; capacity: number | null };
      summary: {
        total_attendees: number;
        admitted: number;
        no_shows: number;
        admission_rate_pct: number;
        peak_hour: string | null;
        peak_hour_count: number;
      };
      by_hour: Array<{ hour: string; count: number }>;
      by_ticket_type: Array<{
        type: string;
        total: number;
        admitted: number;
        admission_pct: number;
      }>;
      admission_log: Array<{
        attendee_id: string;
        name: string;
        operator_user_id: string | null;
        operator_display_name: string | null;
        operator_email: string | null;
        device_id: string | null;
      }>;
      admission_log_truncated: boolean;
      admission_log_total: number;
    };

    expect(body.event.id).toBe(EVENT_REP);
    expect(body.event.capacity).toBe(500);
    expect(body.summary.total_attendees).toBe(6);
    expect(body.summary.admitted).toBe(5);
    expect(body.summary.no_shows).toBe(1);
    expect(body.summary.admission_rate_pct).toBe(83.3);
    expect(body.summary.peak_hour).toBe("14:00");
    expect(body.summary.peak_hour_count).toBe(3);

    expect(body.by_hour).toHaveLength(24);
    const hour08 = body.by_hour.find((row) => row.hour === "08:00");
    const hour14 = body.by_hour.find((row) => row.hour === "14:00");
    const hour18 = body.by_hour.find((row) => row.hour === "18:00");
    expect(hour08?.count).toBe(1);
    expect(hour14?.count).toBe(3);
    expect(hour18?.count).toBe(1);

    expect(body.by_ticket_type).toHaveLength(2);
    const standard = body.by_ticket_type.find((row) => row.type === "Standard");
    const vip = body.by_ticket_type.find((row) => row.type === "VIP");
    expect(standard).toMatchObject({ total: 4, admitted: 3, admission_pct: 75 });
    expect(vip).toMatchObject({ total: 2, admitted: 2, admission_pct: 100 });
    expect(body.by_ticket_type[0]!.type).toBe("Standard");

    expect(body.admission_log).toHaveLength(5);
    expect(body.admission_log_truncated).toBe(false);
    expect(body.admission_log_total).toBe(5);
    expect(body.admission_log[0]!.attendee_id).toBe(ATT_VIP_1);
    expect(body.admission_log[0]!.device_id).toBe("scanner-01");
    // ATT_VIP_1 was seeded with admitted_by: adminId (no display_name set) - resolves to the
    // email fallback, not the "(No operator)"/"Deleted user" cases.
    expect(body.admission_log[0]!.operator_user_id).toBe(adminId);
    expect(body.admission_log[0]!.operator_display_name).toBeNull();
    expect(body.admission_log[0]!.operator_email).toBe(EMAIL_ADMIN);
    expect(body.admission_log[1]!.device_id).toBe("desk-01");
    // ATT_VIP_2 has no admitted_by - the legacy/emergency-bearer-shaped "no operator" case.
    expect(body.admission_log[1]!.operator_user_id).toBeNull();
    expect(body.by_ticket_type[0]).toMatchObject({ key: "Standard", color: "gray" });
    expect(body.by_ticket_type[1]).toMatchObject({ key: "VIP", color: "purple" });
  });

  it("shows a catalog type with zero attendees, and a trailing (none) bucket for untyped attendees (batch 04 / #387)", async () => {
    const EVENT_CAT = "evt-reports-catalog";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_CAT } });
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_CAT } });
    await prisma.event.deleteMany({ where: { id: EVENT_CAT } });
    await prisma.event.create({
      data: {
        id: EVENT_CAT,
        title: "Catalog Reports Event",
        slug: "reports-event-catalog",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.ticketType.createMany({
      data: [
        { event_id: EVENT_CAT, key: "standard", label: "Standard", sort_order: 0 },
        { event_id: EVENT_CAT, key: "press", label: "Press", color: "teal", sort_order: 1 },
      ],
    });
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-rep-cat-1",
          event_id: EVENT_CAT,
          email: "cat1@example.com",
          name: "Typed",
          ticket_type: "standard",
          admitted_at: new Date("2026-10-01T09:00:00.000Z"),
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-cat-2",
          event_id: EVENT_CAT,
          email: "cat2@example.com",
          name: "Untyped",
          admitted_at: new Date("2026-10-01T09:05:00.000Z"),
          ...mkAttendeeToken(),
        },
      ],
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_CAT}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        by_ticket_type: Array<{ key: string | null; type: string; color: string; total: number }>;
      };
      // "press" has 0 attendees but still appears (catalog-driven, not grouped from raw data).
      expect(body.by_ticket_type).toHaveLength(3);
      expect(body.by_ticket_type[0]).toMatchObject({ key: "standard", type: "Standard", total: 1 });
      expect(body.by_ticket_type[1]).toMatchObject({ key: "press", type: "Press", total: 0 });
      expect(body.by_ticket_type[2]).toMatchObject({ key: null, type: "(none)", total: 1 });
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_CAT } });
      await prisma.ticketType.deleteMany({ where: { event_id: EVENT_CAT } });
      await prisma.event.deleteMany({ where: { id: EVENT_CAT } });
    }
  });

  it("folds a literal empty-string ticket_type into the (none) bucket instead of a confusing separate entry (CodeRabbit review)", async () => {
    const EVENT_BLANK = "evt-reports-blank";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_BLANK } });
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_BLANK } });
    await prisma.event.deleteMany({ where: { id: EVENT_BLANK } });
    await prisma.event.create({
      data: {
        id: EVENT_BLANK,
        title: "Blank Reports Event",
        slug: "reports-event-blank",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-rep-blank-null",
        event_id: EVENT_BLANK,
        email: "blank-null@example.com",
        name: "Null Type",
        admitted_at: new Date("2026-10-01T09:00:00.000Z"),
        ...mkAttendeeToken(),
      },
    });
    // Every app write path normalizes a blank submission to null before persisting - this
    // simulates data written outside those paths (e.g. raw SQL), which the DB column itself
    // doesn't forbid.
    await createUnvalidatedAttendees(prisma, [
      {
        id: "att-rep-blank-empty",
        event_id: EVENT_BLANK,
        email: "blank-empty@example.com",
        name: "Empty String Type",
        ticket_type: "",
        admitted_at: new Date("2026-10-01T09:05:00.000Z"),
        ...mkAttendeeToken(),
      },
    ]);

    try {
      const res = await app.request(`/api/admin/events/${EVENT_BLANK}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        by_ticket_type: Array<{ key: string | null; type: string; total: number }>;
      };
      expect(body.by_ticket_type).toHaveLength(1);
      expect(body.by_ticket_type[0]).toMatchObject({ key: null, type: "(none)", total: 2 });
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_BLANK } });
      await prisma.ticketType.deleteMany({ where: { event_id: EVENT_BLANK } });
      await prisma.event.deleteMany({ where: { id: EVENT_BLANK } });
    }
  });

  it("still shows an attendee whose stored ticket_type has no matching catalog row, instead of dropping it from the breakdown (Codex review)", async () => {
    const EVENT_ORPHAN = "evt-reports-orphan";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_ORPHAN } });
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_ORPHAN } });
    await prisma.event.deleteMany({ where: { id: EVENT_ORPHAN } });
    await prisma.event.create({
      data: {
        id: EVENT_ORPHAN,
        title: "Orphan Reports Event",
        slug: "reports-event-orphan",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.ticketType.create({
      data: { event_id: EVENT_ORPHAN, key: "standard", label: "Standard", sort_order: 0 },
    });
    await prisma.attendee.create({
      data: {
        id: "att-rep-orphan-1",
        event_id: EVENT_ORPHAN,
        email: "orphan1@example.com",
        name: "Typed",
        ticket_type: "standard",
        admitted_at: new Date("2026-10-01T09:00:00.000Z"),
        ...mkAttendeeToken(),
      },
    });
    // Simulates a type deleted after assignment, or data seeded outside the app's normal write
    // paths - the same scenario AttendeeDetailPage.tsx already shows as "(not in catalog)"
    // instead of silently dropping.
    await createUnvalidatedAttendees(prisma, [
      {
        id: "att-rep-orphan-2",
        event_id: EVENT_ORPHAN,
        email: "orphan2@example.com",
        name: "Stray",
        ticket_type: "deleted_type",
        admitted_at: new Date("2026-10-01T09:05:00.000Z"),
        ...mkAttendeeToken(),
      },
    ]);

    try {
      const res = await app.request(`/api/admin/events/${EVENT_ORPHAN}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        summary: { total_attendees: number };
        by_ticket_type: Array<{ key: string | null; type: string; color: string; total: number }>;
      };
      expect(body.summary.total_attendees).toBe(2);
      expect(body.by_ticket_type).toHaveLength(2);
      expect(body.by_ticket_type[0]).toMatchObject({ key: "standard", type: "Standard", total: 1 });
      expect(body.by_ticket_type[1]).toMatchObject({
        key: "deleted_type",
        type: "deleted_type (not in catalog)",
        color: "gray",
        total: 1,
      });
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_ORPHAN } });
      await prisma.ticketType.deleteMany({ where: { event_id: EVENT_ORPHAN } });
      await prisma.event.deleteMany({ where: { id: EVENT_ORPHAN } });
    }
  });

  it("buckets hourly admissions in the event timezone, not raw UTC (#268)", async () => {
    const EVENT_TZ = "evt-reports-warsaw";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_TZ } });
    await prisma.event.deleteMany({ where: { id: EVENT_TZ } });
    await prisma.event.create({
      data: {
        id: EVENT_TZ,
        title: "Warsaw Reports Event",
        slug: "reports-event-warsaw",
        date: new Date("2026-10-01T12:00:00.000Z"),
        timezone: "Europe/Warsaw",
        organization_id: ORG_REP,
      },
    });
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-rep-tz-1",
          event_id: EVENT_TZ,
          email: "tz1@example.com",
          name: "Afternoon Warsaw",
          // 14:05Z = 16:05 in Europe/Warsaw (CEST, +02:00)
          admitted_at: new Date("2026-10-01T14:05:00.000Z"),
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-tz-2",
          event_id: EVENT_TZ,
          email: "tz2@example.com",
          name: "Midnight Warsaw",
          // 22:30Z = 00:30 next day in Europe/Warsaw — crosses local midnight
          admitted_at: new Date("2026-10-01T22:30:00.000Z"),
          ...mkAttendeeToken(),
        },
      ],
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_TZ}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { by_hour: Array<{ hour: string; count: number }> };
      const byHour = new Map(body.by_hour.map((row) => [row.hour, row.count]));
      expect(byHour.get("16:00")).toBe(1);
      expect(byHour.get("00:00")).toBe(1);
      // Raw-UTC buckets must stay empty — regression guard for the AT TIME ZONE fix.
      expect(byHour.get("14:00")).toBe(0);
      expect(byHour.get("22:00")).toBe(0);
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_TZ } });
      await prisma.event.deleteMany({ where: { id: EVENT_TZ } });
    }
  });

  it("aggregates RSVP status only for admitted attendees, omitting statuses with zero admissions (Reports redesign)", async () => {
    const EVENT_RSVP = "evt-reports-rsvp";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_RSVP } });
    await prisma.event.deleteMany({ where: { id: EVENT_RSVP } });
    await prisma.event.create({
      data: {
        id: EVENT_RSVP,
        title: "RSVP Reports Event",
        slug: "reports-event-rsvp",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-rep-rsvp-confirmed",
          event_id: EVENT_RSVP,
          email: "rsvp-confirmed@example.com",
          name: "Confirmed Guest",
          rsvp_status: "confirmed",
          admitted_at: new Date("2026-10-01T09:00:00.000Z"),
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-rsvp-tentative",
          event_id: EVENT_RSVP,
          email: "rsvp-tentative@example.com",
          name: "Tentative Guest",
          rsvp_status: "tentative",
          admitted_at: new Date("2026-10-01T09:05:00.000Z"),
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-rsvp-none",
          event_id: EVENT_RSVP,
          email: "rsvp-none@example.com",
          name: "Unresponded Guest",
          admitted_at: new Date("2026-10-01T09:10:00.000Z"),
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-rsvp-declined-not-admitted",
          event_id: EVENT_RSVP,
          email: "rsvp-declined@example.com",
          name: "Declined No-show",
          rsvp_status: "declined",
          ...mkAttendeeToken(),
        },
      ],
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_RSVP}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        by_rsvp_status: Array<{ status: string; count: number }>;
      };
      const byStatus = new Map(body.by_rsvp_status.map((row) => [row.status, row.count]));
      expect(byStatus.get("confirmed")).toBe(1);
      expect(byStatus.get("tentative")).toBe(1);
      expect(byStatus.get("none")).toBe(1);
      // "declined" attendee was never admitted, so it's excluded entirely - not a zero-count bucket.
      expect(byStatus.has("declined")).toBe(false);
      expect(byStatus.has("cancelled")).toBe(false);
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_RSVP } });
      await prisma.event.deleteMany({ where: { id: EVENT_RSVP } });
    }
  });

  it("aggregates check-in method from valid scan/manual check-ins only, excluding revoked ones; operator comes from Attendee.admitted_by directly (Reports redesign)", async () => {
    const EVENT_METHOD = "evt-reports-checkin-method";
    await prisma.checkIn.deleteMany({ where: { event_id: EVENT_METHOD } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_METHOD } });
    await prisma.event.deleteMany({ where: { id: EVENT_METHOD } });
    await prisma.event.create({
      data: {
        id: EVENT_METHOD,
        title: "Checkin Method Reports Event",
        slug: "reports-event-checkin-method",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-rep-method-scan",
          event_id: EVENT_METHOD,
          email: "method-scan@example.com",
          name: "Scanned Guest",
          admitted_at: new Date("2026-10-01T09:00:00.000Z"),
          admitted_by: opId,
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-method-manual",
          event_id: EVENT_METHOD,
          email: "method-manual@example.com",
          name: "Manually Searched Guest",
          admitted_at: new Date("2026-10-01T09:05:00.000Z"),
          admitted_by: adminId,
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-method-revoked",
          event_id: EVENT_METHOD,
          email: "method-revoked@example.com",
          name: "Revoked Scan Guest",
          admitted_at: new Date("2026-10-01T09:10:00.000Z"),
          ...mkAttendeeToken(),
        },
      ],
    });
    await prisma.checkIn.createMany({
      data: [
        {
          attendee_id: "att-rep-method-scan",
          event_id: EVENT_METHOD,
          checked_in_at: new Date("2026-10-01T09:00:00.000Z"),
          status: "VALID",
          source: "scan",
          device_id: "Tablet 1 — main entrance",
        },
        {
          attendee_id: "att-rep-method-manual",
          event_id: EVENT_METHOD,
          checked_in_at: new Date("2026-10-01T09:05:00.000Z"),
          status: "VALID",
          source: "manual",
          device_id: null,
        },
        {
          attendee_id: "att-rep-method-revoked",
          event_id: EVENT_METHOD,
          checked_in_at: new Date("2026-10-01T09:10:00.000Z"),
          status: "REVOKED",
          source: "scan",
          device_id: "Tablet 1 — main entrance",
        },
      ],
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_METHOD}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        by_checkin_method: Array<{ method: string; count: number }>;
        by_operator: Array<{
          operator_user_id: string | null;
          operator_email: string | null;
          count: number;
        }>;
      };
      const byMethod = new Map(body.by_checkin_method.map((row) => [row.method, row.count]));
      // The revoked check-in used the same device but must not count - by_checkin_method stays
      // scoped to CheckIn rows with status: VALID.
      expect(byMethod.get("scan")).toBe(1);
      expect(byMethod.get("manual")).toBe(1);

      // by_operator groups Attendee.admitted_by directly, with no CheckIn-status filter of its
      // own - all three admitted attendees count once each, including the one whose only
      // CheckIn row is REVOKED (admitted_at is still set, so it's still "currently admitted").
      const byOperator = new Map(body.by_operator.map((row) => [row.operator_user_id, row]));
      expect(byOperator.get(opId)).toMatchObject({ operator_email: EMAIL_OP, count: 1 });
      expect(byOperator.get(adminId)).toMatchObject({ operator_email: EMAIL_ADMIN, count: 1 });
      expect(byOperator.get(null)).toMatchObject({ operator_email: null, count: 1 });
    } finally {
      await prisma.checkIn.deleteMany({ where: { event_id: EVENT_METHOD } });
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_METHOD } });
      await prisma.event.deleteMany({ where: { id: EVENT_METHOD } });
    }
  });

  it("counts a revoke-then-re-admit cycle once in by_checkin_method, not once per VALID row (independent PR #587 review); by_operator needs no equivalent dedup", async () => {
    const EVENT_REVOKE = "evt-reports-revoke-readmit";
    await prisma.checkIn.deleteMany({ where: { event_id: EVENT_REVOKE } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_REVOKE } });
    await prisma.event.deleteMany({ where: { id: EVENT_REVOKE } });
    await prisma.event.create({
      data: {
        id: EVENT_REVOKE,
        title: "Revoke Readmit Reports Event",
        slug: "reports-event-revoke-readmit",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-rep-revoke-readmit",
        event_id: EVENT_REVOKE,
        email: "revoke-readmit@example.com",
        name: "Revoked Then Readmitted Guest",
        // Currently admitted, via the second (manual) check-in below - admitted_by mirrors what
        // admit.ts's atomic admitted_at/admitted_by write would have set for that re-admission.
        admitted_at: new Date("2026-10-01T09:10:00.000Z"),
        admitted_by: opId,
        ...mkAttendeeToken(),
      },
    });
    // Mirrors what an operator revoke actually leaves behind (packages/tickets/src/undo.ts):
    // the original VALID row's own status is never updated, only a separate UNDO row is
    // inserted and attendee.admitted_at is cleared/reset - so a revoke-then-re-admit cycle
    // really does leave 2 VALID rows for the same attendee, not 1.
    await prisma.checkIn.createMany({
      data: [
        {
          attendee_id: "att-rep-revoke-readmit",
          event_id: EVENT_REVOKE,
          checked_in_at: new Date("2026-10-01T09:00:00.000Z"),
          status: "VALID",
          source: "scan",
          device_id: "Tablet 1 — main entrance",
        },
        {
          attendee_id: "att-rep-revoke-readmit",
          event_id: EVENT_REVOKE,
          checked_in_at: new Date("2026-10-01T09:05:00.000Z"),
          status: "UNDO",
          source: "admin_revoke",
          device_id: null,
        },
        {
          attendee_id: "att-rep-revoke-readmit",
          event_id: EVENT_REVOKE,
          checked_in_at: new Date("2026-10-01T09:10:00.000Z"),
          status: "VALID",
          source: "manual",
          device_id: "Tablet 2 — side entrance",
        },
      ],
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_REVOKE}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        summary: { admitted: number };
        by_checkin_method: Array<{ method: string; count: number }>;
        by_operator: Array<{
          operator_user_id: string | null;
          operator_display_name: string | null;
          operator_email: string | null;
          count: number;
        }>;
      };
      expect(body.summary.admitted).toBe(1);
      // One attendee, one counted check-in - not two, even though 2 rows are status:VALID.
      const totalMethodCount = body.by_checkin_method.reduce((sum, row) => sum + row.count, 0);
      expect(totalMethodCount).toBe(1);
      const byMethod = new Map(body.by_checkin_method.map((row) => [row.method, row.count]));
      expect(byMethod.get("manual")).toBe(1);
      expect(byMethod.get("scan")).toBeUndefined();
      // by_operator is grouped directly off Attendee.admitted_by, which admit.ts/undo.ts keep as
      // a single current value - unlike by_checkin_method above, no per-attendee dedup is needed
      // to avoid double-counting the revoke-then-re-admit cycle here.
      expect(body.by_operator).toEqual([
        { operator_user_id: opId, operator_display_name: null, operator_email: EMAIL_OP, count: 1 },
      ]);
    } finally {
      await prisma.checkIn.deleteMany({ where: { event_id: EVENT_REVOKE } });
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_REVOKE } });
      await prisma.event.deleteMany({ where: { id: EVENT_REVOKE } });
    }
  });

  it("excludes a revoked-and-not-readmitted attendee entirely, even though their original VALID row is untouched (CodeRabbit #587 review)", async () => {
    const EVENT_REVOKE_ONLY = "evt-reports-revoke-only";
    await prisma.checkIn.deleteMany({ where: { event_id: EVENT_REVOKE_ONLY } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_REVOKE_ONLY } });
    await prisma.event.deleteMany({ where: { id: EVENT_REVOKE_ONLY } });
    await prisma.event.create({
      data: {
        id: EVENT_REVOKE_ONLY,
        title: "Revoke Only Reports Event",
        slug: "reports-event-revoke-only",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-rep-revoke-only",
        event_id: EVENT_REVOKE_ONLY,
        email: "revoke-only@example.com",
        name: "Revoked Not Readmitted Guest",
        // Cleared by the revoke, matching what undo.ts actually does - never re-set since this
        // attendee is never re-admitted.
        admitted_at: null,
        ...mkAttendeeToken(),
      },
    });
    // Same undo.ts shape as the revoke-then-readmit case above, minus the re-admission: the
    // original VALID row's own status is left as-is, only a separate UNDO row is inserted.
    await prisma.checkIn.createMany({
      data: [
        {
          attendee_id: "att-rep-revoke-only",
          event_id: EVENT_REVOKE_ONLY,
          checked_in_at: new Date("2026-10-01T09:00:00.000Z"),
          status: "VALID",
          source: "scan",
          device_id: "Tablet 1 — main entrance",
        },
        {
          attendee_id: "att-rep-revoke-only",
          event_id: EVENT_REVOKE_ONLY,
          checked_in_at: new Date("2026-10-01T09:05:00.000Z"),
          status: "UNDO",
          source: "admin_revoke",
          device_id: null,
        },
      ],
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_REVOKE_ONLY}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        summary: { admitted: number };
        by_checkin_method: Array<{ method: string; count: number }>;
        by_operator: Array<{ operator_user_id: string | null; count: number }>;
      };
      // Not currently admitted - the status:VALID row is a red herring left over from the
      // revoked visit, not evidence this attendee should count anywhere in the report.
      expect(body.summary.admitted).toBe(0);
      expect(body.by_checkin_method).toEqual([]);
      expect(body.by_operator).toEqual([]);
    } finally {
      await prisma.checkIn.deleteMany({ where: { event_id: EVENT_REVOKE_ONLY } });
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_REVOKE_ONLY } });
      await prisma.event.deleteMany({ where: { id: EVENT_REVOKE_ONLY } });
    }
  });

  it("sorts by_operator by count descending, breaking a tie alphabetically by the resolved display label (Reports redesign)", async () => {
    const EVENT_TIEBREAK = "evt-reports-operator-tiebreak";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_TIEBREAK } });
    await prisma.event.deleteMany({ where: { id: EVENT_TIEBREAK } });
    await prisma.event.create({
      data: {
        id: EVENT_TIEBREAK,
        title: "Operator Tiebreak Reports Event",
        slug: "reports-event-operator-tiebreak",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });

    const password_hash = await hashPassword(PASSWORD);
    const [soloUser, alphaUser, zebraUser] = await Promise.all([
      prisma.user.create({
        data: { email: "op-tie-solo@example.com", password_hash, display_name: "Solo Operator" },
      }),
      prisma.user.create({
        data: { email: "op-tie-alpha@example.com", password_hash, display_name: "Alpha Operator" },
      }),
      prisma.user.create({
        data: { email: "op-tie-zebra@example.com", password_hash, display_name: "Zebra Operator" },
      }),
    ]);

    // "Solo" is the only operator with a distinct count (exercises the count-descending branch);
    // "Alpha" and "Zebra" tie at 2 apiece, so only the resolved display label's own alphabetical
    // order can decide between them (exercises the tie-break branch, both directions). The
    // no-operator bucket also ties at 2, so it must sort after both named operators purely on
    // its null operator_user_id, not on count or label (exercises the null-always-last branch
    // regardless of which side of the comparator it lands on).
    const attendees = [
      { id: "att-optie-solo-1", operator: soloUser.id, minute: 0 },
      { id: "att-optie-solo-2", operator: soloUser.id, minute: 1 },
      { id: "att-optie-solo-3", operator: soloUser.id, minute: 2 },
      { id: "att-optie-solo-4", operator: soloUser.id, minute: 3 },
      { id: "att-optie-solo-5", operator: soloUser.id, minute: 4 },
      { id: "att-optie-zebra-1", operator: zebraUser.id, minute: 5 },
      { id: "att-optie-zebra-2", operator: zebraUser.id, minute: 6 },
      { id: "att-optie-alpha-1", operator: alphaUser.id, minute: 7 },
      { id: "att-optie-alpha-2", operator: alphaUser.id, minute: 8 },
      { id: "att-optie-none-1", operator: null, minute: 9 },
      { id: "att-optie-none-2", operator: null, minute: 10 },
    ];
    await prisma.attendee.createMany({
      data: attendees.map((a) => ({
        id: a.id,
        event_id: EVENT_TIEBREAK,
        email: `${a.id}@example.com`,
        name: a.id,
        admitted_at: new Date(`2026-10-01T09:${String(a.minute).padStart(2, "0")}:00.000Z`),
        admitted_by: a.operator,
        ...mkAttendeeToken(),
      })),
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_TIEBREAK}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        by_operator: Array<{
          operator_user_id: string | null;
          operator_display_name: string | null;
          operator_email: string | null;
          count: number;
        }>;
      };
      expect(body.by_operator).toEqual([
        {
          operator_user_id: soloUser.id,
          operator_display_name: "Solo Operator",
          operator_email: "op-tie-solo@example.com",
          count: 5,
        },
        {
          operator_user_id: alphaUser.id,
          operator_display_name: "Alpha Operator",
          operator_email: "op-tie-alpha@example.com",
          count: 2,
        },
        {
          operator_user_id: zebraUser.id,
          operator_display_name: "Zebra Operator",
          operator_email: "op-tie-zebra@example.com",
          count: 2,
        },
        {
          operator_user_id: null,
          operator_display_name: null,
          operator_email: null,
          count: 2,
        },
      ]);
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_TIEBREAK } });
      await prisma.event.deleteMany({ where: { id: EVENT_TIEBREAK } });
      await prisma.user.deleteMany({
        where: { id: { in: [soloUser.id, alphaUser.id, zebraUser.id] } },
      });
    }
  });

  it("orders a deleted-user bucket and a no-operator bucket deterministically against a named operator, all tied on count (Reports redesign)", async () => {
    // The groupBy behind by_operator is ordered explicitly (admitted_by asc, nulls first) so its
    // own row order - and therefore which side of the tie-break comparator each bucket lands on -
    // is reproducible instead of left to the query planner. Explicit, ordered ids below reproduce
    // the exact "null, then deleted-user, then named-user" input order this relies on: the
    // deleted-user bucket resolves to "" for comparison purposes (both operator_display_name and
    // operator_email are null), which must still sort before the named operator's real label
    // ("" < "Zzz Named" alphabetically) and after nothing - while the no-operator bucket must
    // always sort last of all three regardless of its own id.
    const EVENT_DETBUCKET = "evt-reports-operator-detbucket";
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_DETBUCKET } });
    await prisma.event.deleteMany({ where: { id: EVENT_DETBUCKET } });
    await prisma.user.deleteMany({
      where: { id: { in: ["rr-detbucket-0-deleted", "rr-detbucket-1-user"] } },
    });
    await prisma.event.create({
      data: {
        id: EVENT_DETBUCKET,
        title: "Operator Deleted-Bucket Reports Event",
        slug: "reports-event-operator-detbucket",
        date: new Date("2026-10-02T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });

    const password_hash = await hashPassword(PASSWORD);
    const [deletedUser, namedUser] = await Promise.all([
      prisma.user.create({
        data: {
          id: "rr-detbucket-0-deleted",
          email: "op-detbucket-deleted@example.com",
          password_hash,
          display_name: "Soon Deleted Too",
        },
      }),
      prisma.user.create({
        data: {
          id: "rr-detbucket-1-user",
          email: "op-detbucket-named@example.com",
          password_hash,
          display_name: "Zzz Named",
        },
      }),
    ]);

    const attendees = [
      { id: "att-detbucket-deleted-1", operator: deletedUser.id, minute: 0 },
      { id: "att-detbucket-deleted-2", operator: deletedUser.id, minute: 1 },
      { id: "att-detbucket-named-1", operator: namedUser.id, minute: 2 },
      { id: "att-detbucket-named-2", operator: namedUser.id, minute: 3 },
      { id: "att-detbucket-none-1", operator: null, minute: 4 },
      { id: "att-detbucket-none-2", operator: null, minute: 5 },
    ];
    await prisma.attendee.createMany({
      data: attendees.map((a) => ({
        id: a.id,
        event_id: EVENT_DETBUCKET,
        email: `${a.id}@example.com`,
        name: a.id,
        admitted_at: new Date(`2026-10-02T09:${String(a.minute).padStart(2, "0")}:00.000Z`),
        admitted_by: a.operator,
        ...mkAttendeeToken(),
      })),
    });
    // Delete the user row itself so admitted_by keeps pointing at the now-dangling id, matching
    // the established "Deleted user" fixture pattern used elsewhere in this file.
    await prisma.user.delete({ where: { id: deletedUser.id } });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_DETBUCKET}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        by_operator: Array<{
          operator_user_id: string | null;
          operator_display_name: string | null;
          operator_email: string | null;
          count: number;
        }>;
      };
      expect(body.by_operator).toEqual([
        {
          operator_user_id: deletedUser.id,
          operator_display_name: null,
          operator_email: null,
          count: 2,
        },
        {
          operator_user_id: namedUser.id,
          operator_display_name: "Zzz Named",
          operator_email: "op-detbucket-named@example.com",
          count: 2,
        },
        {
          operator_user_id: null,
          operator_display_name: null,
          operator_email: null,
          count: 2,
        },
      ]);
    } finally {
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_DETBUCKET } });
      await prisma.event.deleteMany({ where: { id: EVENT_DETBUCKET } });
      await prisma.user.deleteMany({ where: { id: namedUser.id } });
    }
  });

  it("retroactively reflects a corrected device label on past check-ins for a still-live session, but falls back to the frozen snapshot once the session is gone (Reports redesign: live device-label join)", async () => {
    const EVENT_LABELFIX = "evt-reports-device-label-fix";
    await prisma.checkIn.deleteMany({ where: { event_id: EVENT_LABELFIX } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_LABELFIX } });
    await prisma.event.deleteMany({ where: { id: EVENT_LABELFIX } });
    await prisma.user.deleteMany({ where: { email: "reports-labelfix-op@example.com" } });
    await prisma.event.create({
      data: {
        id: EVENT_LABELFIX,
        title: "Device Label Fix Reports Event",
        slug: "reports-event-device-label-fix",
        date: new Date("2026-10-03T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });

    const password_hash = await hashPassword(PASSWORD);
    const operatorUser = await prisma.user.create({
      data: { email: "reports-labelfix-op@example.com", password_hash },
    });
    const { session: liveSession } = await createSession(prisma, {
      userId: operatorUser.id,
      stage: SESSION_STAGE.FULL,
      deviceLabel: "Tabelt 1 - mian entrance",
    });
    const { session: goneSession } = await createSession(prisma, {
      userId: operatorUser.id,
      stage: SESSION_STAGE.FULL,
      deviceLabel: "Old Kiosk",
    });

    await prisma.attendee.createMany({
      data: [
        {
          id: "att-labelfix-live",
          event_id: EVENT_LABELFIX,
          email: "labelfix-live@example.com",
          name: "Labelfix Live Guest",
          admitted_at: new Date("2026-10-03T09:00:00.000Z"),
          admitted_by: operatorUser.id,
          ...mkAttendeeToken(),
        },
        {
          id: "att-labelfix-gone",
          event_id: EVENT_LABELFIX,
          email: "labelfix-gone@example.com",
          name: "Labelfix Gone-Session Guest",
          admitted_at: new Date("2026-10-03T09:05:00.000Z"),
          admitted_by: operatorUser.id,
          ...mkAttendeeToken(),
        },
      ],
    });
    await prisma.checkIn.createMany({
      data: [
        {
          attendee_id: "att-labelfix-live",
          event_id: EVENT_LABELFIX,
          checked_in_at: new Date("2026-10-03T09:00:00.000Z"),
          status: "VALID",
          source: "scan",
          device_id: "Tabelt 1 - mian entrance",
          session_id: liveSession.id,
        },
        {
          attendee_id: "att-labelfix-gone",
          event_id: EVENT_LABELFIX,
          checked_in_at: new Date("2026-10-03T09:05:00.000Z"),
          status: "VALID",
          source: "scan",
          device_id: "Old Kiosk",
          session_id: goneSession.id,
        },
      ],
    });
    // The "gone" session is purged (short post-event retention, AGENTS.md) - its check-in must
    // fall back to its own frozen device_id snapshot rather than showing nothing.
    await prisma.session.delete({ where: { id: goneSession.id } });

    try {
      const before = await app.request(`/api/admin/events/${EVENT_LABELFIX}/reports`, {
        headers: { Cookie: adminCookie },
      });
      const beforeBody = (await before.json()) as {
        admission_log: Array<{ attendee_id: string; device_id: string | null }>;
      };
      const liveBefore = beforeBody.admission_log.find((r) => r.attendee_id === "att-labelfix-live");
      const goneBefore = beforeBody.admission_log.find((r) => r.attendee_id === "att-labelfix-gone");
      expect(liveBefore?.device_id).toBe("Tabelt 1 - mian entrance");
      expect(goneBefore?.device_id).toBe("Old Kiosk");

      // Exercises updateSessionDeviceLabel directly (the same @admitto/auth function the
      // superadmin-only device-label route calls) rather than that route itself - its own
      // authorization is already covered by admin-sessions.test.ts; this test's concern is
      // reports-routes.ts's join, not who may trigger the correction.
      const fixed = await updateSessionDeviceLabel(
        prisma,
        liveSession.id,
        operatorUser.id,
        "Tablet 1 — main entrance",
      );
      expect(fixed).toBe(true);

      // The CheckIn row's own device_id column is untouched - proves the retroactive fix below
      // comes from the live session join, not a rewrite of the historical row.
      const rawCheckIn = await prisma.checkIn.findFirst({
        where: { attendee_id: "att-labelfix-live" },
      });
      expect(rawCheckIn?.device_id).toBe("Tabelt 1 - mian entrance");

      const after = await app.request(`/api/admin/events/${EVENT_LABELFIX}/reports`, {
        headers: { Cookie: adminCookie },
      });
      const afterBody = (await after.json()) as {
        admission_log: Array<{ attendee_id: string; device_id: string | null }>;
      };
      const liveAfter = afterBody.admission_log.find((r) => r.attendee_id === "att-labelfix-live");
      const goneAfter = afterBody.admission_log.find((r) => r.attendee_id === "att-labelfix-gone");
      expect(liveAfter?.device_id).toBe("Tablet 1 — main entrance");
      expect(goneAfter?.device_id).toBe("Old Kiosk");
    } finally {
      await prisma.checkIn.deleteMany({ where: { event_id: EVENT_LABELFIX } });
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_LABELFIX } });
      await prisma.event.deleteMany({ where: { id: EVENT_LABELFIX } });
      await prisma.session.deleteMany({ where: { user_id: operatorUser.id } });
      await prisma.user.delete({ where: { id: operatorUser.id } });
    }
  });

  it("resolves operator display across the admin-check-in-without-device, no-operator (emergency bearer), and deleted-user cases (Reports redesign: operator attribution)", async () => {
    const EVENT_OPERATOR = "evt-reports-operator-attribution";
    await prisma.checkIn.deleteMany({ where: { event_id: EVENT_OPERATOR } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_OPERATOR } });
    await prisma.event.deleteMany({ where: { id: EVENT_OPERATOR } });
    await prisma.user.deleteMany({ where: { email: "reports-deleted-op@example.com" } });
    await prisma.event.create({
      data: {
        id: EVENT_OPERATOR,
        title: "Operator Attribution Reports Event",
        slug: "reports-event-operator-attribution",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });

    const password_hash = await hashPassword(PASSWORD);
    const deletedUser = await prisma.user.create({
      data: {
        email: "reports-deleted-op@example.com",
        password_hash,
        display_name: "Soon Deleted",
      },
    });

    await prisma.attendee.createMany({
      data: [
        {
          // Mirrors a real admin-SPA check-in (AdminCheckInRoute): operator is always recorded,
          // but no device label is ever captured on that route (OperatorDeviceGate only gates
          // /operator) - so device_id stays null while the operator is fully resolved.
          id: "att-rep-op-admin-no-device",
          event_id: EVENT_OPERATOR,
          email: "op-admin-no-device@example.com",
          name: "Admin Checked In Guest",
          admitted_at: new Date("2026-10-01T09:00:00.000Z"),
          admitted_by: adminId,
          ...mkAttendeeToken(),
        },
        {
          // Mirrors the legacy/emergency bearer path (ALLOW_CHECKIN_BEARER): no authenticated
          // session, so no operator - but the client-supplied device_id (via the CheckIn row
          // below) still comes through.
          id: "att-rep-op-none",
          event_id: EVENT_OPERATOR,
          email: "op-none@example.com",
          name: "Emergency Bearer Guest",
          admitted_at: new Date("2026-10-01T09:05:00.000Z"),
          ...mkAttendeeToken(),
        },
        {
          // admitted_by still points at a real (but since-deleted) user id - must resolve to
          // "Deleted user", not be conflated with the no-operator case above.
          id: "att-rep-op-deleted-user",
          event_id: EVENT_OPERATOR,
          email: "op-deleted-user@example.com",
          name: "Deleted Operator Guest",
          admitted_at: new Date("2026-10-01T09:10:00.000Z"),
          admitted_by: deletedUser.id,
          ...mkAttendeeToken(),
        },
      ],
    });
    await prisma.checkIn.create({
      data: {
        attendee_id: "att-rep-op-none",
        event_id: EVENT_OPERATOR,
        checked_in_at: new Date("2026-10-01T09:05:00.000Z"),
        status: "VALID",
        source: "scan",
        device_id: "emergency-tablet",
      },
    });
    // Delete the user row itself - admitted_by keeps pointing at the now-dangling id (the column
    // has no FK, matching how a real deleted staff account would leave old admission rows intact).
    await prisma.user.delete({ where: { id: deletedUser.id } });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_OPERATOR}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        admission_log: Array<{
          attendee_id: string;
          operator_user_id: string | null;
          operator_display_name: string | null;
          operator_email: string | null;
          device_id: string | null;
        }>;
      };
      const byId = new Map(body.admission_log.map((row) => [row.attendee_id, row]));

      expect(byId.get("att-rep-op-admin-no-device")).toMatchObject({
        operator_user_id: adminId,
        operator_display_name: null,
        operator_email: EMAIL_ADMIN,
        device_id: null,
      });

      expect(byId.get("att-rep-op-none")).toMatchObject({
        operator_user_id: null,
        operator_display_name: null,
        operator_email: null,
        device_id: "emergency-tablet",
      });

      const deletedOperator = byId.get("att-rep-op-deleted-user");
      expect(deletedOperator?.operator_user_id).toBe(deletedUser.id);
      expect(deletedOperator?.operator_display_name).toBeNull();
      expect(deletedOperator?.operator_email).toBeNull();

      // CSV/PDF collapse the same three cases to distinct strings - "Deleted user" must not read
      // the same as "(No operator)".
      const csvRes = await app.request(
        `/api/admin/events/${EVENT_OPERATOR}/reports/export?format=csv`,
        { headers: { Cookie: adminCookie } },
      );
      const csvText = (await csvRes.text()).replace(/^﻿/, "");
      const csvLines = csvText.split("\r\n");
      const adminLine = csvLines.find((l) => l.includes("op-admin-no-device@example.com"));
      const noOpLine = csvLines.find((l) => l.includes("op-none@example.com"));
      const deletedLine = csvLines.find((l) => l.includes("op-deleted-user@example.com"));
      expect(adminLine).toContain(`"${EMAIL_ADMIN}"`);
      expect(noOpLine).toContain('"(No operator)"');
      expect(deletedLine).toContain('"Deleted user"');

      const pdfRes = await app.request(
        `/api/admin/events/${EVENT_OPERATOR}/reports/export?format=pdf`,
        { headers: { Cookie: adminCookie } },
      );
      const html = await pdfRes.text();
      expect(html).toContain("(No operator) (emergency-tablet)");
      expect(html).toContain("Deleted user");
    } finally {
      await prisma.checkIn.deleteMany({ where: { event_id: EVENT_OPERATOR } });
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_OPERATOR } });
      await prisma.event.deleteMany({ where: { id: EVENT_OPERATOR } });
    }
  });

  it("shows only issued (not pending or returned) event-day items on the admission log, CSV, and PDF exports (Reports redesign)", async () => {
    const EVENT_ITEMS = "evt-reports-items";
    await prisma.attendeeItemState.deleteMany({ where: { event_item: { event_id: EVENT_ITEMS } } });
    await prisma.eventItem.deleteMany({ where: { event_id: EVENT_ITEMS } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_ITEMS } });
    await prisma.event.deleteMany({ where: { id: EVENT_ITEMS } });
    await prisma.event.create({
      data: {
        id: EVENT_ITEMS,
        title: "Items Reports Event",
        slug: "reports-event-items",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_REP,
      },
    });
    const badge = await prisma.eventItem.create({
      data: { event_id: EVENT_ITEMS, key: "badge", label: "Badge" },
    });
    const giftBag = await prisma.eventItem.create({
      data: { event_id: EVENT_ITEMS, key: "giftbag", label: "Gift bag" },
    });
    const headset = await prisma.eventItem.create({
      data: { event_id: EVENT_ITEMS, key: "headset", label: "Headset" },
    });
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-rep-items-full",
          event_id: EVENT_ITEMS,
          email: "items-full@example.com",
          name: "Fully Issued Guest",
          admitted_at: new Date("2026-10-01T09:00:00.000Z"),
          ...mkAttendeeToken(),
        },
        {
          id: "att-rep-items-none",
          event_id: EVENT_ITEMS,
          email: "items-none@example.com",
          name: "Nothing Issued Guest",
          admitted_at: new Date("2026-10-01T09:05:00.000Z"),
          ...mkAttendeeToken(),
        },
      ],
    });
    await prisma.attendeeItemState.createMany({
      data: [
        { attendee_id: "att-rep-items-full", event_item_id: badge.id, state: "issued" },
        { attendee_id: "att-rep-items-full", event_item_id: giftBag.id, state: "issued" },
        { attendee_id: "att-rep-items-full", event_item_id: headset.id, state: "pending" },
        { attendee_id: "att-rep-items-none", event_item_id: badge.id, state: "returned" },
      ],
    });
    // A populated Device column on the "none" row - without this, the CSV assertion below
    // (checking the row's last cell is an empty quoted string) couldn't actually distinguish
    // "Items is empty" from "every trailing cell on this row happens to be empty."
    await prisma.checkIn.create({
      data: {
        attendee_id: "att-rep-items-none",
        event_id: EVENT_ITEMS,
        checked_in_at: new Date("2026-10-01T09:05:00.000Z"),
        status: "VALID",
        source: "scan",
        device_id: "Tablet 1 — main entrance",
      },
    });

    try {
      const res = await app.request(`/api/admin/events/${EVENT_ITEMS}/reports`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        admission_log: Array<{ attendee_id: string; items: string[] }>;
      };
      const full = body.admission_log.find((row) => row.attendee_id === "att-rep-items-full");
      const none = body.admission_log.find((row) => row.attendee_id === "att-rep-items-none");
      // Badge before Gift bag - ordered by event_item.key ascending ("badge" < "giftbag").
      expect(full?.items).toEqual(["Badge", "Gift bag"]);
      expect(none?.items).toEqual([]);

      const csvRes = await app.request(
        `/api/admin/events/${EVENT_ITEMS}/reports/export?format=csv`,
        { headers: { Cookie: adminCookie } },
      );
      const csvText = (await csvRes.text()).replace(/^﻿/, "");
      const csvLines = csvText.split("\r\n");
      expect(csvLines[0]).toContain('"Items"');
      const fullCsvLine = csvLines.find((line) => line.includes("items-full@example.com"));
      expect(fullCsvLine).toContain('"Badge, Gift bag"');
      const noneCsvLine = csvLines.find((line) => line.includes("items-none@example.com"));
      // Items is the CSV's last column - checking the line's own trailing cell (not just "the
      // line contains an empty quoted string somewhere") is what actually pins this down to
      // Items specifically, since Device is deliberately non-empty on this row above.
      expect(noneCsvLine?.endsWith(',""')).toBe(true);
      expect(noneCsvLine).toContain('"Tablet 1 — main entrance"');

      const pdfRes = await app.request(
        `/api/admin/events/${EVENT_ITEMS}/reports/export?format=pdf`,
        { headers: { Cookie: adminCookie } },
      );
      const html = await pdfRes.text();
      expect(html).toContain("<th>Items</th>");
      expect(html).toContain("Badge, Gift bag");
    } finally {
      await prisma.checkIn.deleteMany({ where: { event_id: EVENT_ITEMS } });
      await prisma.attendeeItemState.deleteMany({ where: { event_item: { event_id: EVENT_ITEMS } } });
      await prisma.eventItem.deleteMany({ where: { event_id: EVENT_ITEMS } });
      await prisma.attendee.deleteMany({ where: { event_id: EVENT_ITEMS } });
      await prisma.event.deleteMany({ where: { id: EVENT_ITEMS } });
    }
  });
});

describe("GET /api/admin/events/:eventId/reports/export", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid format", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=xlsx`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("format must be csv or pdf");
  });

  it("defaults to csv when format is omitted", async () => {
    // adminWalletsCookie, not adminCookie - see the identical comment on the "invalid report"
    // test below (separate admin:export rate-limit bucket).
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export`, {
      headers: { Cookie: adminWalletsCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
  });

  it("returns 400 for invalid report", async () => {
    // adminWalletsCookie, not adminCookie - a distinct rate-limit bucket so this doesn't compete
    // with the admin:export budget the tests below already use up (see adminWalletsCookie's own
    // doc comment above).
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv&report=bogus`, {
      headers: { Cookie: adminWalletsCookie },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("report must be admissions or wallets");
  });

  it("returns 403 for operator on CSV export", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for cross-org admin on PDF export", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=pdf`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns CSV with BOM, headers, and admitted rows", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain('filename="admissions-reports-event-');
    expect(res.headers.get("X-Admission-Log-Total")).toBe("5");
    expect(res.headers.get("X-Admission-Log-Truncated")).toBe("false");

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder().decode(buf);
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toContain('"Admitted at (');
    expect(lines[0]).toContain('"Checked in by"');
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain('"VIP One"');
    // ATT_VIP_1 was seeded with admitted_by: adminId - "Checked in by" and "Device" stay separate
    // CSV columns (unlike the merged PDF/on-screen presentation).
    expect(lines[1]).toContain(`"${EMAIL_ADMIN}"`);
    expect(lines[1]).toContain('"scanner-01"');
    expect(lines[1]).not.toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it("returns CSV headers only when no admissions", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/reports/export?format=csv`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Admission-Log-Total")).toBe("0");
    expect(res.headers.get("X-Admission-Log-Truncated")).toBe("false");
    const text = await res.text();
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toContain('"Admitted at (');
    expect(lines).toHaveLength(1);
  });

  it("returns printable HTML for pdf format", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=pdf`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain("Reports Event");
    expect(html).toContain("By ticket type");
    expect(html).toContain("VIP One");
    expect(html).toContain("<th>Checked in by</th>");
    // ATT_VIP_1 (admitted_by: adminId, device_id: scanner-01) - PDF merges operator + device
    // into one cell, unlike CSV's separate columns.
    expect(html).toContain(`${EMAIL_ADMIN} (scanner-01)`);
  });

  it("PDF admission log falls back to a 'No admissions yet' row when there are none", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/reports/export?format=pdf`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No admissions yet");
  });

  it("audit: reports_exported with format and count after CSV export", async () => {
    await prisma.attendeeActionLog.deleteMany({
      where: { event_id: EVENT_REP, action_type: "reports_exported" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/export?format=csv`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_REP, action_type: "reports_exported" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.attendee_id).toBeNull();
    const meta = log!.metadata as Record<string, unknown>;
    expect(meta.format).toBe("csv");
    expect(meta.count).toBe(5);
    expect(meta.truncated).toBe(false);
  });
});

describe("GET /api/admin/events/:eventId/reports/wallets", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_WALLETS}/reports/wallets`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator (staff admin gate)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/wallets`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin without event org access", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_WALLETS}/reports/wallets`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns zero-adoption summary for an event with no attendees", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/reports/wallets`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_attendees: number;
      synced_at: string | null;
      passes_truncated: boolean;
      adoption: { got_pass: number; confirmed: number };
      issued_by_day: unknown[];
    };
    expect(body.total_attendees).toBe(0);
    expect(body.synced_at).toBeNull();
    expect(body.passes_truncated).toBe(false);
    expect(body.adoption.got_pass).toBe(0);
    expect(body.adoption.confirmed).toBe(0);
    expect(body.issued_by_day).toEqual([]);
  });

  // End-to-end wiring check (event.wallet_apple_enabled/wallet_google_enabled -> route handler ->
  // enabledWalletPlatforms -> aggregateWalletPasses) on top of aggregateWalletPasses' own unit
  // coverage for the filtering logic itself (wallet-reports-helpers.test.ts).
  it("reclassifies a both-platform pass as apple-only when the event has Google Wallet disabled, and excludes a google-only pass from admission_by_wallet entirely", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_WALLETS_APPLE_ONLY}/reports/wallets`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      adoption: { got_pass: number; confirmed: number };
      platform: { apple_only: number; google_only: number; both: number };
      registrations_per_attendee: { buckets: Array<{ key: string; count: number; pct: number }> };
      admission_by_wallet: {
        with_wallet: { total: number; admitted: number; pct: number };
        without_wallet: { total: number; admitted: number; pct: number };
      };
    };
    expect(body.adoption.got_pass).toBe(2);
    expect(body.adoption.confirmed).toBe(1);
    expect(body.platform).toEqual({ apple_only: 1, google_only: 0, both: 0 });
    // ATT_W_APPLE_ONLY_EVENT has apple_active_registrations=1, google_active_registrations=1,
    // but Google is disabled for this event - the same enabledPlatforms-zeroed googleActive=0
    // classifyPassPlatform already uses feeds this bucket too, so the sum is 1, not 2.
    expect(body.registrations_per_attendee.buckets).toEqual([
      { key: "1", count: 1, pct: 100 },
      { key: "2", count: 0, pct: 0 },
      { key: "3", count: 0, pct: 0 },
      { key: "4_plus", count: 0, pct: 0 },
    ]);
    // ATT_W_GOOGLE_ONLY_EVENT's registration is only on the now-disabled Google platform - without
    // enabledPlatforms gating confirmedWalletFilter too (not just aggregateWalletPasses above),
    // this would still count it as "with wallet" here despite adoption.confirmed already
    // excluding it as not installed (CodeRabbit review).
    expect(body.admission_by_wallet.with_wallet.total).toBe(1);
    expect(body.admission_by_wallet.without_wallet.total).toBe(1);
  });

  it("aggregates adoption, platform mix, ticket-type breakdown, time-to-tap, and admission-by-wallet-status", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_WALLETS}/reports/wallets`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as {
      total_attendees: number;
      synced_at: string | null;
      passes_truncated: boolean;
      adoption: { got_pass: number; got_pass_pct: number; confirmed: number; confirmed_pct: number };
      platform: { apple_only: number; google_only: number; both: number };
      registrations_per_attendee: { buckets: Array<{ key: string; count: number; pct: number }> };
      by_ticket_type: Array<{
        key: string | null;
        type: string;
        total: number;
        got_pass: number;
        pct: number;
        confirmed: number;
        confirmed_pct: number;
      }>;
      issued_by_day: Array<{ count: number; cumulative: number }>;
      time_to_wallet_tap: {
        average_days: number | null;
        buckets: Array<{ key: string; count: number; pct: number }>;
      };
      admission_by_wallet: {
        with_wallet: { total: number; admitted: number; pct: number };
        without_wallet: { total: number; admitted: number; pct: number };
      };
    };

    expect(body.total_attendees).toBe(8);
    // The most recently registration_checked_at pass (ATT_W_BOTH, 2026-01-20) wins, not the
    // most recently issued or the seed's insertion order.
    expect(body.synced_at).toBe(new Date("2026-01-20T00:00:00.000Z").toISOString());
    expect(body.passes_truncated).toBe(false);

    expect(body.adoption.got_pass).toBe(7); // every wallet attendee except ATT_W_NOPASS
    expect(body.adoption.got_pass_pct).toBeCloseTo(87.5);
    expect(body.adoption.confirmed).toBe(5); // apple/google/both/notype/legacy - not-installed and voided excluded
    expect(body.adoption.confirmed_pct).toBeCloseTo(71.4);

    expect(body.platform).toEqual({ apple_only: 3, google_only: 1, both: 1 });

    // Registrations per attendee: ATT_W_APPLE (1+0=1), ATT_W_NOTYPE (1+0=1), ATT_W_LEGACY_TYPE
    // (1+0=1) bucket as "1"; ATT_W_BOTH (2+1=3) and ATT_W_GOOGLE (0+3=3) bucket as "3" - sums to
    // adoption.confirmed=5 above, same as `platform`.
    expect(body.registrations_per_attendee.buckets).toEqual([
      { key: "1", count: 3, pct: 60 },
      { key: "2", count: 0, pct: 0 },
      { key: "3", count: 2, pct: 40 },
      { key: "4_plus", count: 0, pct: 0 },
    ]);

    const general = body.by_ticket_type.find((t) => t.key === "General");
    expect(general).toBeDefined();
    expect(general!.total).toBe(6);
    expect(general!.got_pass).toBe(5);
    expect(general!.pct).toBeCloseTo(83.3);
    // Installed (confirmed) count is distinct from got_pass (issued): of General's 5 issued
    // passes, only APPLE/BOTH/GOOGLE are actually confirmed - NOT_INSTALLED (0 registrations)
    // and VOIDED don't count, even though both are included in got_pass above.
    expect(general!.confirmed).toBe(3);
    expect(general!.confirmed_pct).toBeCloseTo(50);

    const none = body.by_ticket_type.find((t) => t.key === null);
    expect(none).toBeDefined();
    expect(none!.type).toBe("(none)");
    expect(none!.total).toBe(1);
    expect(none!.got_pass).toBe(1);
    expect(none!.confirmed).toBe(1); // ATT_W_NOTYPE has an active apple registration

    const notInCatalog = body.by_ticket_type.find((t) => t.key === "Retired");
    expect(notInCatalog).toBeDefined();
    expect(notInCatalog!.type).toBe("(not in catalog)");
    expect(notInCatalog!.total).toBe(1);
    expect(notInCatalog!.got_pass).toBe(1);
    expect(notInCatalog!.confirmed).toBe(1); // ATT_W_LEGACY_TYPE has an active apple registration

    // Every pass was issued on the same seeded day - assert on the first real entry and the
    // final cumulative rather than array length, since the zero-fill-through-today extension
    // (EventWalletReportsResponse.issued_by_day's own doc comment) makes the array length
    // depend on the real calendar date the suite happens to run on.
    expect(body.issued_by_day[0]!.count).toBe(7);
    expect(body.issued_by_day[0]!.cumulative).toBe(7);
    expect(body.issued_by_day.at(-1)!.cumulative).toBe(7);

    // ATT_W_APPLE (sent 3 whole days before its pass's first_confirmed_at) and ATT_W_GOOGLE
    // (bounced initial 10 days before, successful resend 5 days before - the resend must win) are
    // the only two contributors; every other wallet attendee either has no successful
    // ticket-email send or (ATT_W_NOT_INSTALLED) no first_confirmed_at at all, so computeTapDays
    // returns null for them and they're excluded from both the average and every bucket. A wrong
    // "purpose: initial"-only pick would use ATT_W_GOOGLE's bounced 10-day gap instead, landing
    // it in "8_plus" and shifting the average to 6.5.
    expect(body.time_to_wallet_tap.average_days).toBe(4);
    const bucket13 = body.time_to_wallet_tap.buckets.find((b) => b.key === "1_3");
    expect(bucket13!.count).toBe(1);
    expect(bucket13!.pct).toBe(50);
    const bucket47 = body.time_to_wallet_tap.buckets.find((b) => b.key === "4_7");
    expect(bucket47!.count).toBe(1);
    expect(bucket47!.pct).toBe(50);
    for (const key of ["same_day", "8_plus"]) {
      expect(body.time_to_wallet_tap.buckets.find((b) => b.key === key)!.count).toBe(0);
    }

    expect(body.admission_by_wallet.with_wallet).toEqual({ total: 5, admitted: 3, pct: 60 });
    expect(body.admission_by_wallet.without_wallet.total).toBe(3);
    expect(body.admission_by_wallet.without_wallet.admitted).toBe(2);
  });
});

describe("GET /api/admin/events/:eventId/reports/custom-fields", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CUSTOM_FIELDS}/reports/custom-fields`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for operator (staff admin gate)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_REP}/reports/custom-fields`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin without event org access", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CUSTOM_FIELDS}/reports/custom-fields`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns an empty fields array for an event with no custom fields configured", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/reports/custom-fields`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total_attendees: number; fields: unknown[] };
    expect(body.total_attendees).toBe(0);
    expect(body.fields).toEqual([]);
  });

  it("charts select/boolean fields as a distribution with a not-answered bucket, and text fields as a fill-rate stat only", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CUSTOM_FIELDS}/reports/custom-fields`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as EventCustomFieldReportsResponse;

    expect(body.total_attendees).toBe(5);
    // Registry order (created_at asc), same order the Requirements page's own field list uses.
    expect(body.fields.map((f) => f.source_field)).toEqual([
      "dietary",
      "shirt_size",
      "vegetarian",
      "newsletter_optin",
    ]);

    const dietary = body.fields.find((f) => f.source_field === "dietary")!;
    expect(dietary.type).toBe("text");
    expect(dietary.description).toBe("Let us know about any allergies or dietary preferences.");
    expect(dietary.distribution).toBeNull();
    // ATT_CF_1, ATT_CF_2, ATT_CF_5 answered; ATT_CF_3/4 did not.
    expect(dietary.response_rate).toEqual({ answered: 3, pct: 60 });

    const shirtSize = body.fields.find((f) => f.source_field === "shirt_size")!;
    expect(shirtSize.type).toBe("select");
    // No description set on this field - passed through as-is (null), not a server-side fallback.
    expect(shirtSize.description).toBeNull();
    expect(shirtSize.response_rate).toBeNull();
    // Real values sorted by count descending, "not answered" always trailing regardless of its
    // own count (it's a fallback bucket, not a real answer competing for rank).
    expect(shirtSize.distribution).toEqual([
      { key: "M", label: "M", count: 2, pct: 40 },
      { key: "L", label: "L", count: 1, pct: 20 },
      { key: "__not_answered__", label: "Not answered", count: 2, pct: 40 },
    ]);

    const vegetarian = body.fields.find((f) => f.source_field === "vegetarian")!;
    expect(vegetarian.type).toBe("boolean");
    expect(vegetarian.response_rate).toBeNull();
    expect(vegetarian.distribution).toEqual([
      { key: "true", label: "Yes", count: 2, pct: 40 },
      { key: "false", label: "No", count: 1, pct: 20 },
      { key: "__not_answered__", label: "Not answered", count: 2, pct: 40 },
    ]);
  });

  it("omits the not-answered bucket entirely once every attendee has answered a field", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CUSTOM_FIELDS}/reports/custom-fields`, {
      headers: { Cookie: adminCookie },
    });
    const body = (await res.json()) as EventCustomFieldReportsResponse;
    const newsletter = body.fields.find((f) => f.source_field === "newsletter_optin")!;
    expect(newsletter.distribution).toEqual([
      { key: "true", label: "Yes", count: 3, pct: 60 },
      { key: "false", label: "No", count: 2, pct: 40 },
    ]);
  });

  it("breaks a tied count deterministically by value, not by GROUP BY's unordered row order", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_CUSTOM_FIELDS_TIE}/reports/custom-fields`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventCustomFieldReportsResponse;
    const tieField = body.fields.find((f) => f.source_field === "tie_field")!;
    // Both values have count 1 - without a tie-breaker this could come back as either order.
    expect(tieField.distribution).toEqual([
      { key: "A", label: "A", count: 1, pct: 50 },
      { key: "B", label: "B", count: 1, pct: 50 },
    ]);
  });
});

describe("GET /api/admin/events/:eventId/reports/export?report=wallets", () => {
  it("returns 403 for admin without event org access", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_WALLETS}/reports/export?format=csv&report=wallets`, {
      headers: { Cookie: adminBCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns a wallets CSV with one row per attendee, including those with no pass", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_WALLETS}/reports/export?format=csv&report=wallets`, {
      headers: { Cookie: adminWalletsCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain('filename="wallets-reports-wallets-');
    expect(res.headers.get("X-Wallets-Export-Total")).toBe("8");
    expect(res.headers.get("X-Wallets-Export-Truncated")).toBe("false");

    const text = await res.text();
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toContain('"Confirmed platform"');
    // rows are ordered by name asc: "Wallets Apple" sorts first among the 8 seeded names.
    const appleRow = lines.find((l) => l.includes('"Wallets Apple"'));
    expect(appleRow).toContain('"Apple"');
    const bothRow = lines.find((l) => l.includes('"Wallets Both"'));
    expect(bothRow).toContain('"Both"');
    const nopassRow = lines.find((l) => l.includes('"Wallets No Pass"'));
    expect(nopassRow).toContain('"No pass"');
    // ATT_W_NOT_INSTALLED's wallet_pass has no registration_checked_at (never synced) - the
    // active/inactive counts and confirmed-platform columns must stay blank, not export the
    // unknown state as an affirmative 0/"None" (bot review: that would misrepresent "never
    // synced" as "confirmed not installed" in an archive meant for later recomputation).
    const notInstalledRow = lines.find((l) => l.includes('"Wallets Not Installed"'));
    expect(notInstalledRow).toBeDefined();
    const cells = notInstalledRow!.split(",").map((c) => c.replace(/^"|"$/g, ""));
    expect(cells.slice(5, 10)).toEqual(["", "", "", "", ""]);
  });

  it("returns printable HTML for a wallets pdf export", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_WALLETS}/reports/export?format=pdf&report=wallets`, {
      headers: { Cookie: adminWalletsCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Wallets Reports Event");
    // synced_at is set (ATT_W_BOTH's registration_checked_at, the most recent) - the meta line
    // should surface it, not silently omit sync freshness the way a bare "Generated" timestamp
    // would (bot review: a shared PDF can otherwise misleadingly look current).
    expect(html).toContain("Synced ");
    expect(html).not.toContain("Not synced yet");
    // ATT_W_APPLE and ATT_W_GOOGLE both contribute a tap-day sample (see the GET aggregate
    // test's time_to_wallet_tap assertions above), so average_days isn't null here - the bucket
    // rows should render, not the buckets-always-populated dead-code fallback text.
    expect(html).toContain("1-3 days");
    expect(html).not.toContain("Not enough data yet");
    // registrations_per_attendee.buckets isn't all-zero (adoption.confirmed=5 above), so the
    // "Devices per attendee" table's real rows should render, not its own empty fallback.
    expect(html).toContain("Devices per attendee");
    expect(html).toContain("1 device");
    expect(html).not.toContain("No wallet passes installed yet");
    // EVENT_WALLETS has 8 seeded passes, nowhere near WALLET_AGGREGATE_MAX - the partial-sample
    // warning must stay absent (the passes_truncated: true path itself would need 50,001+ seeded
    // passes to exercise directly, impractical for an integration test; this only guards the
    // false-path regression).
    expect(html).not.toContain("partial sample");
  });

  it("shows every empty/not-synced state in the wallets pdf for an event with no attendees", async () => {
    // adminWalletsCookie, not adminCookie - see the identical comment on the "invalid report"
    // test above (separate admin:export rate-limit bucket; adminCookie's is exhausted by the
    // many other /reports/export calls throughout this describe block).
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/reports/export?format=pdf&report=wallets`, {
      headers: { Cookie: adminWalletsCookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    // EVENT_EMPTY has zero attendees, so got_pass, by_ticket_type, and average_days are all at
    // their empty/null defaults - exercises the fallback branch of every one of these three
    // buckets-or-list-always-populated ternaries at once, plus the never-synced meta line.
    expect(html).toContain("Not synced yet");
    expect(html).not.toContain("Synced ");
    expect(html).toContain("No wallet passes installed yet");
    expect(html).toContain("No attendees");
    expect(html).toContain("Not enough data yet");
  });

  it("audit: reports_exported records report=wallets, not the admissions default", async () => {
    await prisma.attendeeActionLog.deleteMany({
      where: { event_id: EVENT_WALLETS, action_type: "reports_exported" },
    });

    const res = await app.request(`/api/admin/events/${EVENT_WALLETS}/reports/export?format=csv&report=wallets`, {
      headers: { Cookie: adminWalletsCookie },
    });
    expect(res.status).toBe(200);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_WALLETS, action_type: "reports_exported" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as Record<string, unknown>;
    expect(meta.report).toBe("wallets");
    expect(meta.format).toBe("csv");
    expect(meta.count).toBe(8);
  });
});
