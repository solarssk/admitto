import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { exportAttendeesCsv } from "../src/attendees-export.js";
import { countFilteredAttendees, findFilteredAttendeesForList } from "../src/attendees-list-filters.js";
import { loadEventCustomDataFields, loadRegistrantFormFields } from "../src/event-custom-fields.js";
import { RegistrantInputError, buildRegistrantCustomData } from "../src/registrant-input.js";
import { buildCustomDataFromInput } from "../src/validate-custom-data.js";

const ORG_ID = "org_custom_field_types";
const EVENT_ID = "test-event-custom-field-types";

// The fields of one event, one per answer type, with the rules a stored row can hold. Created in this
// order (display_order), so the loaders and the export columns come out in it too.
const FIELDS = [
  { source_field: "notes", label: "Notes", type: "long_text", show_on_form: true },
  { source_field: "arrival", label: "Arrival date", type: "date", show_on_form: true },
  { source_field: "arrives_at", label: "Arrival time", type: "datetime", show_on_form: true },
  {
    source_field: "phone",
    label: "Mobile phone",
    type: "phone",
    required: true,
    show_on_form: true,
    rules: { min_length: 9, example: "+48 600 100 200" },
  },
  {
    source_field: "plate",
    label: "Plate",
    type: "text",
    show_on_form: true,
    rules: { digits_only: true, min_length: 3, max_length: 6, example: "123456" },
  },
  { source_field: "diet", label: "Diet", type: "text", show_on_form: false },
  // A value that is not a rules object: written by hand, or by a version that knows more rules.
  { source_field: "legacy", label: "Legacy", type: "text", show_on_form: true, rules: { pattern: "^a$" } },
];

