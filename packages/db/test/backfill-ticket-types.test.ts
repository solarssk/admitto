import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { backfillTicketTypes } from "../src/backfill-ticket-types.js";

const ORG_ID = "org-backfill-tt";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "org-backfill-tt" },
  });
});

afterAll(async () => {
  // Self-contained cleanup - this suite doesn't reset the shared test DB (unlike a force-reset),
  // so it must remove exactly the fixtures it created, in FK-safe order (Attendee/TicketType
  // before Event before Organization).
  await prisma.attendee.deleteMany({ where: { event: { organization_id: ORG_ID } } });
  await prisma.ticketType.deleteMany({ where: { event: { organization_id: ORG_ID } } });
  await prisma.event.deleteMany({ where: { organization_id: ORG_ID } });
  await prisma.organization.delete({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

async function makeEvent(id: string) {
  return prisma.event.create({
    data: { id, title: id, slug: id, date: new Date("2026-09-01"), organization_id: ORG_ID },
  });
}

/** Simulates legacy pre-catalog attendee data: a free-text ticket_type with no matching
 * TicketType row yet - the exact scenario this backfill script exists to migrate. Every real
 * write path enforces the (event_id, ticket_type) FK added in migration
 * 20260714210009_add_attendee_ticket_type_fk, so a plain attendee.create/createMany would reject
 * this the same way a NOT VALID constraint still would for a genuinely new row - only rows that
 * predate the constraint are grandfathered in. session_replication_role = replica is Postgres's
 * standard mechanism for exactly this (bulk-loading/migrating data that doesn't go through normal
 * constraint checks yet), scoped to one session via an interactive transaction so it can't leak
 * into any other connection or test. */
async function createLegacyAttendees(data: Prisma.AttendeeCreateManyInput[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET session_replication_role = replica`);
    await tx.attendee.createMany({ data });
    await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);
  });
}

describe("backfillTicketTypes", () => {
  it("groups case-insensitive variants into one canonical type and normalizes attendee rows", async () => {
    const event = await makeEvent("evt-tt-basic");
    await createLegacyAttendees([
      { event_id: event.id, email: "a@example.com", name: "A", ticket_type: "Standard" },
      { event_id: event.id, email: "b@example.com", name: "B", ticket_type: "standard" },
      { event_id: event.id, email: "c@example.com", name: "C", ticket_type: "STANDARD" },
    ]);

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
    await createLegacyAttendees([
      { event_id: event.id, email: "vip-a@example.com", name: "VA", ticket_type: "VIP" },
      { event_id: event.id, email: "vip-b@example.com", name: "VB", ticket_type: "vip" },
      { event_id: event.id, email: "std@example.com", name: "S", ticket_type: "aaa" },
    ]);

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
    await createLegacyAttendees([
      {
        event_id: event.id,
        email: "aaa-inserted-first@example.com",
        name: "Inserted First",
        ticket_type: "vip",
        created_at: new Date("2026-01-01T00:00:05.000Z"),
      },
    ]);
    await createLegacyAttendees([
      {
        event_id: event.id,
        email: "zzz-inserted-second@example.com",
        name: "Inserted Second",
        ticket_type: "VIP",
        created_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

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
    await createLegacyAttendees([
      { event_id: event.id, email: "x@example.com", name: "X", ticket_type: "something_else" },
    ]);

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
    await createLegacyAttendees([
      { event_id: event.id, email: "d1@example.com", name: "D1", ticket_type: "A B" },
      { event_id: event.id, email: "d2@example.com", name: "D2", ticket_type: "A-B" },
    ]);

    await backfillTicketTypes(prisma);

    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types).toHaveLength(2);
    const keys = types.map((t) => t.key).sort();
    expect(new Set(keys).size).toBe(2);
  });

  it("falls back to the constant 'type' key for an unsluggable label, matching packages/tickets/src/ticket-types.ts's uniqueTicketTypeKey", async () => {
    const event = await makeEvent("evt-tt-unsluggable");
    await createLegacyAttendees([
      { event_id: event.id, email: "u@example.com", name: "U", ticket_type: "###" },
    ]);

    await backfillTicketTypes(prisma);

    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types).toHaveLength(1);
    // "###" slugifies to "" (no a-z0-9 characters survive), so the key falls back to the
    // constant "type" - not a `type_${index}` that would vary depending on the group's position.
    expect(types[0]?.key).toBe("type");
    expect(types[0]?.label).toBe("###");
  });

  it("normalizes a whitespace-only ticket_type to null instead of leaving the literal whitespace forever", async () => {
    const event = await makeEvent("evt-tt-blank");
    await createLegacyAttendees([
      { event_id: event.id, email: "blank@example.com", name: "Blank", ticket_type: "   " },
      { event_id: event.id, email: "general@example.com", name: "General", ticket_type: "General" },
    ]);

    const result = await backfillTicketTypes(prisma);
    // Both the blank-to-null normalization and the real "General" group's normalization count.
    expect(result.attendeesNormalized).toBeGreaterThanOrEqual(2);

    const blank = await prisma.attendee.findFirst({ where: { event_id: event.id, email: "blank@example.com" } });
    expect(blank?.ticket_type).toBeNull();

    // The blank attendee never joined a group, so it doesn't produce its own TicketType row.
    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types.map((t) => t.key)).toEqual(["general"]);
  });

  it("a second call is a safe no-op once the event is fully migrated (simulates a blocked replica's transaction resuming under the lock and finding the event already done)", async () => {
    const event = await makeEvent("evt-tt-second-call");
    await createLegacyAttendees([
      { event_id: event.id, email: "sc-a@example.com", name: "SA", ticket_type: "Gold" },
      { event_id: event.id, email: "sc-b@example.com", name: "SB", ticket_type: "gold" },
    ]);

    const first = await backfillTicketTypes(prisma);
    expect(first.eventsSeeded).toBeGreaterThanOrEqual(1);
    expect(first.typesCreated).toBeGreaterThanOrEqual(1);

    const second = await backfillTicketTypes(prisma);
    expect(second.eventsSeeded).toBe(0);
    expect(second.typesCreated).toBe(0);
    expect(second.attendeesNormalized).toBe(0);

    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types).toHaveLength(1);
    expect(types[0]?.key).toBe("gold");
  });

  it("two concurrent calls racing the same event don't crash or duplicate TicketType rows (advisory lock + re-check under lock)", async () => {
    const event = await makeEvent("evt-tt-concurrent");
    await createLegacyAttendees([
      { event_id: event.id, email: "cc-a@example.com", name: "CA", ticket_type: "Platinum" },
      { event_id: event.id, email: "cc-b@example.com", name: "CB", ticket_type: "platinum" },
    ]);

    // Both calls independently see this event with zero TicketType rows in their own outer query
    // and race to migrate it - the per-event advisory lock (`ticket-types:<eventId>`) must
    // serialize their transactions, and the re-check-under-lock must make the loser a safe no-op
    // instead of both attempting `ticketType.create` for the same (event_id, key) and hitting the
    // unique constraint (issue 1: rolling-deploy race).
    const [a, b] = await Promise.all([backfillTicketTypes(prisma), backfillTicketTypes(prisma)]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    const types = await prisma.ticketType.findMany({ where: { event_id: event.id } });
    expect(types).toHaveLength(1);
    expect(types[0]?.key).toBe("platinum");

    const attendees = await prisma.attendee.findMany({
      where: { event_id: event.id },
      select: { ticket_type: true },
    });
    expect(attendees.every((at) => at.ticket_type === "platinum")).toBe(true);
  });
});
