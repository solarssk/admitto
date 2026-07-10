import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { admitAttendee } from "../src/admit.js";
import { undoLastCheckIn as undoFn, revokeCheckIn, UndoNotAllowedError } from "../src/undo.js";
import {
  transitionItemState,
  revokeItemState,
  ensureAttendeeItemStates,
  operatorItemActions,
} from "../src/item-states.js";
import { addAttendeeNote, NoteTooLongError, OperatorRequiredError } from "../src/notes.js";
import { generateToken, hashToken } from "../src/index.js";
import { getAttendeeCard, getCheckInStats, lookupAttendees } from "../src/attendee-card.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

let prisma: PrismaClient;
const EVENT_ID = "test-event-ops-001";
let attendeeId: string;
const DEVICE = "tablet-1";
const OPERATOR = "user-op-1";

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes("localhost") && !dbUrl.includes("127.0.0.1") && !dbUrl.includes("local")) {
    throw new Error("ops.test.ts: refusing --force-reset on non-local DATABASE_URL");
  }
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = new PrismaClient();
  await prisma.organization.create({ data: { id: "org_ops", name: "Ops", slug: "ops" } });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Ops Event",
      slug: "ops-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: "org_ops",
      ops_config: { badge_at_entry: true, require_confirm_on_scan: false },
    },
  });
  await prisma.eventItem.createMany({
    data: [
      {
        event_id: EVENT_ID,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Shirt size", source_field: "shirt_size" }], requires_return: false },
      },
      { event_id: EVENT_ID, key: "badge", label: "Badge", config: { issue_on_checkin: true } },
      { event_id: EVENT_ID, key: "headset", label: "Headset", config: { requires_return: true } },
    ],
  });
  const token = generateToken();
  const att = await prisma.attendee.create({
    data: {
      event_id: EVENT_ID,
      email: "ops@example.com",
      name: "Ops Guest",
      token_hash: hashToken(token),
      custom_data: { shirt_size: "L", company: "Acme" },
    },
  });
  attendeeId = att.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("admitAttendee + undo badge rollback (Lock #1)", () => {
  it("issues badge on check-in and undo rolls it back", async () => {
    const audit = { operator: OPERATOR, sessionId: "sess-1", deviceId: DEVICE, ip: "127.0.0.1" };
    const admit = await admitAttendee(
      { attendeeId, eventId: EVENT_ID, method: "scan", audit },
      prisma,
    );
    expect(admit.status).toBe("VALID");

    const badgeState = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: attendeeId, event_item: { key: "badge" } },
    });
    expect(badgeState?.state).toBe("issued");

    const checkInLog = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: attendeeId, action_type: "check_in" },
      orderBy: { created_at: "desc" },
    });
    expect(checkInLog?.session_id).toBe("sess-1");

    const undo = await undoFn({ eventId: EVENT_ID, audit }, prisma);
    expect(undo.card.check_in_status).toBe("not_admitted");

    const undoRow = await prisma.checkIn.findFirst({
      where: { attendee_id: attendeeId, source: "undo" },
      orderBy: { created_at: "desc" },
    });
    expect(undoRow?.status).toBe("UNDO");

    const badgeAfter = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: attendeeId, event_item: { key: "badge" } },
    });
    expect(badgeAfter?.state).toBe("pending");
  });
});

describe("lookupAttendees — name/email only, never company/department", () => {
  it("does not match on company/department stored in custom_data JSON (but still matches the name)", async () => {
    const token = generateToken();
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "json-only@example.com",
        name: "JSON Only Guest",
        token_hash: hashToken(token),
        custom_data: { company: "Acme From JSON", department: "IT Department" },
      },
    });

    const byCompany = await lookupAttendees(EVENT_ID, "Acme From JSON", prisma);
    expect(byCompany.some((r) => r.id === att.id)).toBe(false);

    const byDept = await lookupAttendees(EVENT_ID, "IT Department", prisma);
    expect(byDept.some((r) => r.id === att.id)).toBe(false);

    // Search itself still works — the same attendee is found by name, and the
    // company is still carried through on the returned result for display.
    const byName = await lookupAttendees(EVENT_ID, "JSON Only Guest", prisma);
    const hit = byName.find((r) => r.id === att.id);
    expect(hit).toBeDefined();
    expect(hit?.company).toBe("Acme From JSON");
  });

  it("does not match on company/department stored in the DB columns (but still matches the email)", async () => {
    const token = generateToken();
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "column-company@example.com",
        name: "Column Company Guest",
        token_hash: hashToken(token),
        company: "Contoso Column Ltd",
        department: "Logistics Column Dept",
      },
    });

    const byCompany = await lookupAttendees(EVENT_ID, "Contoso Column Ltd", prisma);
    expect(byCompany.some((r) => r.id === att.id)).toBe(false);

    const byDept = await lookupAttendees(EVENT_ID, "Logistics Column Dept", prisma);
    expect(byDept.some((r) => r.id === att.id)).toBe(false);

    const byEmail = await lookupAttendees(EVENT_ID, "column-company@example.com", prisma);
    expect(byEmail.some((r) => r.id === att.id)).toBe(true);
  });
});

