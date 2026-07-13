import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { backfillEventCustomFields } from "../src/backfill-event-custom-fields.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-backfill-cf";

let prisma: PrismaClient;

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = new PrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "org-backfill-cf" },
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

describe("backfillEventCustomFields", () => {
  it("creates a registry row from a legacy item and rewrites its config", async () => {
    const event = await makeEvent("evt-cf-basic");
    const item = await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: {
          requires_return: false,
          contents: [{ label: "Shirt size", source_field: "shirt_size", required: true }],
        },
      },
    });

    const result = await backfillEventCustomFields(prisma);
    expect(result.itemsUpdated).toBeGreaterThanOrEqual(1);
    expect(result.fieldsCreated).toBeGreaterThanOrEqual(1);

    const field = await prisma.eventCustomField.findUnique({
      where: { event_id_source_field: { event_id: event.id, source_field: "shirt_size" } },
    });
    expect(field?.label).toBe("Shirt size");
    expect(field?.required).toBe(true);
    expect(field?.type).toBe("text");

    const itemAfter = await prisma.eventItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.config).toEqual({
      requires_return: false,
      content_fields: ["shirt_size"],
    });
  });

  it("does not overwrite a source_field that already has a registry row", async () => {
    const event = await makeEvent("evt-cf-existing");
    await prisma.eventCustomField.create({
      data: { event_id: event.id, source_field: "dietary", label: "Dietary (curated)", required: true },
    });
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "lunch",
        label: "Lunch",
        config: { contents: [{ label: "Dietary requirements", source_field: "dietary" }] },
      },
    });

    await backfillEventCustomFields(prisma);

    const field = await prisma.eventCustomField.findUnique({
      where: { event_id_source_field: { event_id: event.id, source_field: "dietary" } },
    });
    expect(field?.label).toBe("Dietary (curated)");
    expect(field?.required).toBe(true);
  });

  it("merges stricter metadata onto the first-registered field instead of dropping it", async () => {
    const event = await makeEvent("evt-cf-merge");
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Shirt size", source_field: "shirt_size", required: true }] },
      },
    });
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "polo",
        label: "Polo shirt",
        config: {
          contents: [{ label: "Shirt size (polo)", source_field: "shirt_size", type: "select", options: ["S", "M"] }],
        },
      },
    });

    const result = await backfillEventCustomFields(prisma);

    const fields = await prisma.eventCustomField.findMany({
      where: { event_id: event.id, source_field: "shirt_size" },
    });
    expect(fields).toHaveLength(1);
    expect(fields[0]!.label).toBe("Shirt size");
    expect(fields[0]!.required).toBe(true);
    expect(fields[0]!.type).toBe("select");
    expect(fields[0]!.options).toEqual(["S", "M"]);
    expect(result.conflicts.some((c) => c.includes("shirt_size"))).toBe(false);
  });

  it("intersects overlapping options from two select fields instead of picking one side", async () => {
    const event = await makeEvent("evt-cf-overlap");
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Size", source_field: "size", type: "select", options: ["S", "M", "L"] }] },
      },
    });
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "polo",
        label: "Polo shirt",
        config: { contents: [{ label: "Size (polo)", source_field: "size", type: "select", options: ["M", "L", "XL"] }] },
      },
    });

    const result = await backfillEventCustomFields(prisma);

    const field = await prisma.eventCustomField.findUnique({
      where: { event_id_source_field: { event_id: event.id, source_field: "size" } },
    });
    expect(field?.options).toEqual(["M", "L"]);
    expect(result.conflicts.some((c) => c.includes("size"))).toBe(false);
  });

  it("keeps the first item's select options when a later item redefines the field as plain text", async () => {
    const event = await makeEvent("evt-cf-select-then-text");
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Size", source_field: "size", type: "select", options: ["S", "M"] }] },
      },
    });
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "note",
        label: "Note",
        config: { contents: [{ label: "Size note", source_field: "size" }] },
      },
    });

    const result = await backfillEventCustomFields(prisma);

    const field = await prisma.eventCustomField.findUnique({
      where: { event_id_source_field: { event_id: event.id, source_field: "size" } },
    });
    expect(field?.type).toBe("select");
    expect(field?.options).toEqual(["S", "M"]);
    expect(result.conflicts.some((c) => c.includes("size"))).toBe(false);
  });

  it("upgrades a plain-text field to boolean when a later item declares it boolean", async () => {
    const event = await makeEvent("evt-cf-boolean");
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Lunch", source_field: "lunch" }] },
      },
    });
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "rsvp",
        label: "RSVP",
        config: { contents: [{ label: "Lunch?", source_field: "lunch", type: "boolean" }] },
      },
    });

    const result = await backfillEventCustomFields(prisma);

    const field = await prisma.eventCustomField.findUnique({
      where: { event_id_source_field: { event_id: event.id, source_field: "lunch" } },
    });
    expect(field?.type).toBe("boolean");
    expect(result.conflicts.some((c) => c.includes("lunch"))).toBe(false);
  });

  it("reports a conflict when a boolean and a select definition of the same field can't be reconciled", async () => {
    const event = await makeEvent("evt-cf-boolean-select-clash");
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "rsvp",
        label: "RSVP",
        config: { contents: [{ label: "Lunch?", source_field: "lunch", type: "boolean" }] },
      },
    });
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Lunch option", source_field: "lunch", type: "select", options: ["Veg", "Meat"] }] },
      },
    });

    const result = await backfillEventCustomFields(prisma);

    expect(result.conflicts.some((c) => c.includes("lunch"))).toBe(true);
  });

  it("reports a conflict and keeps the first item's options when two select fields share no options", async () => {
    const event = await makeEvent("evt-cf-irreconcilable");
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Size", source_field: "size", type: "select", options: ["S", "M"] }] },
      },
    });
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "polo",
        label: "Polo shirt",
        config: { contents: [{ label: "Size (polo)", source_field: "size", type: "select", options: ["XL"] }] },
      },
    });

    const result = await backfillEventCustomFields(prisma);

    const field = await prisma.eventCustomField.findUnique({
      where: { event_id_source_field: { event_id: event.id, source_field: "size" } },
    });
    expect(field?.options).toEqual(["S", "M"]);
    expect(result.conflicts.some((c) => c.includes("size"))).toBe(true);
  });

  it("skips a legacy field with an invalid or reserved source_field instead of migrating it", async () => {
    const event = await makeEvent("evt-cf-invalid");
    const item = await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: {
          contents: [
            { label: "Bad slug", source_field: "Not A Slug!" },
            { label: "Email copy", source_field: "email" },
            { label: "Shirt size", source_field: "shirt_size" },
          ],
        },
      },
    });

    await backfillEventCustomFields(prisma);

    const fields = await prisma.eventCustomField.findMany({ where: { event_id: event.id } });
    expect(fields.map((f) => f.source_field)).toEqual(["shirt_size"]);

    const itemAfter = await prisma.eventItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.config).toEqual({ content_fields: ["shirt_size"] });
  });

  it("skips malformed legacy content rows (wrong types, empty, or over-length) without crashing", async () => {
    const event = await makeEvent("evt-cf-malformed");
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: {
          contents: [
            "not an object",
            { label: 123, source_field: "x" },
            { label: "  ", source_field: "y" },
            { label: "Long", source_field: "a".repeat(61) },
            { label: "Long label".repeat(10), source_field: "z" },
            { label: "Shirt size", source_field: "shirt_size" },
          ],
        },
      },
    });

    await backfillEventCustomFields(prisma);

    const fields = await prisma.eventCustomField.findMany({ where: { event_id: event.id } });
    expect(fields.map((f) => f.source_field)).toEqual(["shirt_size"]);
  });

  it("stops creating new fields once an event reaches the per-event field cap", async () => {
    const event = await makeEvent("evt-cf-cap");
    await prisma.eventCustomField.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        event_id: event.id,
        source_field: `existing_${i}`,
        label: `Existing ${i}`,
      })),
    });
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
      },
    });

    const result = await backfillEventCustomFields(prisma);

    const field = await prisma.eventCustomField.findUnique({
      where: { event_id_source_field: { event_id: event.id, source_field: "shirt_size" } },
    });
    expect(field).toBeNull();
    expect(result.skipped.some((s) => s.includes("shirt_size"))).toBe(true);
  });

  it("leaves an item with no contents untouched", async () => {
    const event = await makeEvent("evt-cf-untouched");
    const item = await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "badge",
        label: "Badge",
        config: { issue_on_checkin: true },
      },
    });

    await backfillEventCustomFields(prisma);

    const itemAfter = await prisma.eventItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.config).toEqual({ issue_on_checkin: true });
  });

  it("is idempotent on second run", async () => {
    const event = await makeEvent("evt-cf-idempotent");
    await prisma.eventItem.create({
      data: {
        event_id: event.id,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
      },
    });

    await backfillEventCustomFields(prisma);
    const afterFirst = await prisma.eventCustomField.count({ where: { event_id: event.id } });

    const second = await backfillEventCustomFields(prisma);
    const afterSecond = await prisma.eventCustomField.count({ where: { event_id: event.id } });

    expect(afterSecond).toBe(afterFirst);
    // Nothing left with a `contents` key anywhere, so the second run touches this event's rows
    // for zero net new items/fields - it may still process unrelated already-migrated items from
    // earlier tests, but none of them have `contents` left either.
    expect(second.itemsUpdated).toBe(0);
  });
});
