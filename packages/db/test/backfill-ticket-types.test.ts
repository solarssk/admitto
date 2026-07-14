import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { backfillTicketTypes } from "../src/backfill-ticket-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-backfill-tt";

let prisma: PrismaClient;

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = new PrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "org-backfill-tt" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeEvent(id: string) {
  return prisma.event.create({
    data: { id, title: id, slug: id, date: new Date("2026-09-01"), organization_id: ORG_ID },
  });
}

describe("backfillTicketTypes", () => {
  it("groups case-insensitive variants into one canonical type and normalizes attendee rows", async () => {
    const event = await makeEvent("evt-tt-basic");
    await prisma.attendee.createMany({
      data: [
        { event_id: event.id, email: "a@example.com", name: "A", ticket_type: "Standard" },
        { event_id: event.id, email: "b@example.com", name: "B", ticket_type: "standard" },
        { event_id: event.id, email: "c@example.com", name: "C", ticket_type: "STANDARD" },
      ],
    });

    const result = await backfillTicketTypes(prisma);
    expect(result.eventsSeeded).toBeGreaterThanOrEqual(1);
    expect(result.typesCreated).toBeGreaterThanOrEqual(1);

    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types).toHaveLength(1);
    expect(types[0]?.key).toBe("standard");
    expect(types[0]?.label).toBe("Standard");
    expect(types[0]?.color).toBe("gray");

    const attendees = await prisma.attendee.findMany({
      where: { event_id: event.id },
      select: { ticket_type: true },
    });
    expect(attendees.every((a) => a.ticket_type === "standard")).toBe(true);
  });

  it("colors a vip group purple, preserving today's only special-cased color", async () => {
    const event = await makeEvent("evt-tt-vip");
    await prisma.attendee.createMany({
      data: [
        { event_id: event.id, email: "vip-a@example.com", name: "VA", ticket_type: "VIP" },
        { event_id: event.id, email: "vip-b@example.com", name: "VB", ticket_type: "vip" },
        { event_id: event.id, email: "std@example.com", name: "S", ticket_type: "aaa" },
      ],
    });

    await backfillTicketTypes(prisma);

    const types = await prisma.ticketType.findMany({
      where: { event_id: event.id },
      orderBy: { sort_order: "asc" },
    });
    const vip = types.find((t) => t.key === "vip");
    const aaa = types.find((t) => t.key === "aaa");
    expect(vip?.color).toBe("purple");
    expect(vip?.label).toBe("VIP");
    expect(aaa?.color).toBe("gray");
  });

  it("orders by created_at (not insertion or scan order) to decide which casing is first-seen", async () => {
    const event = await makeEvent("evt-tt-order");
    // Insertion order is deliberately the reverse of created_at order, and the row that was
    // actually created first also sorts *last* alphabetically by email. Without an explicit
    // orderBy on the backfill's query, an unordered scan (or a query plan keyed off one of
    // Attendee's event_id-leading unique indexes) could return these rows in insertion or email
    // order instead of created_at order, letting the wrong casing win the canonical label - the
    // bug this test guards against.
    await prisma.attendee.create({
      data: {
        event_id: event.id,
        email: "aaa-inserted-first@example.com",
        name: "Inserted First",
        ticket_type: "vip",
        created_at: new Date("2026-01-01T00:00:05.000Z"),
      },
    });
    await prisma.attendee.create({
      data: {
        event_id: event.id,
        email: "zzz-inserted-second@example.com",
        name: "Inserted Second",
        ticket_type: "VIP",
        created_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    await backfillTicketTypes(prisma);

    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types).toHaveLength(1);
    // "VIP" belongs to the attendee with the earliest created_at, even though it was inserted
    // second and sorts last alphabetically by email.
    expect(types[0]?.label).toBe("VIP");
  });

  it("seeds a default Standard type for an event with no non-null ticket_type values", async () => {
    const event = await makeEvent("evt-tt-empty");
    await prisma.attendee.create({
      data: { event_id: event.id, email: "no-type@example.com", name: "No Type" },
    });

    await backfillTicketTypes(prisma);

    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types).toHaveLength(1);
    expect(types[0]?.key).toBe("standard");
    expect(types[0]?.label).toBe("Standard");
    expect(types[0]?.color).toBe("gray");
  });

  it("is idempotent - an event that already has TicketType rows is left untouched", async () => {
    const event = await makeEvent("evt-tt-idempotent");
    await prisma.ticketType.create({
      data: { event_id: event.id, key: "custom", label: "Custom (hand-edited)", color: "azure" },
    });
    await prisma.attendee.create({
      data: { event_id: event.id, email: "x@example.com", name: "X", ticket_type: "something_else" },
    });

    await backfillTicketTypes(prisma);

    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types).toHaveLength(1);
    expect(types[0]?.key).toBe("custom");
    expect(types[0]?.color).toBe("azure");

    // The unmatched attendee value is left as-is - only groups matched at backfill time get
    // normalized, an event already migrated isn't re-scanned.
    const attendee = await prisma.attendee.findFirst({ where: { event_id: event.id } });
    expect(attendee?.ticket_type).toBe("something_else");
  });

  it("dedupes keys that would collide after slugification within the same event", async () => {
    const event = await makeEvent("evt-tt-collision");
    await prisma.attendee.createMany({
      data: [
        { event_id: event.id, email: "d1@example.com", name: "D1", ticket_type: "A B" },
        { event_id: event.id, email: "d2@example.com", name: "D2", ticket_type: "A-B" },
      ],
    });

    await backfillTicketTypes(prisma);

    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types).toHaveLength(2);
    const keys = types.map((t) => t.key).sort();
    expect(new Set(keys).size).toBe(2);
  });
});
