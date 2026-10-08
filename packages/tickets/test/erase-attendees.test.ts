/**
 * eraseAttendees (GDPR "Erase personal data"): the row stays and keeps its numbers, everything
 * that identifies the person goes. Runs against a db-push database with the migration's own CHECK
 * constraint applied on top, so every erase below also proves the function writes exactly what the
 * constraint accepts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import {
  ERASED_ATTENDEE_NAME,
  eraseAttendees,
  erasedAttendeeEmail,
  isErasedPlaceholderEmail,
  type EraseAttendeesResult,
} from "../src/erase-attendees.js";
import { issueTicket, issueTicketsForEvent } from "../src/issue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");
const MIGRATION_SQL = path.join(
  DB_ROOT,
  "prisma/migrations/20261008120000_add_attendee_erased_at/migration.sql",
);

const ORG_ID = "org_erase";
const WARSAW_EVENT = "evt-erase-warsaw";
const KOLKATA_EVENT = "evt-erase-kolkata";
const ARCHIVED_EVENT = "evt-erase-archived";
const BASE_URL = "https://admitto.test";

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

  // db push builds from schema.prisma only; the CHECK constraint lives in the migration SQL.
  const constraint = /ALTER TABLE "Attendee" ADD CONSTRAINT[\s\S]*?\n\);/.exec(
    readFileSync(MIGRATION_SQL, "utf8"),
  );
  if (!constraint) throw new Error("erased_at CHECK constraint not found in the migration");
  await prisma.$executeRawUnsafe(constraint[0]);

  await prisma.organization.create({ data: { id: ORG_ID, name: "Erase Org", slug: "erase-org" } });
  const base = { organization_id: ORG_ID, date: new Date("2026-09-01T09:00:00Z") };
  await prisma.event.create({
    data: { id: WARSAW_EVENT, title: "Warsaw", slug: "erase-warsaw", timezone: "Europe/Warsaw", ...base },
  });
  await prisma.event.create({
    data: { id: KOLKATA_EVENT, title: "Kolkata", slug: "erase-kolkata", timezone: "Asia/Kolkata", ...base },
  });
  await prisma.event.create({
    data: {
      id: ARCHIVED_EVENT,
      title: "Archived",
      slug: "erase-archived",
      archived_at: new Date("2026-09-30T00:00:00Z"),
      ...base,
    },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function createAttendee(
  eventId: string,
  overrides: Partial<Prisma.AttendeeUncheckedCreateInput> = {},
) {
  const n = ++seq;
  return prisma.attendee.create({
    data: {
      id: `erase-att-${n}`,
      event_id: eventId,
      email: `person${n}@example.com`,
      name: `Person ${n}`,
      first_name: "Per",
      last_name: `Son ${n}`,
      company: "Acme",
      department: "Ops",
      custom_data: { diet: "vegan" },
      token_hash: `hash-${n}`,
      token_enc: `enc-${n}`,
      qr_payload: `qr-${n}`,
      external_uuid: `uuid-${n}`,
      public_ref: `ref-${n}`,
      ticket_type: null,
      status: "registered",
      rsvp_status: "accepted",
      ...overrides,
    },
  });
}

function erase(eventId: string, attendeeIds: string[]): Promise<EraseAttendeesResult> {
  return prisma.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds }));
}

const row = (id: string) => prisma.attendee.findUniqueOrThrow({ where: { id } });

describe("isErasedPlaceholderEmail", () => {
  it("matches the reserved domain whatever the case or padding, and nothing else", () => {
    expect(isErasedPlaceholderEmail(erasedAttendeeEmail("abc"))).toBe(true);
    expect(isErasedPlaceholderEmail("  Someone@ERASED.invalid ")).toBe(true);
    expect(isErasedPlaceholderEmail("someone@example.com")).toBe(false);
    expect(isErasedPlaceholderEmail("someone@mail.erased.invalid.example.com")).toBe(false);
  });
});

describe("eraseAttendees: the attendee row", () => {
  it("replaces name and email and clears every identifier, credential and answer", async () => {
    const a = await createAttendee(WARSAW_EVENT, { ticket_type: null });
    const result = await erase(WARSAW_EVENT, [a.id]);

    expect(result.erasedIds).toEqual([a.id]);
    const after = await row(a.id);
    expect(after).toMatchObject({
      name: ERASED_ATTENDEE_NAME,
      email: erasedAttendeeEmail(a.id),
      first_name: null,
      last_name: null,
      company: null,
      department: null,
      custom_data: null,
      token_hash: null,
      token_enc: null,
      qr_payload: null,
      external_uuid: null,
      public_ref: null,
    });
    expect(after.erased_at).toBeInstanceOf(Date);
    expect(after.email_bounce_dismissed_at).toBeInstanceOf(Date);
    // What Reports read stays.
    expect(after).toMatchObject({ id: a.id, event_id: WARSAW_EVENT, rsvp_status: "accepted", created_at: a.created_at });
  });

  it("dismisses the bounce notice even when an earlier bounce was dismissed before", async () => {
    const earlier = new Date("2026-08-01T10:00:00Z");
    const a = await createAttendee(WARSAW_EVENT, { email_bounce_dismissed_at: earlier });
    await erase(WARSAW_EVENT, [a.id]);
    expect((await row(a.id)).email_bounce_dismissed_at!.getTime()).toBeGreaterThan(earlier.getTime());
  });

  it("cancels a person who is not admitted yet on a live event, so the place is free", async () => {
    const registered = await createAttendee(WARSAW_EVENT, { status: "registered" });
    const confirmed = await createAttendee(WARSAW_EVENT, { status: "confirmed" });
    await erase(WARSAW_EVENT, [registered.id, confirmed.id]);
    expect((await row(registered.id)).status).toBe("cancelled");
    expect((await row(confirmed.id)).status).toBe("cancelled");
  });

  it("keeps the status of an admitted person: their numbers are final", async () => {
    const a = await createAttendee(WARSAW_EVENT, {
      status: "registered",
      admitted_at: new Date("2026-09-01T10:47:12.345Z"),
      admitted_by: "staff-1",
    });
    await erase(WARSAW_EVENT, [a.id]);
    const after = await row(a.id);
    expect(after.status).toBe("registered");
    expect(after.admitted_by).toBe("staff-1");
  });

  it("keeps cancelled and revoked as they were", async () => {
    const cancelled = await createAttendee(WARSAW_EVENT, { status: "cancelled" });
    const revoked = await createAttendee(WARSAW_EVENT, { status: "revoked" });
    await erase(WARSAW_EVENT, [cancelled.id, revoked.id]);
    expect((await row(cancelled.id)).status).toBe("cancelled");
    expect((await row(revoked.id)).status).toBe("revoked");
  });

  it("keeps the status on an archived event: its numbers are final, but data is still erased", async () => {
    const a = await createAttendee(ARCHIVED_EVENT, { status: "registered" });
    await erase(ARCHIVED_EVENT, [a.id]);
    const after = await row(a.id);
    expect(after.status).toBe("registered");
    expect(after.name).toBe(ERASED_ATTENDEE_NAME);
    expect(after.erased_at).not.toBeNull();
  });
});

describe("eraseAttendees: admission time is cut to the hour in the event timezone", () => {
  const cases: [string, string, string, string][] = [
    ["a whole-hour offset", WARSAW_EVENT, "2026-09-01T10:47:12.345Z", "2026-09-01T10:00:00.000Z"],
    ["a half-hour offset", KOLKATA_EVENT, "2026-09-01T10:47:12.345Z", "2026-09-01T10:30:00.000Z"],
    ["the first pass of the repeated hour", WARSAW_EVENT, "2026-10-25T00:30:00.000Z", "2026-10-25T00:00:00.000Z"],
    ["the second pass of the repeated hour", WARSAW_EVENT, "2026-10-25T01:30:00.000Z", "2026-10-25T01:00:00.000Z"],
  ];

  it.each(cases)("%s", async (_label, eventId, admittedAt, expected) => {
    const a = await createAttendee(eventId, { admitted_at: new Date(admittedAt) });
    const check = await prisma.checkIn.create({
      data: { attendee_id: a.id, event_id: eventId, checked_in_at: new Date(admittedAt), created_at: new Date(admittedAt) },
    });
    await erase(eventId, [a.id]);
    expect((await row(a.id)).admitted_at?.toISOString()).toBe(expected);
    const checkAfter = await prisma.checkIn.findUniqueOrThrow({ where: { id: check.id } });
    expect(checkAfter.checked_in_at.toISOString()).toBe(expected);
    expect(checkAfter.created_at.toISOString()).toBe(expected);
  });

  it("leaves the hourly admissions chart unchanged", async () => {
    const times = [
      "2026-09-01T08:05:00.000Z",
      "2026-09-01T08:59:59.999Z",
      "2026-09-01T09:00:00.000Z",
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T01:30:00.000Z",
    ];
    const ids: string[] = [];
    for (const time of times) ids.push((await createAttendee(WARSAW_EVENT, { admitted_at: new Date(time) })).id);

    // The same bucketing the Reports and Overview hourly charts use.
    const buckets = async () =>
      prisma.$queryRaw<{ id: string; hour: string }[]>`
        SELECT "id", TO_CHAR(DATE_TRUNC('hour', ("admitted_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Warsaw'), 'YYYY-MM-DD HH24:00') AS hour
        FROM "Attendee" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id"
      `;
    const before = await buckets();
    await erase(WARSAW_EVENT, ids);
    expect(await buckets()).toEqual(before);
  });
});

describe("eraseAttendees: what hangs off the attendee", () => {
  it("deletes notes and the activity log, only for the erased attendee", async () => {
    const a = await createAttendee(WARSAW_EVENT);
    const other = await createAttendee(WARSAW_EVENT);
    for (const attendee of [a, other]) {
      await prisma.attendeeNote.create({
        data: { attendee_id: attendee.id, event_id: WARSAW_EVENT, author_user_id: "staff-1", body: "allergic to nuts" },
      });
      await prisma.attendeeActionLog.create({
        data: {
          event_id: WARSAW_EVENT,
          attendee_id: attendee.id,
          action_type: "attendee_edited",
          metadata: { field_changes: { email: { from: "old@example.com", to: "new@example.com" } } },
        },
      });
    }
    const eventLevel = await prisma.attendeeActionLog.create({
      data: { event_id: WARSAW_EVENT, action_type: "attendees_exported", metadata: { count: 3 } },
    });

    const result = await erase(WARSAW_EVENT, [a.id]);

    expect(result.counts).toMatchObject({ notes: 1, actionLogs: 1 });
    expect(await prisma.attendeeNote.count({ where: { attendee_id: a.id } })).toBe(0);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: a.id } })).toBe(0);
    expect(await prisma.attendeeNote.count({ where: { attendee_id: other.id } })).toBe(1);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: other.id } })).toBe(1);
    expect(await prisma.attendeeActionLog.findUnique({ where: { id: eventLevel.id } })).not.toBeNull();
  });

  it("keeps check-ins and item states, clears check-in notes", async () => {
    const a = await createAttendee(WARSAW_EVENT, { admitted_at: new Date("2026-09-01T10:15:00Z") });
    const item = await prisma.eventItem.create({
      data: { event_id: WARSAW_EVENT, key: `badge-${a.id}`, label: "Badge" },
    });
    await prisma.attendeeItemState.create({
      data: { attendee_id: a.id, event_item_id: item.id, state: "given", updated_by: "staff-1" },
    });
    await prisma.checkIn.create({
      data: {
        attendee_id: a.id,
        event_id: WARSAW_EVENT,
        status: "VALID",
        checked_in_by: "staff-1",
        device_id: "Gate A",
        session_id: "session-1",
        notes: "came with a wheelchair",
      },
    });

    const result = await erase(WARSAW_EVENT, [a.id]);

    expect(result.counts.checkIns).toBe(1);
    const checkIn = await prisma.checkIn.findFirstOrThrow({ where: { attendee_id: a.id } });
    expect(checkIn).toMatchObject({
      notes: null,
      status: "VALID",
      checked_in_by: "staff-1",
      device_id: "Gate A",
      session_id: "session-1",
    });
    const state = await prisma.attendeeItemState.findFirstOrThrow({ where: { attendee_id: a.id } });
    expect(state.state).toBe("given");
  });

  describe("email deliveries", () => {
    const delivery = (attendeeId: string, extra: Partial<Prisma.EmailDeliveryUncheckedCreateInput>) =>
      prisma.emailDelivery.create({
        data: {
          organization_id: ORG_ID,
          event_id: WARSAW_EVENT,
          attendee_id: attendeeId,
          provider: "smtp",
          recipient_email: "person@example.com",
          rendered_subject: "Your ticket, Person",
          rendered_html: "<p>Hi Person, your link: https://x/t/secret</p>",
          provider_message_id: "msg-1",
          error: "550 person@example.com does not exist",
          error_code: "mailbox_unavailable",
          ...extra,
        },
      });

    it("cancels mail that was still waiting and empties every row", async () => {
      const a = await createAttendee(WARSAW_EVENT);
      const queued = await delivery(a.id, { status: "queued" });
      const retryable = await delivery(a.id, { status: "failed", retryable: true });
      const permanent = await delivery(a.id, { status: "failed", retryable: false });
      const sent = await delivery(a.id, { status: "sent", sent_at: new Date("2026-08-30T10:00:00Z") });

      const result = await erase(WARSAW_EVENT, [a.id]);

      expect(result.counts.emailDeliveries).toBe(4);
      const after = new Map(
        (await prisma.emailDelivery.findMany({ where: { attendee_id: a.id } })).map((d) => [d.id, d]),
      );
      expect(after.get(queued.id)).toMatchObject({ status: "cancelled", retryable: false });
      // A failed row the worker would still retry is cancelled too: the worker re-reads the status
      // right before it sends, so a retry already in flight is skipped.
      expect(after.get(retryable.id)).toMatchObject({ status: "cancelled", retryable: false });
      expect(after.get(permanent.id)?.status).toBe("failed");
      expect(after.get(sent.id)?.status).toBe("sent");
      for (const d of after.values()) {
        expect(d).toMatchObject({
          recipient_email: null,
          rendered_subject: null,
          rendered_html: null,
          provider_message_id: null,
          error: null,
          error_code: "mailbox_unavailable",
        });
      }
      expect(after.get(sent.id)?.sent_at?.toISOString()).toBe("2026-08-30T10:00:00.000Z");
    });

    it("leaves other attendees' mail alone", async () => {
      const a = await createAttendee(WARSAW_EVENT);
      const other = await createAttendee(WARSAW_EVENT);
      const mine = await delivery(other.id, { status: "queued" });
      await erase(WARSAW_EVENT, [a.id]);
      const untouched = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: mine.id } });
      expect(untouched).toMatchObject({ status: "queued", recipient_email: "person@example.com" });
    });
  });

  describe("wallet pass", () => {
    const pass = (attendeeId: string, extra: Partial<Prisma.WalletPassUncheckedCreateInput> = {}) =>
      prisma.walletPass.create({
        data: {
          attendee_id: attendeeId,
          provider_pass_id: `provider-${attendeeId}`,
          user_provided_id: `user-${attendeeId}`,
          status: "active",
          download_url: "https://p/download",
          apple_url: "https://p/apple",
          android_url: "https://p/android",
          samsung_url: "https://p/samsung",
          user_agent: "Mozilla/5.0 (iPhone)",
          user_agent_captured_at: new Date(),
          pass_type_id: "pass.type",
          serial_number: "serial",
          auth_token: "auth",
          pass_url: "https://p/pass",
          apple_active_registrations: 1,
          first_confirmed_at: new Date("2026-08-31T10:00:00Z"),
          ...extra,
        },
      });

    it("clears every link and device, keeps the provider ids and the history, and lists the pass to delete", async () => {
      const a = await createAttendee(WARSAW_EVENT);
      await pass(a.id);

      const result = await erase(WARSAW_EVENT, [a.id]);

      expect(result.counts.walletPasses).toBe(1);
      expect(result.walletTargets).toEqual([{ attendeeId: a.id, providerPassId: `provider-${a.id}` }]);
      const after = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: a.id } });
      expect(after).toMatchObject({
        download_url: null,
        apple_url: null,
        android_url: null,
        samsung_url: null,
        user_agent: null,
        user_agent_captured_at: null,
        pass_type_id: null,
        serial_number: null,
        auth_token: null,
        pass_url: null,
        provider_pass_id: `provider-${a.id}`,
        user_provided_id: `user-${a.id}`,
        status: "active",
        apple_active_registrations: 1,
      });
      expect(after.first_confirmed_at).not.toBeNull();
    });

    it("does not list a pass that is already gone at the provider, or an attendee without one", async () => {
      const removed = await createAttendee(WARSAW_EVENT);
      await pass(removed.id, { provider_removed_at: new Date() });
      const none = await createAttendee(WARSAW_EVENT);
      const result = await erase(WARSAW_EVENT, [removed.id, none.id]);
      expect(result.walletTargets).toEqual([]);
      expect(result.counts.walletPasses).toBe(1);
    });
  });

  it("removes the name and email from the creation entry of the central audit log, nothing else", async () => {
    const a = await createAttendee(WARSAW_EVENT);
    const other = await createAttendee(WARSAW_EVENT);
    const entry = (attendee: { id: string }) =>
      prisma.adminAuditLog.create({
        data: {
          organization_id: ORG_ID,
          actor_user_id: "staff-1",
          action_type: "attendee_created_manual",
          metadata: {
            event_id: WARSAW_EVENT,
            event_title: "Warsaw",
            attendee_id: attendee.id,
            attendee_name: "Person",
            attendee_email: "person@example.com",
          },
        },
      });
    const mine = await entry(a);
    const theirs = await entry(other);

    const result = await erase(WARSAW_EVENT, [a.id]);

    expect(result.erasedIds).toEqual([a.id]);
    const minePatched = await prisma.adminAuditLog.findUniqueOrThrow({ where: { id: mine.id } });
    expect(minePatched.metadata).toEqual({ event_id: WARSAW_EVENT, event_title: "Warsaw", attendee_id: a.id });
    const theirsKept = await prisma.adminAuditLog.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(theirsKept.metadata).toMatchObject({ attendee_email: "person@example.com" });
  });
});

describe("eraseAttendees: which attendees it touches", () => {
  it("sorts a mixed list into erased, already erased and not found", async () => {
    const fresh = await createAttendee(WARSAW_EVENT);
    const done = await createAttendee(WARSAW_EVENT);
    await erase(WARSAW_EVENT, [done.id]);
    const doneAt = (await row(done.id)).erased_at;

    const result = await erase(WARSAW_EVENT, [fresh.id, done.id, "nobody", fresh.id]);

    expect(result.erasedIds).toEqual([fresh.id]);
    expect(result.alreadyErasedIds).toEqual([done.id]);
    expect(result.notFoundIds).toEqual(["nobody"]);
    expect((await row(done.id)).erased_at).toEqual(doneAt);
  });

  it("does nothing the second time", async () => {
    const a = await createAttendee(WARSAW_EVENT);
    await prisma.attendeeNote.create({
      data: { attendee_id: a.id, event_id: WARSAW_EVENT, author_user_id: "staff-1", body: "note" },
    });
    await erase(WARSAW_EVENT, [a.id]);
    const again = await erase(WARSAW_EVENT, [a.id]);
    expect(again).toMatchObject({
      erasedIds: [],
      alreadyErasedIds: [a.id],
      notFoundIds: [],
      counts: { notes: 0, actionLogs: 0, emailDeliveries: 0, checkIns: 0, walletPasses: 0 },
      walletTargets: [],
    });
  });

  it("ignores an attendee of another event", async () => {
    const elsewhere = await createAttendee(KOLKATA_EVENT);
    const result = await erase(WARSAW_EVENT, [elsewhere.id]);
    expect(result).toMatchObject({ erasedIds: [], notFoundIds: [elsewhere.id] });
    expect((await row(elsewhere.id)).erased_at).toBeNull();
  });

  it("handles an empty list and an unknown event", async () => {
    expect(await erase(WARSAW_EVENT, [])).toMatchObject({ erasedIds: [], notFoundIds: [] });
    const a = await createAttendee(WARSAW_EVENT);
    expect(await erase("no-such-event", [a.id])).toMatchObject({ erasedIds: [], notFoundIds: [a.id] });
    expect((await row(a.id)).erased_at).toBeNull();
  });

  it("erases each attendee exactly once when two requests overlap", async () => {
    const ids = [(await createAttendee(WARSAW_EVENT)).id, (await createAttendee(WARSAW_EVENT)).id, (await createAttendee(WARSAW_EVENT)).id];
    const [first, second] = await Promise.all([erase(WARSAW_EVENT, ids), erase(WARSAW_EVENT, [...ids].reverse())]);
    expect([...first.erasedIds, ...second.erasedIds].sort()).toEqual([...ids].sort());
    expect(first.erasedIds.length === 0 || second.erasedIds.length === 0).toBe(true);
  });
});

describe("an erased attendee never gets a ticket again", () => {
  it("issueTicket refuses, and mints no token", async () => {
    const a = await createAttendee(ARCHIVED_EVENT, { token_hash: null, token_enc: null, qr_payload: null, external_uuid: null });
    await erase(ARCHIVED_EVENT, [a.id]);

    const result = await issueTicket(a.id, prisma, BASE_URL);

    expect(result).toEqual({ status: "not_issuable", mode: "internal", attendeeId: a.id, reason: "erased" });
    expect((await row(a.id)).token_hash).toBeNull();
  });

  it("issueTicketsForEvent skips erased attendees and still issues the others", async () => {
    const event = await prisma.event.create({
      data: { id: "evt-erase-issue", title: "Issue", slug: "erase-issue", organization_id: ORG_ID, date: new Date("2026-09-01T09:00:00Z") },
    });
    const plain = { token_hash: null, token_enc: null, qr_payload: null, external_uuid: null, public_ref: null };
    const erased = await createAttendee(event.id, plain);
    const live = await createAttendee(event.id, plain);
    await erase(event.id, [erased.id]);

    const summary = await issueTicketsForEvent(event.id, prisma, BASE_URL);

    expect(summary).toMatchObject({ issued: 1, notIssuable: 1 });
    expect(summary.results.find((r) => r.attendeeId === erased.id)).toMatchObject({ status: "not_issuable", reason: "erased" });
    expect((await row(erased.id)).token_hash).toBeNull();
    expect((await row(live.id)).token_hash).not.toBeNull();
  });

  it("an issue that starts while the erasure is still open waits for it, then finds the row erased", async () => {
    const a = await createAttendee(ARCHIVED_EVENT, { token_hash: null, token_enc: null, qr_payload: null, external_uuid: null });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let rowsErased!: () => void;
    const erasedInsideTransaction = new Promise<void>((resolve) => (rowsErased = resolve));
    const erasing = prisma.$transaction(async (tx) => {
      await eraseAttendees(tx, { eventId: ARCHIVED_EVENT, attendeeIds: [a.id] });
      rowsErased();
      await gate;
    });
    await erasedInsideTransaction;

    // The erasure has written but not committed: issueTicket still reads the old row, and its
    // write has to wait for the lock instead of minting a token for a person being erased.
    let settled = false;
    const issuing = issueTicket(a.id, prisma, BASE_URL).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);

    release();
    await erasing;
    expect(await issuing).toMatchObject({ status: "not_issuable", reason: "erased" });
    expect((await row(a.id)).token_hash).toBeNull();
  });

  it("the compare-and-set itself refuses when the erasure lands after the first read", async () => {
    const a = await createAttendee(ARCHIVED_EVENT, { token_hash: null, token_enc: null, qr_payload: null, external_uuid: null });
    const before = await row(a.id);
    await erase(ARCHIVED_EVENT, [a.id]);

    // issueTicket's own first read sees the row as it was before the erasure; the write must then
    // fail on its own, not rely on that read. Every later read is real.
    const spy = vi.spyOn(prisma.attendee, "findUnique").mockResolvedValueOnce(before as never);
    try {
      const result = await issueTicket(a.id, prisma, BASE_URL);
      expect(result).toMatchObject({ status: "not_issuable", reason: "erased" });
    } finally {
      spy.mockRestore();
    }
    expect((await row(a.id)).token_hash).toBeNull();
  });
});
