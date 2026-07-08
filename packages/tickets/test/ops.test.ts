import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { admitAttendee } from "../src/admit.js";
import { undoLastCheckIn as undoFn } from "../src/undo.js";
import { transitionItemState, ensureAttendeeItemStates, operatorItemActions } from "../src/item-states.js";
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

describe("lookupAttendees — custom_data fields", () => {
  it("matches company/department stored only in custom_data JSON", async () => {
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
    expect(byCompany.some((r) => r.id === att.id)).toBe(true);

    const byDept = await lookupAttendees(EVENT_ID, "IT Department", prisma);
    expect(byDept.some((r) => r.id === att.id)).toBe(true);
  });

  it("returns JSON-only matches ordered by name before the limit", async () => {
    const company = "Shared JSON Corp";
    const names = ["Zulu Guest", "Alpha Guest", "Mike Guest"];
    for (const name of names) {
      const token = generateToken();
      await prisma.attendee.create({
        data: {
          event_id: EVENT_ID,
          email: `${name.replace(/\s+/g, ".").toLowerCase()}@example.com`,
          name,
          token_hash: hashToken(token),
          custom_data: { company },
        },
      });
    }

    const results = await lookupAttendees(EVENT_ID, company, prisma);
    const jsonOnly = results.filter((r) => names.includes(r.name));
    expect(jsonOnly.map((r) => r.name)).toEqual(["Alpha Guest", "Mike Guest", "Zulu Guest"]);
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
