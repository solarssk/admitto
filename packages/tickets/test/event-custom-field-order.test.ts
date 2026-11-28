import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { EXPORT_BASE_COLUMNS, exportAttendeesCsv } from "../src/attendees-export.js";
import {
  eventCustomFieldOrderBy,
  loadEventCustomDataFields,
  loadRegistrantFormFields,
} from "../src/event-custom-fields.js";
import { RegistrantInputError, buildRegistrantCustomData } from "../src/registrant-input.js";

const ORG_ID = "org_custom_field_order";
const EVENT_ID = "test-event-custom-field-order";
const EMPTY_EVENT_ID = "test-event-custom-field-order-empty";

const at = (day: string) => new Date(`2026-01-${day}T09:00:00Z`);

// Written in a shuffled order on purpose; the ids are chosen so that ordering by id alone, by
// created_at alone or by label would each give a different answer than the rule does.
//   display_order 0..2          -> diet, parking, shirt
//   display_order 3, three rows -> created_at first (06 before 07), then id (tie_b has the lower id)
//   no display_order            -> after every placed field, oldest first (badge, arrival)
const FIELDS = [
  { id: "cf-order-9", source_field: "shirt", label: "Shirt size", display_order: 2, created_at: at("01"), show_on_form: true },
  { id: "cf-order-8", source_field: "arrival", label: "Arrival", display_order: null, created_at: at("05"), show_on_form: true },
  { id: "cf-order-7", source_field: "diet", label: "Diet", display_order: 0, created_at: at("03"), show_on_form: true, required: true },
  { id: "cf-order-6", source_field: "tie_c", label: "Tie C", display_order: 3, created_at: at("07"), show_on_form: false },
  { id: "cf-order-5", source_field: "tie_a", label: "Tie A", display_order: 3, created_at: at("06"), show_on_form: false },
  { id: "cf-order-4", source_field: "parking", label: "Parking", display_order: 1, created_at: at("02"), show_on_form: false },
  { id: "cf-order-3", source_field: "badge", label: "Badge", display_order: null, created_at: at("04"), show_on_form: false },
  { id: "cf-order-2", source_field: "tie_b", label: "Tie B", display_order: 3, created_at: at("06"), show_on_form: false },
];
const EXPECTED_ORDER = ["diet", "parking", "shirt", "tie_b", "tie_a", "tie_c", "badge", "arrival"];

describe("the one order of an event's custom fields (DB)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.organization.upsert({
      where: { id: ORG_ID },
      create: { id: ORG_ID, name: "Custom Field Order", slug: "custom-field-order" },
      update: {},
    });
    for (const [id, slug] of [
      [EVENT_ID, "custom-field-order-event"],
      [EMPTY_EVENT_ID, "custom-field-order-empty-event"],
    ] as const) {
      await prisma.event.upsert({
        where: { id },
        create: { id, title: `Order ${slug}`, slug, date: new Date("2026-09-01T09:00:00Z"), organization_id: ORG_ID },
        update: {},
      });
    }
    await prisma.eventCustomField.deleteMany({ where: { event_id: { in: [EVENT_ID, EMPTY_EVENT_ID] } } });
    await prisma.eventCustomField.createMany({
      data: FIELDS.map((field) => ({ ...field, event_id: EVENT_ID })),
    });
  });

  afterAll(async () => {
    await prisma.eventCustomField.deleteMany({ where: { event_id: { in: [EVENT_ID, EMPTY_EVENT_ID] } } });
    await prisma.event.deleteMany({ where: { id: { in: [EVENT_ID, EMPTY_EVENT_ID] } } });
    await prisma.organization.delete({ where: { id: ORG_ID } });
    await prisma.$disconnect();
  });

  it("is display_order ascending, fields without one last, ties by created_at and then id", () => {
    expect(eventCustomFieldOrderBy()).toEqual([
      { display_order: { sort: "asc", nulls: "last" } },
      { created_at: "asc" },
      { id: "asc" },
    ]);
  });

  it("hands out a new array each time, so a caller cannot change the rule for the others", () => {
    const first = eventCustomFieldOrderBy();
    first.length = 0;
    expect(eventCustomFieldOrderBy()).toHaveLength(3);
  });

  it("sorts rows that way in the database: placed fields, tie groups by created_at then id, unplaced fields last", async () => {
    const rows = await prisma.eventCustomField.findMany({
      where: { event_id: EVENT_ID },
      orderBy: eventCustomFieldOrderBy(),
    });
    expect(rows.map((row) => row.source_field)).toEqual(EXPECTED_ORDER);
  });

  it("is the order of the loader behind Add attendee, import, export and the operator card", async () => {
    const fields = await loadEventCustomDataFields(prisma, EVENT_ID);
    expect(fields.map((field) => field.source_field)).toEqual(EXPECTED_ORDER);
  });

  it("is the order of the registration form's fields, each with its show_on_form flag", async () => {
    const fields = await loadRegistrantFormFields(prisma, EVENT_ID);
    expect(fields.map((field) => field.source_field)).toEqual(EXPECTED_ORDER);
    expect(fields.map((field) => field.show_on_form)).toEqual([true, false, true, false, false, false, false, true]);
    expect(fields[0]).toEqual({
      label: "Diet",
      source_field: "diet",
      type: "text",
      required: true,
      show_on_form: true,
    });
  });

  it("is the order of the export columns", async () => {
    const { exportColumns } = await exportAttendeesCsv(prisma, EVENT_ID, { status: "all" });
    const labelsInOrder = EXPECTED_ORDER.map((key) => FIELDS.find((field) => field.source_field === key)!.label);
    expect(exportColumns.slice(EXPORT_BASE_COLUMNS.length)).toEqual(labelsInOrder);
  });

  it("returns no fields for an event that has none", async () => {
    expect(await loadEventCustomDataFields(prisma, EMPTY_EVENT_ID)).toEqual([]);
    expect(await loadRegistrantFormFields(prisma, EMPTY_EVENT_ID)).toEqual([]);
  });

  it("feeds buildRegistrantCustomData: only the fields on the form are read, and a required one must be answered", async () => {
    const fields = await loadRegistrantFormFields(prisma, EVENT_ID);
    // parking is off the form: its answer is dropped without an error.
    expect(buildRegistrantCustomData(fields, { diet: "vegan", parking: "yes", shirt: "L", arrival: "9:00" })).toEqual({
      diet: "vegan",
      shirt: "L",
      arrival: "9:00",
    });
    // diet is on the form and required.
    expect(() => buildRegistrantCustomData(fields, { shirt: "L" })).toThrow(RegistrantInputError);
  });
});