describe("the answer types and rules of the registry (DB)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.organization.upsert({
      where: { id: ORG_ID },
      create: { id: ORG_ID, name: "Custom Field Types", slug: "custom-field-types" },
      update: {},
    });
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      create: {
        id: EVENT_ID,
        title: "Custom Field Types Event",
        slug: "custom-field-types-event",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: ORG_ID,
      },
      update: {},
    });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.eventCustomField.createMany({
      data: FIELDS.map((field, index) => ({ ...field, event_id: EVENT_ID, display_order: index })),
    });
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-types-1",
          event_id: EVENT_ID,
          name: "Guest One",
          email: "types-one@example.com",
          custom_data: {
            notes: 'Two seats, "front row".\nThank you.',
            arrival: "2026-11-04",
            arrives_at: "2026-11-04T10:30",
            phone: "+48600100200",
            plate: "123456",
          },
        },
        {
          id: "att-types-2",
          event_id: EVENT_ID,
          name: "Guest Two",
          email: "types-two@example.com",
          custom_data: { arrival: "2026-12-24", phone: "600100300", diet: "+cmd|' /C calc'!A0" },
        },
        {
          // Written when the field was still free text, before it became a phone field.
          id: "att-types-3",
          event_id: EVENT_ID,
          name: "Guest Three",
          email: "types-three@example.com",
          custom_data: { phone: "+cmd|' /C calc'!A0" },
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } });
    await prisma.organization.delete({ where: { id: ORG_ID } });
    await prisma.$disconnect();
  });

  it("loads each type and its rules into the field definitions, and no rules key for a field without", async () => {
    const fields = await loadEventCustomDataFields(prisma, EVENT_ID);
    expect(fields.map((field) => [field.source_field, field.type])).toEqual([
      ["notes", "long_text"],
      ["arrival", "date"],
      ["arrives_at", "datetime"],
      ["phone", "phone"],
      ["plate", "text"],
      ["diet", "text"],
      ["legacy", "text"],
    ]);
    expect(fields.find((field) => field.source_field === "phone")?.rules).toEqual({
      min_length: 9,
      example: "+48 600 100 200",
    });
    expect(fields.find((field) => field.source_field === "plate")?.rules).toEqual({
      digits_only: true,
      min_length: 3,
      max_length: 6,
      example: "123456",
    });
    expect(fields.find((field) => field.source_field === "notes")).toEqual({
      label: "Notes",
      source_field: "notes",
      type: "long_text",
    });
  });

  it("reads rules it cannot understand as no rules, so the field still loads", async () => {
    const fields = await loadEventCustomDataFields(prisma, EVENT_ID);
    expect(fields.find((field) => field.source_field === "legacy")).toEqual({
      label: "Legacy",
      source_field: "legacy",
      type: "text",
    });
  });

  it("hands the registration form the same types and rules, each with its show_on_form flag", async () => {
    const fields = await loadRegistrantFormFields(prisma, EVENT_ID);
    const phone = fields.find((field) => field.source_field === "phone");
    expect(phone).toEqual({
      label: "Mobile phone",
      source_field: "phone",
      type: "phone",
      required: true,
      rules: { min_length: 9, example: "+48 600 100 200" },
      show_on_form: true,
    });
    expect(fields.find((field) => field.source_field === "diet")?.show_on_form).toBe(false);
  });

  it("gives a guest the validation errors of the stored types and rules", async () => {
    const fields = await loadRegistrantFormFields(prisma, EVENT_ID);
    const answers = { phone: "+48 600 100 200", arrival: "2026-11-04", plate: "1234", notes: "Two seats,\r\nplease." };

    expect(buildRegistrantCustomData(fields, answers)).toEqual({
      phone: "+48600100200",
      arrival: "2026-11-04",
      plate: "1234",
      notes: "Two seats,\nplease.",
    });
    for (const bad of [
      { phone: "600 100" },
      { arrival: "2026-02-30" },
      { arrives_at: "2026-11-04T10:30Z" },
      { plate: "12" },
      { plate: "1234a" },
      { notes: "a".repeat(1001) },
    ]) {
      expect(() => buildRegistrantCustomData(fields, { ...answers, ...bad })).toThrow(RegistrantInputError);
    }
  });

  it("gives staff the same validation, and refuses a text answer over 100 characters like a guest is", async () => {
    const fields = await loadEventCustomDataFields(prisma, EVENT_ID);
    expect(buildCustomDataFromInput(fields, { phone: "(22) 123-45-67 ", diet: "d".repeat(100) })).toEqual({
      phone: "221234567",
      diet: "d".repeat(100),
    });
    expect(() => buildCustomDataFromInput(fields, { phone: "600100200", diet: "d".repeat(101) })).toThrow(
      "validation_failed:diet",
    );
    expect(() => buildCustomDataFromInput(fields, { phone: "12" })).toThrow("invalid_custom_data_value:phone");
    expect(() => buildCustomDataFromInput(fields, { phone: "600100200", plate: "12" })).toThrow(
      "invalid_custom_data_value:plate",
    );
  });

  it("exports each type's answers as stored, one cell each", async () => {
    const { csv, exportRows } = await exportAttendeesCsv(prisma, EVENT_ID, { status: "all" });
    const one = exportRows.find((row) => row.name === "Guest One");
    expect(one?.attribute_values).toEqual([
      'Two seats, "front row".\nThank you.',
      "2026-11-04",
      "2026-11-04T10:30",
      "+48600100200",
      "123456",
      "",
      "",
    ]);
    // The line break and the quotes of a long text stay inside one quoted cell.
    expect(csv).toContain('"Two seats, ""front row"".\nThank you."');
    // A phone number is exported as stored, with its +; the same text elsewhere keeps the formula guard.
    expect(csv).toContain('"+48600100200"');
    expect(exportRows.find((row) => row.name === "Guest Two")?.attribute_values[5]).toBe("'+cmd|' /C calc'!A0");
    // A value that is no phone number (written before the field became one) is still guarded.
    expect(exportRows.find((row) => row.name === "Guest Three")?.attribute_values[3]).toBe("'+cmd|' /C calc'!A0");
  });

  it("filters the Attendees list by the text a date, a date and time, a phone number or a long text contains", async () => {
    const names = async (source_field: string, text: string) =>
      (await findFilteredAttendeesForList(prisma, EVENT_ID, { status: "all", customFields: [{ source_field, type: "text", text }] }, 1, 25))
        .map((row) => row.name)
        .sort();

    expect(await names("arrival", "2026-11")).toEqual(["Guest One"]);
    expect(await names("arrival", "2026-1")).toEqual(["Guest One", "Guest Two"]);
    expect(await names("arrives_at", "T10:30")).toEqual(["Guest One"]);
    expect(await names("phone", "+48600")).toEqual(["Guest One"]);
    expect(await names("phone", "6001003")).toEqual(["Guest Two"]);
    expect(await names("notes", "front row")).toEqual(["Guest One"]);
    expect(
      await countFilteredAttendees(prisma, EVENT_ID, { status: "all", customFields: [{ source_field: "arrival", type: "text", text: "2027" }] }),
    ).toBe(0);
  });
});
