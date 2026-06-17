import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { admitAttendee } from "../src/admit.js";
import { undoLastCheckIn as undoFn } from "../src/undo.js";
import { transitionItemState, ensureAttendeeItemStates } from "../src/item-states.js";
import { ensureDefaultEventItems } from "../src/event-items.js";
import { addAttendeeNote, NoteTooLongError, OperatorRequiredError } from "../src/notes.js";
import { generateToken, hashToken } from "../src/index.js";

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

describe("ensureDefaultEventItems (Lock #7 lazy seed)", () => {
  it("creates default items for events created after migration", async () => {
    const eventId = "test-event-no-items";
    await prisma.event.create({
      data: {
        id: eventId,
        title: "No Items Yet",
        slug: "no-items-yet",
        date: new Date("2026-10-01"),
        organization_id: "org_ops",
      },
    });

    await ensureDefaultEventItems(eventId, prisma);
    await ensureDefaultEventItems(eventId, prisma);

    const items = await prisma.eventItem.findMany({
      where: { event_id: eventId },
      orderBy: { key: "asc" },
    });
    expect(items.map((i) => i.key)).toEqual(["badge", "giftbag", "headset", "tshirt"]);
    expect(items.find((i) => i.key === "badge")?.config).toEqual({ issue_on_checkin: true });
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
    expect(rows).toHaveLength(4);
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
});
