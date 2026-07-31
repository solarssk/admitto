import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  UnknownTicketTypeError,
  assertTicketTypeInCatalog,
  ensureStandardTicketType,
  loadEventTicketTypes,
  slugifyTicketTypeKey,
  uniqueTicketTypeKey,
} from "../src/ticket-types.js";

describe("loadEventTicketTypes / ensureStandardTicketType", () => {
  let prisma: PrismaClient;
  const EVENT_ID = "test-event-load-ticket-types";

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.organization.upsert({
      where: { id: "org_load_ticket_types" },
      create: { id: "org_load_ticket_types", name: "Load Ticket Types", slug: "load-ticket-types" },
      update: {},
    });
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      create: {
        id: EVENT_ID,
        title: "Load Ticket Types Event",
        slug: "load-ticket-types-event",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: "org_load_ticket_types",
      },
      update: {},
    });
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.ticketType.createMany({
      data: [
        { event_id: EVENT_ID, key: "standard", label: "Standard", color: "gray", sort_order: 0 },
        { event_id: EVENT_ID, key: "vip", label: "VIP", color: "purple", sort_order: 1 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } });
    await prisma.organization.delete({ where: { id: "org_load_ticket_types" } });
    await prisma.$disconnect();
  });

  it("returns catalog rows ordered by sort_order", async () => {
    const types = await loadEventTicketTypes(prisma, EVENT_ID);
    expect(types.map((t) => t.key)).toEqual(["standard", "vip"]);
  });

  it("returns an empty array for an event with no ticket types", async () => {
    const otherEventId = "test-event-load-ticket-types-empty";
    await prisma.event.upsert({
      where: { id: otherEventId },
      create: {
        id: otherEventId,
        title: "No types",
        slug: "load-ticket-types-empty-event",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: "org_load_ticket_types",
      },
      update: {},
    });
    const types = await loadEventTicketTypes(prisma, otherEventId);
    expect(types).toEqual([]);
    await prisma.event.delete({ where: { id: otherEventId } });
  });

  it("ensureStandardTicketType seeds one 'Standard' row for an event with none", async () => {
    const eventId = "test-event-ensure-standard";
    await prisma.event.create({
      data: {
        id: eventId,
        title: "Ensure standard",
        slug: "ensure-standard-event",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: "org_load_ticket_types",
      },
    });

    await ensureStandardTicketType(eventId, prisma);
    const types = await loadEventTicketTypes(prisma, eventId);
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ key: "standard", label: "Standard", color: "gray" });

    await prisma.ticketType.deleteMany({ where: { event_id: eventId } });
    await prisma.event.delete({ where: { id: eventId } });
  });

  it("ensureStandardTicketType is a no-op when the event already has a type", async () => {
    await ensureStandardTicketType(EVENT_ID, prisma);
    const types = await loadEventTicketTypes(prisma, EVENT_ID);
    // Still exactly the two seeded in beforeAll - no extra "standard" row was added.
    expect(types).toHaveLength(2);
  });
});

describe("assertTicketTypeInCatalog", () => {
  const catalog = [
    { id: "1", key: "standard", label: "Standard", color: "gray", sort_order: 0 },
    { id: "2", key: "vip", label: "VIP", color: "purple", sort_order: 1 },
  ];

  it("passes for a key present in the catalog", () => {
    expect(() => assertTicketTypeInCatalog(catalog, "vip")).not.toThrow();
  });

  it("passes for null/undefined/empty - no value to check", () => {
    expect(() => assertTicketTypeInCatalog(catalog, null)).not.toThrow();
    expect(() => assertTicketTypeInCatalog(catalog, undefined)).not.toThrow();
  });

  it("throws UnknownTicketTypeError for a key not in the catalog", () => {
    expect(() => assertTicketTypeInCatalog(catalog, "staff")).toThrow(UnknownTicketTypeError);
  });

  it("is an exact, case-sensitive key match - not label, not case-insensitive", () => {
    expect(() => assertTicketTypeInCatalog(catalog, "VIP")).toThrow(UnknownTicketTypeError);
    expect(() => assertTicketTypeInCatalog(catalog, "Standard")).toThrow(UnknownTicketTypeError);
  });

  it("error carries the offending value", () => {
    try {
      assertTicketTypeInCatalog(catalog, "unknown_key");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownTicketTypeError);
      expect((err as UnknownTicketTypeError).value).toBe("unknown_key");
      expect((err as Error).message).toBe("unknown_ticket_type:unknown_key");
    }
  });
});

describe("slugifyTicketTypeKey", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(slugifyTicketTypeKey("Press Pass")).toBe("press_pass");
  });

  it("strips combining-mark diacritics (ł has no NFD decomposition, so it becomes a separator)", () => {
    expect(slugifyTicketTypeKey("Zażółć")).toBe("zazo_c");
  });

  it("collapses repeated separators and trims leading/trailing underscores", () => {
    expect(slugifyTicketTypeKey("  A -- B  ")).toBe("a_b");
  });

  it("truncates to 60 characters", () => {
    const long = "a".repeat(100);
    expect(slugifyTicketTypeKey(long)).toHaveLength(60);
  });
});

describe("uniqueTicketTypeKey", () => {
  it("returns the plain slug when unused", () => {
    expect(uniqueTicketTypeKey("VIP", [])).toBe("vip");
  });

  it("appends a numeric suffix on collision", () => {
    expect(uniqueTicketTypeKey("VIP", ["vip"])).toBe("vip_2");
    expect(uniqueTicketTypeKey("VIP", ["vip", "vip_2"])).toBe("vip_3");
  });

  it("falls back to 'type' when the label slugifies to an empty string", () => {
    expect(uniqueTicketTypeKey("!!!", [])).toBe("type");
  });
});
