/**
 * removeAttendees (Remove from event, the hard delete for mistakes): the row goes with everything
 * that hangs off it, and the copies of the identity that live elsewhere are scrubbed. The audit
 * entry is the caller's job and is tested with the route.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { collectAttendeeAddresses, scrubAttendeeTraces } from "../src/attendee-traces.js";
import { eraseAttendees } from "../src/erase-attendees.js";
import { removeAttendees } from "../src/remove-attendees.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");
const ORG_ID = "org_remove";
const EVENT_ID = "evt-remove";
const OTHER_EVENT_ID = "evt-remove-other";

let prisma: PrismaClient;
let seq = 0;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
  await prisma.organization.create({ data: { id: ORG_ID, name: "Remove", slug: "remove-org" } });
  for (const id of [EVENT_ID, OTHER_EVENT_ID]) {
    await prisma.event.create({
      data: { id, title: id, slug: id, organization_id: ORG_ID, date: new Date("2026-09-01T09:00:00Z") },
    });
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function createAttendee(eventId = EVENT_ID, email?: string) {
  const n = ++seq;
  return prisma.attendee.create({
    data: { id: `remove-att-${n}`, event_id: eventId, email: email ?? `person${n}@example.com`, name: `Person ${n}` },
  });
}

const remove = (attendeeIds: string[], eventId = EVENT_ID) =>
  prisma.$transaction((tx) => removeAttendees(tx, { eventId, attendeeIds }));

const delivery = (attendeeId: string, extra: Record<string, unknown> = {}) =>
  prisma.emailDelivery.create({
    data: {
      organization_id: ORG_ID,
      event_id: EVENT_ID,
      attendee_id: attendeeId,
      purpose: "initial",
      provider: "smtp",
      status: "sent",
      recipient_email: "someone@example.com",
      rendered_subject: "Your ticket",
      rendered_html: "<p>ticket</p>",
      ...extra,
    },
  });

describe("removeAttendees", () => {
  it("deletes the attendee with its deliveries, wallet pass, check-ins, notes and activity log, and counts them", async () => {
    const a = await createAttendee();
    const keep = await createAttendee();
    for (const id of [a.id, keep.id]) {
      await delivery(id);
      await prisma.walletPass.create({ data: { attendee_id: id, status: "active" } });
      await prisma.checkIn.create({ data: { attendee_id: id, event_id: EVENT_ID, status: "VALID" } });
      await prisma.attendeeNote.create({ data: { attendee_id: id, event_id: EVENT_ID, author_user_id: "staff-1", body: "note" } });
      await prisma.attendeeActionLog.create({ data: { event_id: EVENT_ID, attendee_id: id, action_type: "attendee_edited" } });
    }

    const result = await remove([a.id]);

    expect(result).toMatchObject({
      removedIds: [a.id],
      notFoundIds: [],
      counts: { emailDeliveries: 1, walletPasses: 1, checkIns: 1 },
    });
    expect(await prisma.attendee.findUnique({ where: { id: a.id } })).toBeNull();
    for (const table of [prisma.emailDelivery, prisma.walletPass, prisma.checkIn, prisma.attendeeNote, prisma.attendeeActionLog] as const) {
      expect(await (table as typeof prisma.emailDelivery).count({ where: { attendee_id: a.id } })).toBe(0);
    }
    // Somebody else's rows are not touched.
    expect(await prisma.attendee.findUnique({ where: { id: keep.id } })).not.toBeNull();
    expect(await prisma.emailDelivery.count({ where: { attendee_id: keep.id } })).toBe(1);
    expect(await prisma.attendeeNote.count({ where: { attendee_id: keep.id } })).toBe(1);
  });

  it("answers not found for ids that are not attendees of the event, and leaves those attendees alone", async () => {
    const mine = await createAttendee();
    const elsewhere = await createAttendee(OTHER_EVENT_ID);

    const result = await remove([mine.id, elsewhere.id, "nobody", mine.id]);

    expect(result.removedIds).toEqual([mine.id]);
    expect(result.notFoundIds.sort()).toEqual([elsewhere.id, "nobody"].sort());
    expect(await prisma.attendee.findUnique({ where: { id: elsewhere.id } })).not.toBeNull();
  });

  it("answers nothing removed for an empty list and for ids that match nobody", async () => {
    expect(await remove([])).toEqual({
      removedIds: [],
      notFoundIds: [],
      counts: { emailDeliveries: 0, walletPasses: 0, checkIns: 0 },
      previousEmails: [],
    });
    expect(await remove(["nobody-1", "nobody-2"])).toMatchObject({ removedIds: [], notFoundIds: ["nobody-1", "nobody-2"] });
  });

  it("returns the addresses lower-cased and trimmed, and none for an attendee who was erased before", async () => {
    const a = await createAttendee(EVENT_ID, "  Mixed.Case@Example.com ");
    const erased = await createAttendee();
    await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: [erased.id] }));

    const result = await remove([a.id, erased.id]);

    expect(result.removedIds.sort()).toEqual([a.id, erased.id].sort());
    expect(result.previousEmails).toEqual(["mixed.case@example.com"]);
    expect(await prisma.attendee.findUnique({ where: { id: erased.id } })).toBeNull();
  });

  it("scrubs the name and address from the creation entry of the central audit log, and keeps the entry", async () => {
    const a = await createAttendee();
    const entry = await prisma.adminAuditLog.create({
      data: {
        organization_id: ORG_ID,
        actor_user_id: "staff-1",
        action_type: "attendee_created_manual",
        metadata: { event_id: EVENT_ID, attendee_id: a.id, attendee_name: a.name, attendee_email: a.email },
      },
    });

    await remove([a.id]);

    const after = await prisma.adminAuditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.metadata).toEqual({ event_id: EVENT_ID, attendee_id: a.id });
  });

  it("blanks the address on another attendee's delivery (the resend override) and cancels it when it was waiting", async () => {
    const gone = await createAttendee(EVENT_ID, "gone.person@example.com");
    const other = await createAttendee();
    const waiting = await delivery(other.id, { status: "queued", recipient_email: "Gone.Person@example.com", provider_message_id: "m-1" });
    const sent = await delivery(other.id, { status: "sent", recipient_email: "gone.person@example.com" });
    const unrelated = await delivery(other.id, { status: "queued", recipient_email: "someone.else@example.com" });

    await remove([gone.id]);

    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({
      recipient_email: null,
      provider_message_id: null,
      status: "cancelled",
      retryable: false,
    });
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({ recipient_email: null, status: "sent" });
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: unrelated.id } })).toMatchObject({
      recipient_email: "someone.else@example.com",
      status: "queued",
    });
  });
});

describe("an address the person had before an edit", () => {
  it("is scrubbed too: only their first ticket mail still names it, and it goes with the person", async () => {
    const gone = await createAttendee(EVENT_ID, "right.address@example.com");
    const other = await createAttendee();
    await delivery(gone.id, { recipient_email: "Typo.Address@example.com" });
    const resent = await delivery(other.id, { purpose: "resend", status: "queued", recipient_email: "typo.address@example.com" });

    const result = await remove([gone.id]);

    expect([...result.previousEmails].sort((a, b) => a.localeCompare(b))).toEqual([
      "right.address@example.com",
      "typo.address@example.com",
    ]);
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: resent.id } })).toMatchObject({
      recipient_email: null,
      status: "cancelled",
    });
  });

  it("is left alone when another attendee holds it now, because the mail to it is theirs", async () => {
    const gone = await createAttendee();
    await createAttendee(EVENT_ID, "now.theirs@example.com");
    const other = await createAttendee();
    await delivery(gone.id, { recipient_email: "now.theirs@example.com" });
    const theirs = await delivery(other.id, { purpose: "resend", status: "queued", recipient_email: "now.theirs@example.com" });

    const result = await remove([gone.id]);

    expect(result.previousEmails).not.toContain("now.theirs@example.com");
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({
      recipient_email: "now.theirs@example.com",
      status: "queued",
    });
  });

  it("is left alone when the first mail of another attendee went to it too", async () => {
    const gone = await createAttendee();
    const other = await createAttendee();
    await delivery(gone.id, { recipient_email: "shared.before@example.com" });
    const theirs = await delivery(other.id, { status: "queued", recipient_email: "shared.before@example.com" });

    const result = await remove([gone.id]);

    expect(result.previousEmails).not.toContain("shared.before@example.com");
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({
      recipient_email: "shared.before@example.com",
      status: "queued",
    });
  });

  it("is not told by a resend: staff typed that address in, and it is not the person's", async () => {
    const gone = await createAttendee();
    const other = await createAttendee();
    await delivery(gone.id, { recipient_email: gone.email });
    await delivery(gone.id, { purpose: "resend", recipient_email: "manager.mailbox@example.com" });
    const theirs = await delivery(other.id, { purpose: "resend", status: "queued", recipient_email: "manager.mailbox@example.com" });

    const result = await remove([gone.id]);

    expect(result.previousEmails).toEqual([gone.email]);
    expect(await prisma.emailDelivery.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({
      recipient_email: "manager.mailbox@example.com",
      status: "queued",
    });
  });
});

describe("collectAttendeeAddresses", () => {
  const collect = (attendees: { id: string; email: string }[]) =>
    prisma.$transaction((tx) => collectAttendeeAddresses(tx, { eventId: EVENT_ID, attendees }));

  it("answers nothing for no attendees, and the current addresses, lower-cased and trimmed, for attendees without history", async () => {
    expect(await collect([])).toEqual([]);
    expect(
      await collect([
        { id: "remove-att-none-1", email: "  First@Example.com " },
        { id: "remove-att-none-2", email: "first@example.com" },
        { id: "remove-att-none-3", email: "   " },
      ]),
    ).toEqual(["first@example.com"]);
  });

  it("adds the address the attendee's first ticket mail went to, and neither a resend's nor another attendee's", async () => {
    const a = await createAttendee(EVENT_ID, "collect.now@example.com");
    const other = await createAttendee();
    await delivery(a.id, { recipient_email: "Collect.Before@example.com" });
    await delivery(a.id, { purpose: "resend", recipient_email: "collect.override@example.com", status: "failed", retryable: false });
    await delivery(a.id, { purpose: "resend", recipient_email: null, status: "cancelled", retryable: false });
    await delivery(other.id, { recipient_email: "collect.someone.elses@example.com" });

    const addresses = await collect([{ id: a.id, email: a.email }]);

    expect([...addresses].sort((x, y) => x.localeCompare(y))).toEqual(["collect.before@example.com", "collect.now@example.com"]);
  });
});

describe("scrubAttendeeTraces", () => {
  it("blanks the address on the deliveries of other attendees only, never on the attendee's own", async () => {
    const own = await createAttendee(EVENT_ID, "own.address@example.com");
    const other = await createAttendee();
    const ownDelivery = await delivery(own.id, { recipient_email: "own.address@example.com" });
    const otherDelivery = await delivery(other.id, { recipient_email: "own.address@example.com" });

    await prisma.$transaction((tx) =>
      scrubAttendeeTraces(tx, { eventId: EVENT_ID, attendeeIds: [own.id], emails: ["own.address@example.com"] }),
    );

    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: ownDelivery.id } })).recipient_email).toBe("own.address@example.com");
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: otherDelivery.id } })).recipient_email).toBeNull();
  });

  it("does nothing for no attendees, and does not touch deliveries when there is no address", async () => {
    const other = await createAttendee();
    const d = await delivery(other.id, { recipient_email: "keep@example.com" });

    await prisma.$transaction(async (tx) => {
      await scrubAttendeeTraces(tx, { eventId: EVENT_ID, attendeeIds: [], emails: ["keep@example.com"] });
      await scrubAttendeeTraces(tx, { eventId: EVENT_ID, attendeeIds: ["remove-att-gone"], emails: [] });
    });

    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: d.id } })).recipient_email).toBe("keep@example.com");
  });
});
