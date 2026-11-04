/**
 * Sensitive attendee fields (D-E6), the part that lives in @admitto/tickets: the rule that takes an answer out of a
 * value, the registry loaders that carry the flag, the export columns, the staff edit of a companion (a sensitive answer
 * is write-only), and the erasure, which already clears every row that can hold such an answer. The routes that use the
 * rule are tested in apps/web (sensitive-fields-routes.test.ts); the list of files that must use it is in
 * sensitive-fields-inventory.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@admitto/db";
import { writeAttendeeCompanion } from "../src/attendee-companion.js";
import { buildExportColumns, buildSanitizedExportRows, type ExportAttendeeSqlRow } from "../src/attendees-export.js";
import { eraseAttendees } from "../src/erase-attendees.js";
import { loadEventCustomDataFields, loadRegistrantFormFields } from "../src/event-custom-fields.js";
import {
  loadSensitiveCustomFields,
  redactSensitiveCustomData,
  redactSensitiveCustomDataList,
  sensitiveSourceFields,
  withoutBlankSensitiveEntries,
  withoutSensitiveFields,
} from "../src/sensitive-custom-data.js";
import type { EventItemContent } from "../src/types.js";
import { createMigratedDb, fixtures, type MigratedDb } from "./registration-fixtures.js";

const FIELDS = [
  { source_field: "diet", sensitive: true },
  { source_field: "shirt" },
  { source_field: "access", sensitive: false },
];

describe("redactSensitiveCustomData", () => {
  it("removes the answer to a sensitive field and keeps the others", () => {
    expect(redactSensitiveCustomData({ diet: "no gluten", shirt: "M", access: "ramp" }, FIELDS)).toEqual({ shirt: "M", access: "ramp" });
  });

  it("removes the key, so the shape does not say whether the question was answered", () => {
    const redacted = redactSensitiveCustomData({ diet: "x", shirt: "M" }, FIELDS);
    expect(Object.keys(redacted)).toEqual(["shirt"]);
    expect("diet" in redacted).toBe(false);
  });

  it("does not change the value it is given", () => {
    const stored = { diet: "no gluten", shirt: "M" };
    redactSensitiveCustomData(stored, FIELDS);
    expect(stored).toEqual({ diet: "no gluten", shirt: "M" });
  });

  it("returns what is not an object as it is", () => {
    expect(redactSensitiveCustomData(null, FIELDS)).toBeNull();
    expect(redactSensitiveCustomData(undefined, FIELDS)).toBeUndefined();
    expect(redactSensitiveCustomData("text", FIELDS)).toBe("text");
    expect(redactSensitiveCustomData(["diet"], FIELDS)).toEqual(["diet"]);
  });

  it("returns the same object when no field is sensitive", () => {
    const stored = { diet: "x" };
    expect(redactSensitiveCustomData(stored, [{ source_field: "diet" }, { source_field: "shirt", sensitive: false }])).toBe(stored);
  });

  it("treats a key like __proto__ as the plain key it is", () => {
    const stored = JSON.parse('{"__proto__": "x", "shirt": "M"}') as Record<string, unknown>;
    const redacted = redactSensitiveCustomData(stored, [{ source_field: "__proto__", sensitive: true }]);
    expect(Object.keys(redacted)).toEqual(["shirt"]);
  });

  it("redacts the entries of a list, and leaves a missing custom_data null", () => {
    const entries = [{ name: "A", custom_data: { diet: "x", shirt: "S" } }, { name: "B" }];
    expect(redactSensitiveCustomDataList(entries, FIELDS)).toEqual([
      { name: "A", custom_data: { shirt: "S" } },
      { name: "B", custom_data: null },
    ]);
  });
});

describe("the other helpers", () => {
  it("names the sensitive keys and drops the sensitive fields", () => {
    expect([...sensitiveSourceFields(FIELDS)]).toEqual(["diet"]);
    expect(withoutSensitiveFields(FIELDS).map((field) => field.source_field)).toEqual(["shirt", "access"]);
  });

  it("drops a staff edit that would only clear a sensitive answer, and keeps the rest", () => {
    expect(withoutBlankSensitiveEntries(FIELDS, { diet: null, shirt: null, access: "" })).toEqual({ shirt: null, access: "" });
    expect(withoutBlankSensitiveEntries(FIELDS, { diet: "", shirt: "L" })).toEqual({ shirt: "L" });
    expect(withoutBlankSensitiveEntries(FIELDS, { diet: "vegan" })).toEqual({ diet: "vegan" });
  });
});

describe("the columns of an export", () => {
  const fields: EventItemContent[] = [
    { source_field: "shirt", label: "Shirt" },
    { source_field: "diet", label: "Diet", sensitive: true },
  ];
  const row = {
    id: "a1",
    name: "Ann Example",
    email: "ann@example.com",
    company: null,
    department: null,
    custom_data: { shirt: "M", diet: "Zzyzx-sensitive-answer" },
    ticket_type: null,
    admitted_at: null,
  } as unknown as ExportAttendeeSqlRow;

  it("has no column for a sensitive field, and the plain one beside it stays", () => {
    const columns = buildExportColumns(fields);
    expect(columns).toContain("Shirt");
    expect(columns).not.toContain("Diet");
  });

  it("has no cell with the answer, so the cells stay as many as the columns", () => {
    const [exported] = buildSanitizedExportRows([row], fields, "UTC");
    expect(exported!.attribute_values).toEqual(["M"]);
    expect(JSON.stringify(exported)).not.toContain("Zzyzx-sensitive-answer");
    expect(buildExportColumns(fields)).toHaveLength(buildExportColumns([]).length + exported!.attribute_values.length);
  });
});

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

const field = (eventId: string, data: { source_field: string; applies_to?: string; sensitive?: boolean; required?: boolean }) =>
  db.eventCustomField.create({ data: { event_id: eventId, label: data.source_field, ...data } });

describe("the registry loaders", () => {
  it("carry the flag on a sensitive field and nothing on a plain one", async () => {
    const eventId = await make.event();
    await field(eventId, { source_field: "diet", sensitive: true });
    await field(eventId, { source_field: "shirt" });

    const loaded = await loadEventCustomDataFields(db, eventId);

    expect(loaded.find((entry) => entry.source_field === "diet")?.sensitive).toBe(true);
    expect(loaded.find((entry) => entry.source_field === "shirt")).not.toHaveProperty("sensitive");
    const form = await loadRegistrantFormFields(db, eventId);
    expect(form.find((entry) => entry.source_field === "diet")?.sensitive).toBe(true);
  });

  it("list the sensitive fields of both audiences, of this event only", async () => {
    const eventId = await make.event();
    const otherEvent = await make.event();
    await field(eventId, { source_field: "diet", sensitive: true });
    await field(eventId, { source_field: "mobility", applies_to: "companion", sensitive: true });
    await field(eventId, { source_field: "shirt" });
    await field(otherEvent, { source_field: "elsewhere", sensitive: true });

    const sensitive = await loadSensitiveCustomFields(db, eventId);

    expect(sensitive.map((entry) => entry.source_field).sort()).toEqual(["diet", "mobility"]);
  });

  it("is off for a field created without the flag", async () => {
    const eventId = await make.event();
    const created = await field(eventId, { source_field: "shirt" });
    expect(created.sensitive).toBe(false);
  });
});

describe("a staff edit of the companion", () => {
  async function companionWithAnswers(eventId: string, answers: Record<string, string>) {
    const guest = await make.attendee(eventId);
    await make.companion(guest.id, { name: "Cleo Example", customData: answers });
    return guest;
  }
  const edit = (eventId: string, attendeeId: string, customData: Record<string, string>, name = "Cleo Example") =>
    db.$transaction((tx) => writeAttendeeCompanion(tx, { eventId, attendeeId, name, customData }));
  const stored = async (attendeeId: string) => (await db.attendeeCompanion.findFirstOrThrow({ where: { attendee_id: attendeeId } })).custom_data;

  it("keeps the stored sensitive answer when the box is left empty, and still changes the plain one", async () => {
    const eventId = await make.event();
    await field(eventId, { source_field: "mobility", applies_to: "companion", sensitive: true });
    await field(eventId, { source_field: "shirt", applies_to: "companion" });
    const guest = await companionWithAnswers(eventId, { mobility: "wheelchair", shirt: "M" });

    const result = await edit(eventId, guest.id, { shirt: "L" });

    expect(result.outcome).toBe("written");
    expect(await stored(guest.id)).toEqual({ mobility: "wheelchair", shirt: "L" });
  });

  it("replaces the stored sensitive answer when a new one is typed", async () => {
    const eventId = await make.event();
    await field(eventId, { source_field: "mobility", applies_to: "companion", sensitive: true });
    const guest = await companionWithAnswers(eventId, { mobility: "wheelchair" });

    await edit(eventId, guest.id, { mobility: "cane" });

    expect(await stored(guest.id)).toEqual({ mobility: "cane" });
  });

  it("does not ask for a required sensitive answer that is stored already", async () => {
    const eventId = await make.event();
    await field(eventId, { source_field: "mobility", applies_to: "companion", sensitive: true, required: true });
    const guest = await companionWithAnswers(eventId, { mobility: "wheelchair" });

    const result = await edit(eventId, guest.id, {}, "Cleo Renamed");

    expect(result.outcome).toBe("written");
    expect(await stored(guest.id)).toEqual({ mobility: "wheelchair" });
    expect((await db.attendeeCompanion.findFirstOrThrow({ where: { attendee_id: guest.id } })).name).toBe("Cleo Renamed");
  });

  it("still asks for a required sensitive answer that was never given", async () => {
    const eventId = await make.event();
    await field(eventId, { source_field: "mobility", applies_to: "companion", sensitive: true, required: true });
    const guest = await make.attendee(eventId);
    await make.companion(guest.id, { name: "Cleo Example" });

    await expect(edit(eventId, guest.id, {})).rejects.toThrow();
  });

  it("still clears a plain answer that is left empty (only a sensitive one is write-only)", async () => {
    const eventId = await make.event();
    await field(eventId, { source_field: "shirt", applies_to: "companion" });
    const guest = await companionWithAnswers(eventId, { shirt: "M" });

    await edit(eventId, guest.id, {});

    expect(await stored(guest.id)).toBeNull();
  });
});

describe("erasing an attendee who gave a sensitive answer", () => {
  const MARKER = `Zzyzx-${randomUUID()}`;

  async function tablesHolding(marker: string): Promise<string[]> {
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`;
    const holding: string[] = [];
    for (const { table_name } of tables) {
      // A table name read from the catalog, never request content.
      const [row] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table_name}" t WHERE t::text LIKE $1`, `%${marker}%`);
      if (Number(row?.n ?? 0) > 0) holding.push(table_name);
    }
    return holding.sort();
  }

  it("clears the answer from the attendee, the companion, the registration and the registration's copy of the companion", async () => {
    const eventId = await make.event({ capacity: 2 });
    await field(eventId, { source_field: "diet", sensitive: true });
    await field(eventId, { source_field: "mobility", applies_to: "companion", sensitive: true });
    const guest = await make.attendee(eventId);
    await db.attendee.update({ where: { id: guest.id }, data: { custom_data: { diet: `vegan ${MARKER}` } } });
    await make.companion(guest.id, { name: "Cleo Example", customData: { mobility: `cane ${MARKER}` } });
    await make.registration(eventId, {
      status: "accepted",
      attendeeId: guest.id,
      email: guest.email,
      customData: { diet: `vegan ${MARKER}` },
      companions: [{ name: "Cleo Example", custom_data: { mobility: `cane ${MARKER}` } }],
    });
    expect(await tablesHolding(MARKER)).toEqual(["Attendee", "AttendeeCompanion", "Registration"]);

    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [guest.id] }));

    expect(await tablesHolding(MARKER)).toEqual([]);
  });
});