describe("getAttendeeCard — item detail from contents", () => {
  it("shows shirt size on giftbag via contents config", async () => {
    const card = await getAttendeeCard(EVENT_ID, attendeeId, prisma);
    expect(card).not.toBeNull();
    const giftbag = card!.items.find((i) => i.key === "giftbag");
    expect(giftbag?.detail).toBe("Shirt size: L");
    expect(card!.items.some((i) => i.key === "tshirt")).toBe(false);
  });

  it("omits disabled items from the card", async () => {
    await prisma.eventItem.create({
      data: {
        event_id: EVENT_ID,
        key: "socks",
        label: "Socks",
        enabled: false,
        config: { contents: [{ label: "Socks size", source_field: "sock_size" }] },
      },
    });
    const card = await getAttendeeCard(EVENT_ID, attendeeId, prisma);
    expect(card!.items.some((i) => i.key === "socks")).toBe(false);
  });

  it("includes item icon when configured on EventItem", async () => {
    await prisma.eventItem.update({
      where: { event_id_key: { event_id: EVENT_ID, key: "badge" } },
      data: { icon: "badge" },
    });
    const card = await getAttendeeCard(EVENT_ID, attendeeId, prisma);
    const badge = card!.items.find((i) => i.key === "badge");
    expect(badge?.icon).toBe("badge");
  });
});

describe("ensureAttendeeItemStates (Lock #2)", () => {
  it("is idempotent on repeated calls", async () => {
    const token = generateToken();
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "ensure@example.com",
        name: "Ensure Guest",
        token_hash: hashToken(token),
      },
    });

    await ensureAttendeeItemStates(att.id, EVENT_ID, prisma);
    await ensureAttendeeItemStates(att.id, EVENT_ID, prisma);

    const rows = await prisma.attendeeItemState.findMany({
      where: { attendee_id: att.id },
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === "pending")).toBe(true);
  });
});

describe("addAttendeeNote (Lock #8)", () => {
  it("rejects notes longer than 2000 characters", async () => {
    await expect(
      addAttendeeNote(
        {
          attendeeId,
          eventId: EVENT_ID,
          body: "n".repeat(2001),
          audit: { operator: OPERATOR, sessionId: "sess-1" },
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(NoteTooLongError);
  });

  it("rejects missing operator in domain layer", async () => {
    await expect(
      addAttendeeNote(
        {
          attendeeId,
          eventId: EVENT_ID,
          body: "hello",
          audit: { sessionId: "sess-1" },
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(OperatorRequiredError);
  });
});

describe("operatorItemActions", () => {
  it("hides returned when requires_return is false", () => {
    expect(operatorItemActions("issued", { requires_return: false })).toEqual([]);
    expect(operatorItemActions("issued", { requires_return: true })).toEqual(["returned"]);
    expect(operatorItemActions("issued", {})).toEqual(["returned"]);
    expect(operatorItemActions("pending", { requires_return: false })).toEqual(["issued"]);
  });
});

describe("transitionItemState", () => {
  it("rejects illegal pending→returned", async () => {
    const freshToken = generateToken();
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "illegal@example.com",
        name: "Illegal",
        token_hash: hashToken(freshToken),
      },
    });
    await expect(
      transitionItemState(
        {
          attendeeId: att.id,
          eventId: EVENT_ID,
          itemKey: "headset",
          targetState: "returned",
          audit: { operator: OPERATOR, deviceId: DEVICE },
        },
        prisma,
      ),
    ).rejects.toThrow(/Illegal transition/);
  });

  it("rejects returned when requires_return is false", async () => {
    await prisma.eventItem.update({
      where: { event_id_key: { event_id: EVENT_ID, key: "headset" } },
      data: { config: { requires_return: false } },
    });
    const freshToken = generateToken();
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "no-return@example.com",
        name: "No Return",
        token_hash: hashToken(freshToken),
      },
    });
    await transitionItemState(
      {
        attendeeId: att.id,
        eventId: EVENT_ID,
        itemKey: "headset",
        targetState: "issued",
        audit: { operator: OPERATOR, deviceId: DEVICE },
      },
      prisma,
    );
    await expect(
      transitionItemState(
        {
          attendeeId: att.id,
          eventId: EVENT_ID,
          itemKey: "headset",
          targetState: "returned",
          audit: { operator: OPERATOR, deviceId: DEVICE },
        },
        prisma,
      ),
    ).rejects.toThrow(/Return is not enabled/);
  });
});

