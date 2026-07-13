import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  UnknownContentFieldError,
  loadEventCustomDataFields,
  validateContentFieldReferences,
} from "../src/event-custom-fields.js";

describe("loadEventCustomDataFields", () => {
  let prisma: PrismaClient;
  const EVENT_ID = "test-event-load-custom-fields";

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.organization.upsert({
      where: { id: "org_load_custom_fields" },
      create: { id: "org_load_custom_fields", name: "Load Custom Fields", slug: "load-custom-fields" },
      update: {},
    });
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      create: {
        id: EVENT_ID,
        title: "Load Custom Fields Event",
        slug: "load-custom-fields-event",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: "org_load_custom_fields",
      },
      update: {},
    });
    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.eventCustomField.createMany({
      data: [
        { event_id: EVENT_ID, source_field: "dietary", label: "Dietary requirements" },
        {
          event_id: EVENT_ID,
          source_field: "shirt_size",
          label: "Shirt size",
          type: "select",
          required: true,
          options: ["S", "M", "L"],
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.eventCustomField.deleteMany({ where: { event_id: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } });
    await prisma.organization.delete({ where: { id: "org_load_custom_fields" } });
    await prisma.$disconnect();
  });

  it("maps registry rows, including a select field's options and required flag", async () => {
    const fields = await loadEventCustomDataFields(prisma, EVENT_ID);
    expect(fields).toEqual([
      { label: "Dietary requirements", source_field: "dietary", type: "text" },
      {
        label: "Shirt size",
        source_field: "shirt_size",
        type: "select",
        required: true,
        options: ["S", "M", "L"],
      },
    ]);
  });

  it("returns an empty array for an event with no custom fields", async () => {
    const otherEventId = "test-event-load-custom-fields-empty";
    await prisma.event.upsert({
      where: { id: otherEventId },
      create: {
        id: otherEventId,
        title: "No fields",
        slug: "load-custom-fields-empty-event",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: "org_load_custom_fields",
      },
      update: {},
    });
    const fields = await loadEventCustomDataFields(prisma, otherEventId);
    expect(fields).toEqual([]);
    await prisma.event.delete({ where: { id: otherEventId } });
  });
});

describe("validateContentFieldReferences", () => {
  it("passes when every content_fields entry is in the allowed set", () => {
    expect(() =>
      validateContentFieldReferences(new Set(["shirt_size", "dietary"]), ["shirt_size"]),
    ).not.toThrow();
  });

  it("passes for an empty content_fields list regardless of the allowed set", () => {
    expect(() => validateContentFieldReferences(new Set(), [])).not.toThrow();
  });

  it("throws UnknownContentFieldError for a reference not in the allowed set", () => {
    expect(() => validateContentFieldReferences(new Set(["shirt_size"]), ["dietary"])).toThrow(
      UnknownContentFieldError,
    );
  });

  it("error carries the offending source_field", () => {
    try {
      validateContentFieldReferences(new Set(), ["deleted_field"]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownContentFieldError);
      expect((err as UnknownContentFieldError).sourceField).toBe("deleted_field");
      expect((err as Error).message).toBe("unknown_content_field:deleted_field");
    }
  });

  it("checks every entry, not just the first", () => {
    expect(() =>
      validateContentFieldReferences(new Set(["a", "b"]), ["a", "b", "c"]),
    ).toThrow(UnknownContentFieldError);
  });
});
