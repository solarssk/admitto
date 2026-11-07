/**
 * Whose answer a question asks for (EventCustomField.applies_to) against a real, fully migrated database: the readers of
 * an attendee's own fields never see a question about a companion, so nothing changes for the guest when an event asks
 * about companions; and the registrant's boundary knows which questions are whose.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { EXPORT_BASE_COLUMNS, exportAttendeesCsv } from "../src/attendees-export.js";
import { loadEventCustomDataFields, loadRegistrantFormFields } from "../src/event-custom-fields.js";
import { buildRegistrantCustomData, pickRegistrantFormFields } from "../src/registrant-input.js";
import { resolveWalletCustomFieldPlaceholders } from "../src/wallet-custom-fields.js";
import { createMigratedDb, fixtures, type MigratedDb } from "./registration-fixtures.js";

let migrated: MigratedDb;
let db: PrismaClient;
let make: ReturnType<typeof fixtures>;

beforeAll(() => {
  migrated = createMigratedDb();
  db = migrated.db;
  make = fixtures(db);
}, 60_000);
afterAll(async () => {
  await migrated?.drop();
});

/** Two questions about the guest and two about the companion, interleaved in the one order of the registry. */
async function eventWithBothKinds() {
  const eventId = await make.event();
  const field = (source_field: string, display_order: number, extra: Record<string, unknown> = {}) => ({
    event_id: eventId,
    source_field,
    label: `Label ${source_field}`,
    display_order,
    show_on_form: true,
    ...extra,
  });
  await db.eventCustomField.createMany({
    data: [
      field("badge", 0, { applies_to: "companion" }),
      field("diet", 1, { type: "select", options: ["vegan", "none"] }),
      field("plate", 2, { applies_to: "companion", show_on_form: false }),
      field("shirt", 3),
    ],
  });
  return eventId;
}

const keys = (fields: readonly { source_field: string }[]) => fields.map((entry) => entry.source_field);

describe("loadEventCustomDataFields", () => {
  it("reads the guest's own questions when it is not told otherwise, which is what every caller has always read", async () => {
    const eventId = await eventWithBothKinds();
    expect(keys(await loadEventCustomDataFields(db, eventId))).toEqual(["diet", "shirt"]);
    expect(keys(await loadEventCustomDataFields(db, eventId, "guest"))).toEqual(["diet", "shirt"]);
  });

  it("reads the companion's questions on request, in the same order", async () => {
    const eventId = await eventWithBothKinds();
    expect(keys(await loadEventCustomDataFields(db, eventId, "companion"))).toEqual(["badge", "plate"]);
  });

  it("reads an event that asks nothing about a companion exactly as it did", async () => {
    const eventId = await make.event();
    await db.eventCustomField.createMany({
      data: [
        { event_id: eventId, source_field: "diet", label: "Diet" },
        { event_id: eventId, source_field: "size", label: "Size", type: "select", required: true, options: ["S", "M"] },
      ],
    });
    const expected = [
      { label: "Diet", source_field: "diet", type: "text" },
      { label: "Size", source_field: "size", type: "select", required: true, options: ["S", "M"] },
    ];
    expect(await loadEventCustomDataFields(db, eventId)).toEqual(expected);
    expect(await loadEventCustomDataFields(db, eventId, "companion")).toEqual([]);
  });
});

describe("loadRegistrantFormFields", () => {
  it("returns the questions of both audiences in the one order, and marks only those about a companion", async () => {
    const eventId = await eventWithBothKinds();
    const fields = await loadRegistrantFormFields(db, eventId);
    expect(keys(fields)).toEqual(["badge", "diet", "plate", "shirt"]);
    expect(fields.map((entry) => entry.applies_to)).toEqual(["companion", undefined, "companion", undefined]);
    // A guest's question is the object it has always been: no new key for code that compares or spreads it.
    for (const guest of fields.filter((entry) => entry.applies_to === undefined)) expect(guest).not.toHaveProperty("applies_to");
  });

  it("puts a question about a companion on the companion's form and never on the guest's", async () => {
    const fields = await loadRegistrantFormFields(db, await eventWithBothKinds());
    expect(keys(pickRegistrantFormFields(fields))).toEqual(["diet", "shirt"]);
    expect(keys(pickRegistrantFormFields(fields, "companion"))).toEqual(["badge"]);
  });

  it("reads no answer to a question about a companion from a guest, and none to a guest's question from a companion", async () => {
    const fields = await loadRegistrantFormFields(db, await eventWithBothKinds());
    const body = { diet: "vegan", shirt: "L", badge: "Companion", plate: "WA 1" };
    expect(buildRegistrantCustomData(fields, body)).toEqual({ diet: "vegan", shirt: "L" });
    expect(buildRegistrantCustomData(fields, body, "companion")).toEqual({ badge: "Companion" });
  });
});

describe("what reads the answers of an attendee", () => {
  it("leaves a question about a companion out of an export of the attendees", async () => {
    const eventId = await eventWithBothKinds();
    await make.attendee(eventId);
    const result = await exportAttendeesCsv(db, eventId, { status: "all" });
    expect(result.exportColumns).toEqual([...EXPORT_BASE_COLUMNS, "Label diet", "Label shirt"]);
    expect(result.csv).not.toContain("Label badge");
    expect(result.csv).not.toContain("Label plate");
  });

  it("does not offer a question about a companion to a wallet pass, and still offers the guest's", async () => {
    const eventId = await eventWithBothKinds();
    await db.eventCustomField.update({ where: { event_id_source_field: { event_id: eventId, source_field: "badge" } }, data: { type: "select", options: ["A"] } });
    const placeholders = await resolveWalletCustomFieldPlaceholders(
      db,
      eventId,
      { diet: "vegan", badge: "A" },
      { one: "custom:diet", two: "custom:badge" },
    );
    expect(placeholders).toEqual({ "custom:diet": "vegan" });
  });
});
