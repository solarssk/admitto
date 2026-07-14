/**
 * Danger Zone bulk revoke actions (Event Settings follow-up to #395/#396) —
 * `revokeAllCheckInsForEvent` / `revokeAllItemsForEvent`.
 *
 * The "tolerates a mid-batch race, keeps processing the rest" tests use the
 * same TOCTOU technique as checkin-toctou.test.ts: a real concurrent race
 * between this function's own initial scan and its per-attendee processing
 * turn can't be reproduced by two real concurrent calls with any timing
 * guarantee, so we make the DB already reflect the "post-race" state and
 * force the function's *own* initial scan to see a stale (pre-race)
 * snapshot via a one-shot spy. Every later read inside the per-attendee
 * transaction is real and unmocked, so it observes the true, already-raced
 * state — exactly like a genuine concurrent change would look from the
 * batch loop's point of view.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { revokeAllCheckInsForEvent, revokeAllItemsForEvent } from "../src/bulk-revoke.js";
import type { OpsAuditContext } from "../src/ops-audit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

const EVENT_ID = "test-event-bulk-revoke-001";
const audit: OpsAuditContext = { operator: "test-admin" };

let prisma: PrismaClient;
let giftbagItemId: string;

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = new PrismaClient();

  await prisma.organization.create({
    data: { id: "org_default", name: "Default", slug: "default" },
  });

  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Bulk Revoke Test Event",
      slug: "bulk-revoke-test-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: "org_default",
    },
  });

  const giftbag = await prisma.eventItem.create({
    data: { event_id: EVENT_ID, key: "giftbag", label: "Gift bag" },
  });
  giftbagItemId = giftbag.id;
});

afterAll(async () => {
  await prisma.attendeeActionLog.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.attendeeItemState.deleteMany({ where: { event_item: { event_id: EVENT_ID } } });
  await prisma.checkIn.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.eventItem.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.$disconnect();
  vi.restoreAllMocks();
});

describe("revokeAllCheckInsForEvent", () => {
  it("returns 0 when no attendee is currently admitted", async () => {
    const count = await revokeAllCheckInsForEvent(prisma, { eventId: EVENT_ID, audit });
    expect(count).toBe(0);
  });

  it("revokes every currently-admitted attendee and returns the count", async () => {
    const [a, b] = await Promise.all([
      prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: "checkin-bulk-a@example.com",
          name: "Bulk A",
          admitted_at: new Date(),
        },
      }),
      prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: "checkin-bulk-b@example.com",
          name: "Bulk B",
          admitted_at: new Date(),
        },
      }),
    ]);

    const count = await revokeAllCheckInsForEvent(prisma, { eventId: EVENT_ID, audit });
    expect(count).toBe(2);

    const [refetchedA, refetchedB] = await Promise.all([
      prisma.attendee.findUnique({ where: { id: a.id } }),
      prisma.attendee.findUnique({ where: { id: b.id } }),
    ]);
    expect(refetchedA?.admitted_at).toBeNull();
    expect(refetchedB?.admitted_at).toBeNull();

    const undoLogs = await prisma.checkIn.count({
      where: {
        event_id: EVENT_ID,
        attendee_id: { in: [a.id, b.id] },
        status: "UNDO",
        source: "admin_revoke",
      },
    });
    expect(undoLogs).toBe(2);
  });

  it("does not touch attendees admitted on another event", async () => {
    const otherEvent = await prisma.event.create({
      data: {
        title: "Other Bulk Revoke Event",
        slug: "other-bulk-revoke-event",
        date: new Date("2026-09-02T09:00:00Z"),
        organization_id: "org_default",
      },
    });
    const other = await prisma.attendee.create({
      data: {
        event_id: otherEvent.id,
        email: "other-event-admitted@example.com",
        name: "Other Event",
        admitted_at: new Date(),
      },
    });

    // Nothing left admitted on EVENT_ID from the previous test.
    const count = await revokeAllCheckInsForEvent(prisma, { eventId: EVENT_ID, audit });
    expect(count).toBe(0);

    const refetched = await prisma.attendee.findUnique({ where: { id: other.id } });
    expect(refetched?.admitted_at).not.toBeNull();

    await prisma.attendee.deleteMany({ where: { event_id: otherEvent.id } });
    await prisma.event.delete({ where: { id: otherEvent.id } });
  });

  it("skips an attendee already revoked by a concurrent process, keeps processing the rest", async () => {
    const [c, d] = await Promise.all([
      prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: "checkin-race-c@example.com",
          name: "Race C",
          admitted_at: new Date(),
        },
      }),
      prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: "checkin-race-d@example.com",
          name: "Race D",
          admitted_at: new Date(),
        },
      }),
    ]);

    // Simulate: another process already revoked D's check-in moments ago —
    // the real row is already cleared before the batch even starts processing it.
    await prisma.attendee.update({ where: { id: d.id }, data: { admitted_at: null } });

    // Force the bulk function's own initial scan to see the stale (pre-race)
    // snapshot showing D as still admitted, matching the real TOCTOU window
    // between that scan and D's own revoke attempt.
    const findManySpy = vi
      .spyOn(prisma.attendee, "findMany")
      .mockResolvedValueOnce([{ id: c.id }, { id: d.id }] as never);

    const count = await revokeAllCheckInsForEvent(prisma, { eventId: EVENT_ID, audit });
    findManySpy.mockRestore();

    // Only C actually got revoked by this call; D was already cleared and is
    // skipped (UndoNotAllowedError caught internally) rather than aborting the batch.
    expect(count).toBe(1);

    const refetchedC = await prisma.attendee.findUnique({ where: { id: c.id } });
    expect(refetchedC?.admitted_at).toBeNull();

    const dUndoLogs = await prisma.checkIn.count({
      where: { attendee_id: d.id, status: "UNDO", source: "admin_revoke" },
    });
    expect(dUndoLogs).toBe(0);
  });

  it("tolerates a mid-batch IllegalItemTransitionError from the resetItems cascade (blocked-pass attendee) and keeps processing the rest", async () => {
    // L has a stale admitted_at alongside a blocked pass (the same shape as
    // the Bugbot #448 lookup scenario) — the resetItems: true cascade into
    // resetAllItemStatesForRevoke now rejects a blocked pass, which used to
    // escape this loop uncaught and abort the whole batch with a 500. M is a
    // normal admitted attendee that must still get revoked despite L's failure.
    const [l, m] = await Promise.all([
      prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: "checkin-blocked-l@example.com",
          name: "Blocked L",
          status: "revoked",
          admitted_at: new Date(),
        },
      }),
      prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: "checkin-active-m@example.com",
          name: "Active M",
          admitted_at: new Date(),
        },
      }),
    ]);

    const count = await revokeAllCheckInsForEvent(prisma, { eventId: EVENT_ID, audit });

    // Only M was revoked. L's own per-attendee transaction throws inside the
    // resetItems cascade and rolls back entirely (Prisma transaction
    // semantics), so L's admitted_at is left untouched rather than being
    // half-reverted.
    expect(count).toBe(1);

    const [refetchedL, refetchedM] = await Promise.all([
      prisma.attendee.findUnique({ where: { id: l.id } }),
      prisma.attendee.findUnique({ where: { id: m.id } }),
    ]);
    expect(refetchedL?.admitted_at).not.toBeNull();
    expect(refetchedM?.admitted_at).toBeNull();
  });
});

describe("revokeAllItemsForEvent", () => {
  it("returns 0 when nothing is issued or returned", async () => {
    const count = await revokeAllItemsForEvent(prisma, { eventId: EVENT_ID, audit });
    expect(count).toBe(0);
  });

  it("resets every issued/returned item across attendees and returns the item-row count", async () => {
    const [e, f] = await Promise.all([
      prisma.attendee.create({
        data: { event_id: EVENT_ID, email: "items-bulk-e@example.com", name: "Bulk E" },
      }),
      prisma.attendee.create({
        data: { event_id: EVENT_ID, email: "items-bulk-f@example.com", name: "Bulk F" },
      }),
    ]);
    await prisma.attendeeItemState.createMany({
      data: [
        { attendee_id: e.id, event_item_id: giftbagItemId, state: "issued" },
        { attendee_id: f.id, event_item_id: giftbagItemId, state: "returned" },
      ],
    });

    const count = await revokeAllItemsForEvent(prisma, { eventId: EVENT_ID, audit });
    expect(count).toBe(2);

    const [stateE, stateF] = await Promise.all([
      prisma.attendeeItemState.findUnique({
        where: { attendee_id_event_item_id: { attendee_id: e.id, event_item_id: giftbagItemId } },
      }),
      prisma.attendeeItemState.findUnique({
        where: { attendee_id_event_item_id: { attendee_id: f.id, event_item_id: giftbagItemId } },
      }),
    ]);
    expect(stateE?.state).toBe("pending");
    expect(stateF?.state).toBe("pending");
  });

  it("counts multiple issued items for the same attendee individually, not per-attendee", async () => {
    const headset = await prisma.eventItem.create({
      data: { event_id: EVENT_ID, key: "headset-bulk", label: "Headset" },
    });
    const g = await prisma.attendee.create({
      data: { event_id: EVENT_ID, email: "items-bulk-g@example.com", name: "Bulk G" },
    });
    await prisma.attendeeItemState.createMany({
      data: [
        { attendee_id: g.id, event_item_id: giftbagItemId, state: "issued" },
        { attendee_id: g.id, event_item_id: headset.id, state: "issued" },
      ],
    });

    const count = await revokeAllItemsForEvent(prisma, { eventId: EVENT_ID, audit });
    expect(count).toBe(2);
  });

  it("tolerates an attendee whose item was already reset by a concurrent process", async () => {
    const [h, i] = await Promise.all([
      prisma.attendee.create({
        data: { event_id: EVENT_ID, email: "items-race-h@example.com", name: "Race H" },
      }),
      prisma.attendee.create({
        data: { event_id: EVENT_ID, email: "items-race-i@example.com", name: "Race I" },
      }),
    ]);
    await prisma.attendeeItemState.createMany({
      data: [
        { attendee_id: h.id, event_item_id: giftbagItemId, state: "issued" },
        { attendee_id: i.id, event_item_id: giftbagItemId, state: "issued" },
      ],
    });

    // Simulate: another process already reset I's item to pending moments ago.
    await prisma.attendeeItemState.update({
      where: { attendee_id_event_item_id: { attendee_id: i.id, event_item_id: giftbagItemId } },
      data: { state: "pending" },
    });

    // Force the bulk function's own initial scan to see the stale (pre-race)
    // snapshot showing I's item as still issued.
    const findManySpy = vi
      .spyOn(prisma.attendeeItemState, "findMany")
      .mockResolvedValueOnce([{ attendee_id: h.id }, { attendee_id: i.id }] as never);

    const count = await revokeAllItemsForEvent(prisma, { eventId: EVENT_ID, audit });
    findManySpy.mockRestore();

    // Does not throw despite the stale snapshot; H's real item is reset for
    // real. The returned count reflects the actual number of items reset
    // (just H's one item) — not the stale pre-scan, which counted I's
    // already-reset item too and would have overstated this as 2.
    expect(count).toBe(1);
    const stateH = await prisma.attendeeItemState.findUnique({
      where: { attendee_id_event_item_id: { attendee_id: h.id, event_item_id: giftbagItemId } },
    });
    expect(stateH?.state).toBe("pending");
  });

  // Regression (bot review): a race landing *inside* a single attendee's own transaction — after
  // resetAllItemStatesForRevoke's own findMany finds the item still "issued", but before its
  // per-item updateMany runs, another writer (a second concurrent bulk-revoke, or an individual
  // "Revoke item") beats it to the same row — is a different, finer-grained case than the
  // already-covered outer pre-scan race above, and can't be reproduced with a findMany mock: the
  // transaction-scoped `tx` client Prisma constructs internally for $transaction is a distinct
  // object from `prisma`, so mocking `prisma.attendeeItemState.findMany` never reaches it. Real
  // concurrent contention on the same row exercises it for real instead: fire two genuinely
  // concurrent revokeAllItemsForEvent calls at one attendee with one issued item. Postgres
  // serializes the two competing UPDATEs via row locking; whichever loses re-evaluates its
  // guarded WHERE clause against the now-already-"pending" row, matches zero rows, and (with the
  // fix) is excluded from its own count instead of still being reported as a reset.
  it("under real concurrent contention on the same item, the two racing calls' counts sum to 1, not 2", async () => {
    const l = await prisma.attendee.create({
      data: { event_id: EVENT_ID, email: "items-race-l@example.com", name: "Race L" },
    });
    await prisma.attendeeItemState.create({
      data: { attendee_id: l.id, event_item_id: giftbagItemId, state: "issued" },
    });

    const [countA, countB] = await Promise.all([
      revokeAllItemsForEvent(prisma, { eventId: EVENT_ID, audit }),
      revokeAllItemsForEvent(prisma, { eventId: EVENT_ID, audit }),
    ]);

    // Whichever call actually performed the update reports 1, the loser reports 0 - never both 1
    // (which would mean the same real-world hand-out got double-counted as two separate resets).
    expect(countA + countB).toBe(1);

    const stateL = await prisma.attendeeItemState.findUnique({
      where: { attendee_id_event_item_id: { attendee_id: l.id, event_item_id: giftbagItemId } },
    });
    expect(stateL?.state).toBe("pending");

    // Exactly one item_revoked audit row for L's item - the loser's guarded no-op must not also
    // write a second, redundant log entry for the same hand-out.
    const logs = await prisma.attendeeActionLog.count({
      where: { attendee_id: l.id, action_type: "item_revoked" },
    });
    expect(logs).toBe(1);
  });

  it("skips an attendee whose pass is blocked (revoked/cancelled) — item stays issued, other attendees still get processed (same guard as the single-item revokeItemState)", async () => {
    const [j, k] = await Promise.all([
      prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: "items-blocked-j@example.com",
          name: "Blocked J",
          status: "revoked",
        },
      }),
      prisma.attendee.create({
        data: { event_id: EVENT_ID, email: "items-active-k@example.com", name: "Active K" },
      }),
    ]);
    await prisma.attendeeItemState.createMany({
      data: [
        { attendee_id: j.id, event_item_id: giftbagItemId, state: "issued" },
        { attendee_id: k.id, event_item_id: giftbagItemId, state: "issued" },
      ],
    });

    const count = await revokeAllItemsForEvent(prisma, { eventId: EVENT_ID, audit });

    // Only K's item is reset; J is skipped because their pass is blocked —
    // the bulk action must not silently reset items for a blocked-pass
    // attendee the way the single-item revokeItemState already refuses to.
    expect(count).toBe(1);

    const [stateJ, stateK] = await Promise.all([
      prisma.attendeeItemState.findUnique({
        where: { attendee_id_event_item_id: { attendee_id: j.id, event_item_id: giftbagItemId } },
      }),
      prisma.attendeeItemState.findUnique({
        where: { attendee_id_event_item_id: { attendee_id: k.id, event_item_id: giftbagItemId } },
      }),
    ]);
    expect(stateJ?.state).toBe("issued");
    expect(stateK?.state).toBe("pending");
  });
});
