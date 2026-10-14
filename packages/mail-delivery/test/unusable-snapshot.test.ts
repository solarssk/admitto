import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { generateToken } from "@admitto/tickets";
import { drainPendingDeliveries, retryDelivery, sendTicketEmails } from "../src/index.js";
import { SNAPSHOT_UNUSABLE_ERROR } from "../src/snapshot-unusable.js";
import { resetDb } from "./resetDb.js";
import { seedOrgAndEvent } from "./seedOrgAndEvent.js";

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-mail-unusable-snapshot";
const BAD = "att-unusable-bad";
const GOOD = "att-unusable-good";
const TEST_ENV = { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" };
const NOOP_DEPS = { exportSink: () => undefined };
const OPTIONS = { eventId: EVENT_ID, baseUrl: "https://tickets.example.com" };
/** Saved before the stricter template check: a link placeholder in an unquoted attribute. */
const POISONED_HTML = "<a href={{ticket_url}}>Open ticket</a>";

beforeAll(async () => {
  await resetDb();
  await seedOrgAndEvent(prisma, {
    orgId: "org-unusable",
    orgName: "Unusable Snapshot Org",
    orgSlug: "unusable-snapshot-org",
    eventId: EVENT_ID,
    eventTitle: "Unusable Snapshot",
    eventSlug: "unusable-snapshot",
  });
  for (const [id, email] of [[BAD, "bad@example.com"], [GOOD, "good@example.com"]] as const) {
    await prisma.attendee.create({
      data: { id, event_id: EVENT_ID, email, name: id, public_ref: generateToken() },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
  await sendTicketEmails(EVENT_ID, { attendeeIds: [BAD, GOOD] }, prisma, TEST_ENV, NOOP_DEPS);
  await prisma.emailDelivery.updateMany({
    where: { event_id: EVENT_ID, attendee_id: BAD },
    data: { rendered_html: POISONED_HTML },
  });
});

const rowOf = (attendeeId: string) =>
  prisma.emailDelivery.findFirstOrThrow({ where: { event_id: EVENT_ID, attendee_id: attendeeId } });

describe("a stored snapshot the renderer refuses", () => {
  it("fails only its own row, for good, while the drain sends the rest and the next tick is clean", async () => {
    const attemptsBefore = (await rowOf(BAD)).attempts;
    const first = await drainPendingDeliveries(prisma, TEST_ENV, NOOP_DEPS, OPTIONS);
    expect(first).toMatchObject({ claimed: 2, sent: 1, failed: 1, skipped: 0 });

    const bad = await rowOf(BAD);
    expect(bad).toMatchObject({ status: "failed", retryable: false, error: SNAPSHOT_UNUSABLE_ERROR, attempts: attemptsBefore + 1 });
    expect((await rowOf(GOOD)).status).not.toBe("queued");

    const second = await drainPendingDeliveries(prisma, TEST_ENV, NOOP_DEPS, OPTIONS);
    expect(second).toMatchObject({ claimed: 0, sent: 0, failed: 0 });
  });

  it("clears a provider error code left by an earlier attempt when the drain rejects the snapshot", async () => {
    await prisma.emailDelivery.updateMany({
      where: { event_id: EVENT_ID, attendee_id: BAD },
      data: { status: "failed", retryable: true, attempts: 1, error_code: "smtp_connect", attempted_at: new Date(0) },
    });

    await drainPendingDeliveries(prisma, TEST_ENV, NOOP_DEPS, OPTIONS);

    expect(await rowOf(BAD)).toMatchObject({ status: "failed", retryable: false, error: SNAPSHOT_UNUSABLE_ERROR, error_code: null });
  });

  it("is answered by a retry without a thrown error and without another attempt later", async () => {
    await prisma.emailDelivery.updateMany({
      where: { event_id: EVENT_ID, attendee_id: BAD },
      data: { status: "failed", retryable: true, attempts: 1, error_code: "smtp_connect" },
    });
    const bad = await rowOf(BAD);

    const result = await retryDelivery(bad.id, prisma, TEST_ENV, NOOP_DEPS, { baseUrl: OPTIONS.baseUrl });

    expect(result).toEqual({ ok: false, reason: "snapshot_unusable" });
    expect(await rowOf(BAD)).toMatchObject({ status: "failed", retryable: false, error: SNAPSHOT_UNUSABLE_ERROR, error_code: null, attempts: 2 });
    expect(await retryDelivery(bad.id, prisma, TEST_ENV, NOOP_DEPS, { baseUrl: OPTIONS.baseUrl })).toEqual({
      ok: false,
      reason: "not_retryable",
    });
  });
});
