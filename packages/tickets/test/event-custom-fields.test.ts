import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  UnknownContentFieldError,
  ContentFieldAlreadyAssignedError,
  loadEventCustomDataFields,
  validateContentFieldReferences,
  findConflictingContentField,
  assertContentFieldsNotAssignedElsewhere,
} from "../src/event-custom-fields.js";

describe("loadEventCustomDataFields", () => {
  let prisma: PrismaClient;
  const EVENT_ID = "test-event-load-custom-fields";

  beforeAll(async () => {
    prisma = createTestPrismaClient();
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

  it("resolves same-created_at ties by ascending id, not query-plan-dependent scan order", async () => {
    const tieEventId = "test-event-load-custom-fields-tie";
    await prisma.event.upsert({
      where: { id: tieEventId },
      create: {
        id: tieEventId,
        title: "Tie Event",
        slug: "load-custom-fields-tie-event",
        date: new Date("2026-09-01T09:00:00Z"),
        organization_id: "org_load_custom_fields",
      },
      update: {},
    });
    // A single createMany statement evaluates now() once, so every row below shares the same
    // created_at - the scenario the (created_at, id) tiebreaker exists for.
    const created = await prisma.eventCustomField.createManyAndReturn({
      data: [
        { event_id: tieEventId, source_field: "field_c", label: "Field C" },
        { event_id: tieEventId, source_field: "field_a", label: "Field A" },
        { event_id: tieEventId, source_field: "field_b", label: "Field B" },
      ],
    });
    const timestamps = new Set(created.map((row) => row.created_at.getTime()));
    expect(timestamps.size).toBe(1); // sanity check: the tie scenario is actually exercised

    const expectedOrder = [...created].sort((a, b) => (a.id < b.id ? -1 : 1)).map((row) => row.source_field);

    const fields = await loadEventCustomDataFields(prisma, tieEventId);
    expect(fields.map((f) => f.source_field)).toEqual(expectedOrder);

    await prisma.eventCustomField.deleteMany({ where: { event_id: tieEventId } });
    await prisma.event.delete({ where: { id: tieEventId } });
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

describe("findConflictingContentField", () => {
  it("returns null for an empty content_fields list regardless of sibling items", () => {
    expect(
      findConflictingContentField(
        [{ key: "giftbag", label: "Gift bag", config: { content_fields: ["shirt_size"] } }],
        [],
      ),
    ).toBeNull();
  });

  it("returns null when there are no sibling items", () => {
    expect(findConflictingContentField([], ["shirt_size"])).toBeNull();
  });

  it("returns null when no sibling item references any of the candidate fields", () => {
    expect(
      findConflictingContentField(
        [{ key: "giftbag", label: "Gift bag", config: { content_fields: ["dietary"] } }],
        ["shirt_size"],
      ),
    ).toBeNull();
  });

  it("returns the conflicting field and the sibling item that already has it", () => {
    expect(
      findConflictingContentField(
        [{ key: "giftbag", label: "Gift bag", config: { content_fields: ["shirt_size"] } }],
        ["shirt_size"],
      ),
    ).toEqual({ sourceField: "shirt_size", itemKey: "giftbag", itemLabel: "Gift bag" });
  });

  it("checks every sibling item, not just the first", () => {
    expect(
      findConflictingContentField(
        [
          { key: "badge", label: "Badge", config: { content_fields: ["dietary"] } },
          { key: "giftbag", label: "Gift bag", config: { content_fields: ["shirt_size"] } },
        ],
        ["shirt_size"],
      ),
    ).toEqual({ sourceField: "shirt_size", itemKey: "giftbag", itemLabel: "Gift bag" });
  });

  it("tolerates a sibling with null config or a non-array content_fields", () => {
    expect(
      findConflictingContentField(
        [
          { key: "badge", label: "Badge", config: null },
          { key: "socks", label: "Socks", config: { content_fields: "not-an-array" } },
        ],
        ["shirt_size"],
      ),
    ).toBeNull();
  });

  it("skips a non-string entry within content_fields but still catches a real match", () => {
    expect(
      findConflictingContentField(
        [{ key: "giftbag", label: "Gift bag", config: { content_fields: [123, "shirt_size"] } }],
        ["shirt_size"],
      ),
    ).toEqual({ sourceField: "shirt_size", itemKey: "giftbag", itemLabel: "Gift bag" });
  });
});

describe("assertContentFieldsNotAssignedElsewhere", () => {
  it("passes when findConflictingContentField would return null", () => {
    expect(() =>
      assertContentFieldsNotAssignedElsewhere(
        [{ key: "giftbag", label: "Gift bag", config: { content_fields: ["dietary"] } }],
        ["shirt_size"],
      ),
    ).not.toThrow();
  });

  it("throws ContentFieldAlreadyAssignedError carrying the conflict details", () => {
    try {
      assertContentFieldsNotAssignedElsewhere(
        [{ key: "giftbag", label: "Gift bag", config: { content_fields: ["shirt_size"] } }],
        ["shirt_size"],
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ContentFieldAlreadyAssignedError);
      const typed = err as ContentFieldAlreadyAssignedError;
      expect(typed.sourceField).toBe("shirt_size");
      expect(typed.itemKey).toBe("giftbag");
      expect(typed.itemLabel).toBe("Gift bag");
      expect(typed.message).toBe("content_field_already_assigned:shirt_size");
    }
  });
});
