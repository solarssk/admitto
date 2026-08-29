/**
 * Deterministic seed data for the check-in E2E smoke test (Playwright).
 *
 * Creates exactly one org / event / attendee / operator account, keyed on fixed slugs and
 * emails so re-running this script against the same database is idempotent: the attendee's
 * admitted_at is reset to null every run, so the "not admitted -> admitted" transition the
 * test asserts is always reproducible, not just true the first time.
 *
 * Not wired into `npm run db:seed` (packages/db/prisma/seed.ts) — this is E2E-only fixture
 * data, run explicitly by playwright.config.ts's globalSetup against whatever DATABASE_URL
 * the E2E run points at (see apps/admin/README.md's "E2E (Playwright)" section for local setup).
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@admitto/db";
import { createUser, findUserByEmail } from "@admitto/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const E2E_ORG_SLUG = "e2e-checkin-org";
export const E2E_EVENT_SLUG = "e2e-checkin-smoke-event";
export const E2E_ATTENDEE_EMAIL = "e2e.attendee@example.com";
export const E2E_ATTENDEE_NAME = "Ada Lovelace";
export const E2E_OPERATOR_EMAIL = "e2e.operator@example.com";
// Local-only fixture password for a synthetic operator account in a disposable E2E database —
// never a real credential, never used outside this seed script and its matching Playwright spec.
export const E2E_OPERATOR_PASSWORD = "E2eCheckinSmoke!2026";

export interface SeedResult {
  organizationId: string;
  eventId: string;
  attendeeId: string;
  operatorUserId: string;
  attendeeName: string;
  attendeeEmail: string;
  operatorEmail: string;
  operatorPassword: string;
}

export async function seedCheckinE2eData(): Promise<SeedResult> {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("Refusing to run E2E seed data in production");
  }

  const org = await prisma.organization.upsert({
    where: { slug: E2E_ORG_SLUG },
    update: {},
    create: { name: "E2E Checkin Org", slug: E2E_ORG_SLUG },
  });

  const event = await prisma.event.upsert({
    where: { slug: E2E_EVENT_SLUG },
    update: { archived_at: null },
    create: {
      title: "E2E Checkin Smoke Event",
      slug: E2E_EVENT_SLUG,
      date: new Date("2026-09-01T10:00:00Z"),
      organization_id: org.id,
    },
  });

  const attendee = await prisma.attendee.upsert({
    where: { event_id_email: { event_id: event.id, email: E2E_ATTENDEE_EMAIL } },
    // Reset to "not admitted" on every run so the test's assertion (not admitted -> admitted)
    // is reproducible across repeated local/CI runs, not just the first one.
    update: { name: E2E_ATTENDEE_NAME, status: "confirmed", admitted_at: null, admitted_by: null },
    create: {
      event_id: event.id,
      email: E2E_ATTENDEE_EMAIL,
      name: E2E_ATTENDEE_NAME,
      status: "confirmed",
    },
  });

  // Clear any check-in history from a previous run so Reports/recent-scans stay clean too.
  await prisma.checkIn.deleteMany({ where: { attendee_id: attendee.id } });

  let operator = await findUserByEmail(prisma, E2E_OPERATOR_EMAIL);
  if (!operator) {
    operator = await createUser(prisma, {
      email: E2E_OPERATOR_EMAIL,
      password: E2E_OPERATOR_PASSWORD,
      displayName: "E2E Operator",
    });
  } else {
    // Keep the account usable across re-runs even if a prior run left it locked/deactivated.
    await prisma.user.update({
      where: { id: operator.id },
      data: { is_active: true, must_change_password: false, failed_login_streak: 0, failed_mfa_streak: 0 },
    });
  }

  const hasOperatorRole = await prisma.roleAssignment.findFirst({
    where: {
      user_id: operator.id,
      role: "operator",
      scope_type: "event",
      scope_id: event.id,
    },
  });
  if (!hasOperatorRole) {
    await prisma.roleAssignment.create({
      data: {
        user_id: operator.id,
        role: "operator",
        scope_type: "event",
        scope_id: event.id,
      },
    });
  }

  return {
    organizationId: org.id,
    eventId: event.id,
    attendeeId: attendee.id,
    operatorUserId: operator.id,
    attendeeName: E2E_ATTENDEE_NAME,
    attendeeEmail: E2E_ATTENDEE_EMAIL,
    operatorEmail: E2E_OPERATOR_EMAIL,
    operatorPassword: E2E_OPERATOR_PASSWORD,
  };
}

const SEED_OUTPUT_PATH = path.join(__dirname, ".auth", "seed-data.json");

/** Runs the seed and writes its result to disk, for Playwright's globalSetup to call. */
export async function seedAndPersist(): Promise<SeedResult> {
  const result = await seedCheckinE2eData();
  await mkdir(path.dirname(SEED_OUTPUT_PATH), { recursive: true });
  await writeFile(SEED_OUTPUT_PATH, JSON.stringify(result, null, 2));
  return result;
}

export async function readSeedData(): Promise<SeedResult> {
  const raw = await readFile(SEED_OUTPUT_PATH, "utf8");
  return JSON.parse(raw) as SeedResult;
}

// Allow running directly: `tsx apps/admin/e2e/seed.ts`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedAndPersist()
    .then((result) => {
      console.log(`Seeded E2E checkin fixtures — event ${result.eventId}, attendee ${result.attendeeId}`);
      return prisma.$disconnect();
    })
    .catch(async (err: unknown) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