describe("getCheckInStats — active attendees only (#380)", () => {
  const STATS_EVENT = "test-event-stats-380";

  beforeAll(async () => {
    await prisma.event.create({
      data: {
        id: STATS_EVENT,
        title: "Stats Event",
        slug: "stats-event",
        date: new Date("2026-09-02T09:00:00Z"),
        organization_id: "org_ops",
      },
    });
    const admitted = new Date("2026-09-02T10:00:00Z");
    await prisma.attendee.createMany({
      data: [
        { event_id: STATS_EVENT, email: "s1@example.com", name: "Reg", token_hash: hashToken(generateToken()) },
        { event_id: STATS_EVENT, email: "s2@example.com", name: "Reg admitted", token_hash: hashToken(generateToken()), admitted_at: admitted },
        { event_id: STATS_EVENT, email: "s3@example.com", name: "Confirmed", status: "confirmed", token_hash: hashToken(generateToken()) },
        { event_id: STATS_EVENT, email: "s4@example.com", name: "Revoked", status: "revoked", token_hash: hashToken(generateToken()) },
        { event_id: STATS_EVENT, email: "s5@example.com", name: "Revoked after admit", status: "revoked", token_hash: hashToken(generateToken()), admitted_at: admitted },
        { event_id: STATS_EVENT, email: "s6@example.com", name: "Cancelled", status: "cancelled", token_hash: hashToken(generateToken()) },
      ],
    });
  });

  it("excludes revoked and cancelled from both counts", async () => {
    const stats = await getCheckInStats(STATS_EVENT, prisma);
    // Active: Reg, Reg admitted, Confirmed. Admitted among active: Reg admitted.
    expect(stats.total_count).toBe(3);
    expect(stats.admitted_count).toBe(1);
  });
});

describe("lookupAttendees — revoked pass with stale admitted_at (Bugbot #448)", () => {
  const LOOKUP_STATUS_EVENT = "test-event-lookup-status-448";

  beforeAll(async () => {
    await prisma.event.create({
      data: {
        id: LOOKUP_STATUS_EVENT,
        title: "Lookup Status Event",
        slug: "lookup-status-event",
        date: new Date("2026-09-03T09:00:00Z"),
        organization_id: "org_ops",
      },
    });
    await prisma.attendee.createMany({
      data: [
        {
          event_id: LOOKUP_STATUS_EVENT,
          email: "revoked-lookup@example.com",
          name: "Revoked Lookup Guest",
          status: "revoked",
          admitted_at: new Date("2026-09-03T10:00:00Z"),
          token_hash: hashToken(generateToken()),
        },
        {
          event_id: LOOKUP_STATUS_EVENT,
          email: "active-lookup@example.com",
          name: "Active Lookup Guest",
          admitted_at: new Date("2026-09-03T10:00:00Z"),
          token_hash: hashToken(generateToken()),
        },
      ],
    });
  });

  it("does not report a revoked attendee as admitted despite a set admitted_at", async () => {
    const results = await lookupAttendees(LOOKUP_STATUS_EVENT, "Lookup Guest", prisma);
    const revoked = results.find((r) => r.name === "Revoked Lookup Guest");
    const active = results.find((r) => r.name === "Active Lookup Guest");
    expect(revoked?.check_in_status).toBe("not_admitted");
    expect(active?.check_in_status).toBe("admitted");
  });
});

