import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  buildExportCsv,
  buildSanitizedExportRows,
  EXPORT_BASE_COLUMNS,
  exportAttendeesCsv,
} from "../src/attendees-export.js";
import type { ExportAttendeeSqlRow } from "../src/attendees-list-filters.js";
import type { TicketTypeInfo } from "../src/ticket-types.js";

function makeRow(overrides: Partial<ExportAttendeeSqlRow> = {}): ExportAttendeeSqlRow {
  return {
    name: "Guest One",
    email: "guest-one@example.com",
    company: null,
    department: null,
    custom_data: null,
    ticket_type: null,
    admitted_at: null,
    ...overrides,
  };
}

const catalog: TicketTypeInfo[] = [
  { id: "1", key: "vip", label: "VIP Guest", color: "purple", sort_order: 0 },
  { id: "2", key: "standard", label: "Standard", color: "gray", sort_order: 1 },
];

describe("buildSanitizedExportRows — ticket type catalog resolution (batch 04 / #351 follow-up)", () => {
  it("resolves a row's raw ticket_type key to the catalog's current label, not the key", () => {
    const [row] = buildSanitizedExportRows([makeRow({ ticket_type: "vip" })], [], "UTC", catalog);
    expect(row!.ticket_type).toBe("VIP Guest");
  });

  it("still exports an orphaned/unmatched ticket_type key as-is rather than blanking it (fail-open)", () => {
    const [row] = buildSanitizedExportRows(
      [makeRow({ ticket_type: "staff_2" })],
      [],
      "UTC",
      catalog,
    );
    expect(row!.ticket_type).toBe("staff_2");
  });

  it("leaves a null ticket_type as an empty cell", () => {
    const [row] = buildSanitizedExportRows([makeRow({ ticket_type: null })], [], "UTC", catalog);
    expect(row!.ticket_type).toBe("");
  });

  it("falls back to the raw key when no catalog is passed at all (default param stays backward compatible)", () => {
    const [row] = buildSanitizedExportRows([makeRow({ ticket_type: "vip" })], [], "UTC");
    expect(row!.ticket_type).toBe("vip");
  });
});

describe("buildSanitizedExportRows — check_in_status label", () => {
  it("renders a human-readable label for an admitted attendee, not the raw DB value", () => {
    const [row] = buildSanitizedExportRows(
      [makeRow({ admitted_at: new Date("2026-08-01T09:00:00Z") })],
      [],
      "UTC",
    );
    expect(row!.check_in_status).toBe("Checked in");
  });

  it("renders a human-readable label for a not-yet-admitted attendee", () => {
    const [row] = buildSanitizedExportRows([makeRow({ admitted_at: null })], [], "UTC");
    expect(row!.check_in_status).toBe("Not checked in");
  });
});

describe("buildExportCsv", () => {
  it("doubles embedded quotes in RFC 4180 cells", () => {
    const csv = buildExportCsv(
      [
        {
          check_off: "",
          name: 'Ada "Ace"',
          email: "ada@example.com",
          company: "",
          department: "",
          ticket_type: "",
          check_in_status: "not_admitted",
          admitted_at: "",
          attribute_values: [],
        },
      ],
      [...EXPORT_BASE_COLUMNS],
    );

    expect(csv).toContain('"Ada ""Ace"""');
  });
});

describe("exportAttendeesCsv — ticket type catalog resolution (DB)", () => {
  let prisma: PrismaClient;
  const ORG_ID = "org_export_ticket_types";
  const EVENT_ID = "test-event-export-ticket-types";

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.organization.upsert({
      where: { id: ORG_ID },
      create: { id: ORG_ID, name: "Export Ticket Types", slug: "export-ticket-types" },
      update: {},
    });
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      create: {
        id: EVENT_ID,
        title: "Export Ticket Types Event",
        slug: "export-ticket-types-event",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: ORG_ID,
      },
      update: {},
    });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.ticketType.create({
      data: { event_id: EVENT_ID, key: "vip", label: "VIP Guest", color: "purple", sort_order: 0 },
    });
    await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        name: "Guest One",
        email: "guest-one@example.com",
        ticket_type: "vip",
      },
    });
  });

  afterAll(async () => {
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.ticketType.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } });
    await prisma.organization.delete({ where: { id: ORG_ID } });
    await prisma.$disconnect();
  });

  it("exports the catalog's current label in the CSV, not the raw stored key", async () => {
    const result = await exportAttendeesCsv(prisma, EVENT_ID, { status: "all" });
    expect(result.exportRows).toHaveLength(1);
    expect(result.exportRows[0]!.ticket_type).toBe("VIP Guest");
    expect(result.csv).toContain("VIP Guest");
  });
});
