import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { loadEventCustomDataFields, loadRegistrantFormFields } from "../src/event-custom-fields.js";
import { RegistrantInputError, buildRegistrantCustomData } from "../src/registrant-input.js";
import { attendeeCustomDataFromAnswers } from "../src/registration-attendee.js";
import { assertCustomDataMeetsRequirements, buildCustomDataFromInput } from "../src/validate-custom-data.js";

const ORG_ID = "org_custom_field_conditions";
const EVENT_ID = "test-event-custom-field-conditions";

// Four fields as the admin API stores them: a yes/no question and the plate that is asked only for Yes, a diet with
// suggestions and an icon, and a field whose rules a hand edit left unreadable (an icon the list does not have).
const FIELDS = [
  { source_field: "parking", label: "Parking", type: "boolean", show_on_form: true, rules: { icon: "parking" } },
  {
    source_field: "plate",
    label: "Plate",
    type: "text",
    required: true,
    show_on_form: true,
    rules: { icon: "car", max_length: 10, show_when: { field: "parking", value: true } },
  },
  {
    source_field: "diet",
    label: "Diet",
    type: "text",
    show_on_form: true,
    rules: { icon: "food", suggestions: ["Vegan", "Vegetarian"] },
  },
  { source_field: "broken", label: "Broken", type: "text", show_on_form: true, rules: { icon: "rocket", show_when: { field: "parking", value: true } } },
];

describe("the icon, suggestions and condition of the registry (DB)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.organization.upsert({
      where: { id: ORG_ID },
      create: { id: ORG_ID, name: "Custom Field Conditions", slug: "custom-field-conditions" },
      update: {},
    });
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      create: {
        id: EVENT_ID,
        title: "Custom Field Conditions Event",
        slug: "custom-field-conditions-event",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: ORG_ID,
      },
      update: {},
    });
    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.eventCustomField.createMany({
      data: FIELDS.map((field, index) => ({ ...field, event_id: EVENT_ID, display_order: index })),
    });
  });

  afterAll(async () => {
    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } });
    await prisma.organization.delete({ where: { id: ORG_ID } });
    await prisma.$disconnect();
  });

  it("loads the icon, the condition and the suggestions into the field definitions", async () => {
    const fields = await loadEventCustomDataFields(prisma, EVENT_ID);
    expect(fields.find((field) => field.source_field === "parking")?.rules).toEqual({ icon: "parking" });
    expect(fields.find((field) => field.source_field === "plate")?.rules).toEqual({
      icon: "car",
      max_length: 10,
      show_when: { field: "parking", value: true },
    });
    expect(fields.find((field) => field.source_field === "diet")?.rules).toEqual({
      icon: "food",
      suggestions: ["Vegan", "Vegetarian"],
    });
  });

  it("reads rules with an icon that is not on the list as none, so the field is asked always", async () => {
    const fields = await loadEventCustomDataFields(prisma, EVENT_ID);
    expect(fields.find((field) => field.source_field === "broken")).toEqual({ label: "Broken", source_field: "broken", type: "text" });
  });

  it("hands the registration form the same rules", async () => {
    const fields = await loadRegistrantFormFields(prisma, EVENT_ID);
    expect(fields.find((field) => field.source_field === "plate")).toMatchObject({
      required: true,
      show_on_form: true,
      rules: { show_when: { field: "parking", value: true } },
    });
  });

  it("asks a guest the plate only for parking, and requires it only then", async () => {
    const fields = await loadRegistrantFormFields(prisma, EVENT_ID);
    expect(buildRegistrantCustomData(fields, { parking: true, plate: "WA 12345" })).toEqual({ parking: "true", plate: "WA 12345" });
    expect(buildRegistrantCustomData(fields, { parking: false })).toEqual({ parking: "false" });
    expect(buildRegistrantCustomData(fields, {})).toBeUndefined();
    expect(() => buildRegistrantCustomData(fields, { parking: true })).toThrow(RegistrantInputError);
  });

  it("drops a guest's plate when there is no parking, however it is sent", async () => {
    const fields = await loadRegistrantFormFields(prisma, EVENT_ID);
    for (const answers of [
      { parking: false, plate: "WA 12345" },
      { plate: "WA 12345" },
      { parking: false, plate: "x".repeat(5000) },
      { parking: "no", plate: 5 },
      { parking: null, plate: ["WA"] },
    ]) {
      const stored = buildRegistrantCustomData(fields, answers);
      expect(stored?.plate, JSON.stringify(answers).slice(0, 60)).toBeUndefined();
    }
  });

  it("gives staff the same: the plate is not asked without parking, and is asked with it", async () => {
    const fields = await loadEventCustomDataFields(prisma, EVENT_ID);
    expect(buildCustomDataFromInput(fields, { parking: "no", plate: "WA 12345" })).toEqual({ parking: "false" });
    expect(() => buildCustomDataFromInput(fields, { parking: "yes" })).toThrow("required_custom_data_field_missing:plate");
    expect(() => assertCustomDataMeetsRequirements(fields, { parking: "false" })).not.toThrow();
    expect(() => assertCustomDataMeetsRequirements(fields, { parking: "true" })).toThrow("required_custom_data_field_missing:plate");
  });

  it("copies the answers of a registration as they are stored when the guest is accepted, whatever the condition says now", async () => {
    // The guest answered while the plate was asked. The organiser then changed the condition: nothing is dropped
    // behind the guest's back, and the field being required is not checked again either.
    const fields = await loadEventCustomDataFields(prisma, EVENT_ID);
    expect(attendeeCustomDataFromAnswers(fields, { parking: "false", plate: "WA 12345" })).toEqual({ parking: "false", plate: "WA 12345" });
    expect(attendeeCustomDataFromAnswers(fields, { parking: "false" })).toEqual({ parking: "false" });
  });
});