describe("revokeCheckIn — admin/superadmin un-admit (any device, any time)", () => {
  it("un-admits, rolls back the badge, and logs check_in_revoked", async () => {
    const token = generateToken();
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "revoke-target@example.com",
        name: "Revoke Target",
        token_hash: hashToken(token),
      },
    });

    // Admitted by an operator on a kiosk device — the admin revoking below
    // never touched that device, proving this is attendee-scoped, not
    // device-scoped like undoLastCheckIn.
    const admit = await admitAttendee(
      {
        attendeeId: att.id,
        eventId: EVENT_ID,
        method: "scan",
        audit: { operator: "operator-1", deviceId: "kiosk-7", sessionId: "sess-kiosk", ip: "127.0.0.1" },
      },
      prisma,
    );
    expect(admit.status).toBe("VALID");
    const badgeState = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item: { key: "badge" } },
    });
    expect(badgeState?.state).toBe("issued");

    const adminAudit = { operator: "admin-9", sessionId: "sess-admin", ip: "10.0.0.1" };
    const result = await revokeCheckIn({ eventId: EVENT_ID, attendeeId: att.id, audit: adminAudit }, prisma);
    expect(result.card.check_in_status).toBe("not_admitted");

    const attendeeAfter = await prisma.attendee.findUnique({ where: { id: att.id } });
    expect(attendeeAfter?.admitted_at).toBeNull();

    const undoRow = await prisma.checkIn.findFirst({
      where: { attendee_id: att.id, source: "admin_revoke" },
      orderBy: { created_at: "desc" },
    });
    expect(undoRow?.status).toBe("UNDO");
    expect(undoRow?.checked_in_by).toBe("admin-9");

    const badgeAfter = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item: { key: "badge" } },
    });
    expect(badgeAfter?.state).toBe("pending");

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: att.id, action_type: "check_in_revoked" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.actor_user_id).toBe("admin-9");
  });

  it("rejects revoking an attendee who is not currently admitted", async () => {
    const token = generateToken();
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "not-admitted@example.com",
        name: "Not Admitted",
        token_hash: hashToken(token),
      },
    });

    await expect(
      revokeCheckIn(
        { eventId: EVENT_ID, attendeeId: att.id, audit: { operator: "admin-9" } },
        prisma,
      ),
    ).rejects.toThrow(UndoNotAllowedError);
  });

  it("also resets a NON-badge handed-out item back to pending (blanket reset, not just the badge)", async () => {
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "revoke-all-items@example.com",
        name: "Revoke All Items",
        token_hash: hashToken(generateToken()),
      },
    });

    // Admit → badge auto-issued (issue_on_checkin). Operator also hands out the
    // gift bag, so two different items are "issued" before the revoke.
    await admitAttendee(
      { attendeeId: att.id, eventId: EVENT_ID, method: "scan", audit: { operator: "operator-1", deviceId: "kiosk-7" } },
      prisma,
    );
    await transitionItemState(
      { attendeeId: att.id, eventId: EVENT_ID, itemKey: "giftbag", targetState: "issued", audit: { operator: "operator-1", deviceId: "kiosk-7" } },
      prisma,
    );
    const before = await prisma.attendeeItemState.findMany({ where: { attendee_id: att.id } });
    expect(before.filter((s) => s.state === "issued").length).toBeGreaterThanOrEqual(2);

    await revokeCheckIn({ eventId: EVENT_ID, attendeeId: att.id, audit: { operator: "admin-9" } }, prisma);

    const after = await prisma.attendeeItemState.findMany({ where: { attendee_id: att.id } });
    expect(after.every((s) => s.state === "pending")).toBe(true);

    // Every item actually reset is audited (badge + giftbag = at least 2).
    const revokedLogs = await prisma.attendeeActionLog.findMany({
      where: { attendee_id: att.id, action_type: "item_revoked" },
    });
    expect(revokedLogs.length).toBeGreaterThanOrEqual(2);
  });

  it("does not reset an item in an exceptional state (lost/problem/not_applicable) — those aren't handed-out states (bot review, #457)", async () => {
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "revoke-preserves-lost@example.com",
        name: "Revoke Preserves Lost",
        token_hash: hashToken(generateToken()),
        admitted_at: new Date("2026-09-01T10:00:00Z"),
      },
    });
    await ensureAttendeeItemStates(att.id, EVENT_ID, prisma);
    const headset = await prisma.eventItem.findFirstOrThrow({ where: { event_id: EVENT_ID, key: "headset" } });
    await prisma.attendeeItemState.update({
      where: { attendee_id_event_item_id: { attendee_id: att.id, event_item_id: headset.id } },
      data: { state: "lost" },
    });

    await revokeCheckIn({ eventId: EVENT_ID, attendeeId: att.id, audit: { operator: "admin-9" } }, prisma);

    const after = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item_id: headset.id },
    });
    expect(after?.state).toBe("lost");
  });

  it("does not reset an item state row pointing at a different event's EventItem, even for the same attendee (defense-in-depth, CodeRabbit nitpick)", async () => {
    // Simulates the invariant CodeRabbit's filter guards against ("attendees
    // are already event-scoped so this can't currently cross events, but the
    // filter keeps that invariant explicit") — deliberately construct the
    // broken state directly, since no real app code path can produce it.
    const otherEvent = await prisma.event.create({
      data: {
        id: "test-event-ops-cross-event-457",
        title: "Cross-event Ops",
        slug: "cross-event-ops-457",
        date: new Date("2026-09-03T09:00:00Z"),
        organization_id: "org_ops",
      },
    });
    const otherItem = await prisma.eventItem.create({
      data: { event_id: otherEvent.id, key: "cross-event-swag", label: "Cross-event swag" },
    });

    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "revoke-scoped-to-event@example.com",
        name: "Revoke Scoped To Event",
        token_hash: hashToken(generateToken()),
        admitted_at: new Date("2026-09-01T10:00:00Z"),
      },
    });
    await ensureAttendeeItemStates(att.id, EVENT_ID, prisma);
    await prisma.attendeeItemState.create({
      data: { attendee_id: att.id, event_item_id: otherItem.id, state: "issued" },
    });

    await revokeCheckIn({ eventId: EVENT_ID, attendeeId: att.id, audit: { operator: "admin-9" } }, prisma);

    const crossEventAfter = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item_id: otherItem.id },
    });
    expect(crossEventAfter?.state).toBe("issued");

    // The attendee's own event's items (e.g. badge, auto-issued on admit) are
    // still reset normally — the fix scopes the query, it doesn't break it.
    const badgeAfter = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item: { key: "badge" } },
    });
    expect(badgeAfter?.state).toBe("pending");
  });
});

describe("revokeItemState — admin/superadmin single-item reset (item revocation feature)", () => {
  let itemSeq = 0;
  async function makeAttendeeWithItemState(key: string, state: string) {
    itemSeq += 1;
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: `revoke-item-${itemSeq}@example.com`,
        name: "Revoke Item Target",
        token_hash: hashToken(generateToken()),
      },
    });
    await ensureAttendeeItemStates(att.id, EVENT_ID, prisma);
    const eventItem = await prisma.eventItem.findFirstOrThrow({
      where: { event_id: EVENT_ID, key },
    });
    await prisma.attendeeItemState.update({
      where: { attendee_id_event_item_id: { attendee_id: att.id, event_item_id: eventItem.id } },
      data: { state },
    });
    return att;
  }

  it("resets an issued item to pending and logs item_revoked with the previous state", async () => {
    const att = await makeAttendeeWithItemState("giftbag", "issued");
    const result = await revokeItemState(
      { attendeeId: att.id, eventId: EVENT_ID, itemKey: "giftbag", audit: { operator: "admin-9" } },
      prisma,
    );
    expect(result.state).toBe("pending");

    const after = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item: { key: "giftbag" } },
    });
    expect(after?.state).toBe("pending");

    const log = await prisma.attendeeActionLog.findFirst({
      where: { attendee_id: att.id, action_type: "item_revoked" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.actor_user_id).toBe("admin-9");
    expect(log?.metadata).toMatchObject({
      event_item_key: "giftbag",
      from_state: "issued",
      to_state: "pending",
    });
  });

  it("resets a returned item to pending too — not gated by the operator forward-only machine", async () => {
    const att = await makeAttendeeWithItemState("headset", "returned");
    const result = await revokeItemState(
      { attendeeId: att.id, eventId: EVENT_ID, itemKey: "headset", audit: { operator: "admin-9" } },
      prisma,
    );
    expect(result.state).toBe("pending");
    const after = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item: { key: "headset" } },
    });
    expect(after?.state).toBe("pending");
  });

  it("is a harmless no-op on an already-pending item (no audit noise)", async () => {
    const att = await makeAttendeeWithItemState("giftbag", "pending");
    const result = await revokeItemState(
      { attendeeId: att.id, eventId: EVENT_ID, itemKey: "giftbag", audit: { operator: "admin-9" } },
      prisma,
    );
    expect(result.state).toBe("pending");
    const logs = await prisma.attendeeActionLog.count({
      where: { attendee_id: att.id, action_type: "item_revoked" },
    });
    expect(logs).toBe(0);
  });

  it("is a no-op on an item in an exceptional state (lost/problem/not_applicable) — those aren't handed-out states (bot review, #457)", async () => {
    const att = await makeAttendeeWithItemState("giftbag", "problem");
    const result = await revokeItemState(
      { attendeeId: att.id, eventId: EVENT_ID, itemKey: "giftbag", audit: { operator: "admin-9" } },
      prisma,
    );
    expect(result.state).toBe("problem");
    const after = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item: { key: "giftbag" } },
    });
    expect(after?.state).toBe("problem");
    const logs = await prisma.attendeeActionLog.count({
      where: { attendee_id: att.id, action_type: "item_revoked" },
    });
    expect(logs).toBe(0);
  });

  it("rejects an unknown item key", async () => {
    const att = await makeAttendeeWithItemState("giftbag", "issued");
    await expect(
      revokeItemState(
        { attendeeId: att.id, eventId: EVENT_ID, itemKey: "does-not-exist", audit: { operator: "admin-9" } },
        prisma,
      ),
    ).rejects.toThrow(/Item not found/);
  });

  it("rejects an attendee that does not belong to the event", async () => {
    await expect(
      revokeItemState(
        { attendeeId: "no-such-attendee", eventId: EVENT_ID, itemKey: "giftbag", audit: { operator: "admin-9" } },
        prisma,
      ),
    ).rejects.toThrow(/Attendee not found/);
  });

  it("rejects revoking an item on a blocked (revoked/cancelled) pass — server enforces it independently of the card's Revoke button being hidden (bot review, #457)", async () => {
    const att = await makeAttendeeWithItemState("giftbag", "issued");
    await prisma.attendee.update({ where: { id: att.id }, data: { status: "revoked" } });

    await expect(
      revokeItemState(
        { attendeeId: att.id, eventId: EVENT_ID, itemKey: "giftbag", audit: { operator: "admin-9" } },
        prisma,
      ),
    ).rejects.toThrow(/not active/);

    const after = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item: { key: "giftbag" } },
    });
    expect(after?.state).toBe("issued");
  });

  it("resets an item to pending even after its EventItem type was disabled — a past hand-out can still be corrected (bot review, #457)", async () => {
    // Unlike transitionItemState (operator forward-only), revoke is a
    // corrective admin action: it shouldn't leave a hand-out permanently
    // stuck just because the item type is no longer offered going forward.
    const item = await prisma.eventItem.create({
      data: { event_id: EVENT_ID, key: "discontinued-swag", label: "Discontinued swag", enabled: false },
    });
    const att = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "revoke-disabled-item@example.com",
        name: "Revoke Disabled Item Target",
        token_hash: hashToken(generateToken()),
      },
    });
    await prisma.attendeeItemState.create({
      data: { attendee_id: att.id, event_item_id: item.id, state: "issued" },
    });

    const result = await revokeItemState(
      { attendeeId: att.id, eventId: EVENT_ID, itemKey: "discontinued-swag", audit: { operator: "admin-9" } },
      prisma,
    );
    expect(result.state).toBe("pending");

    const after = await prisma.attendeeItemState.findFirst({
      where: { attendee_id: att.id, event_item_id: item.id },
    });
    expect(after?.state).toBe("pending");
  });
});
