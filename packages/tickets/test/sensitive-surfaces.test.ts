/**
 * Sensitive attendee fields (D-E6) on the surfaces an operator or a guest's phone sees: the check-in card and the content of an
 * item (`buildItemDetail`), the wallet pass, and the check of an item's `content_fields`. Each case has a sensitive question and
 * a plain one side by side: the plain one shows, the sensitive one does not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@admitto/db";
import { getAttendeeCard } from "../src/attendee-card.js";
import { buildItemDetail } from "../src/event-item-contents.js";
import { SensitiveContentFieldError, UnknownContentFieldError, validateContentFieldReferences } from "../src/event-custom-fields.js";
import { COMPANION_ITEM_KEY, ensureCompanionEventItem } from "../src/event-items.js";
import { WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX, resolveWalletCustomFieldPlaceholders, sensitiveWalletMappingFields } from "../src/wallet-custom-fields.js";
import type { EventItemContent } from "../src/types.js";
import { createMigratedDb, fixtures, type MigratedDb } from "./registration-fixtures.js";

const SENSITIVE_ANSWER = "Peanut allergy, carries an injector";
const PLAIN_ANSWER = "Size L";

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

type FieldSpec = { source_field: string; label: string; type: string; sensitive?: boolean; required?: boolean; options?: string[] };

/** An event with these questions about the guest, one item that shows `contentFields`, and a guest who answered every one. */
async function eventWithItem(fields: FieldSpec[], contentFields: string[], answers: Record<string, string>, itemConfig: Record<string, unknown> = {}) {
  const eventId = await make.event({ capacity: 20 });
  for (const field of fields) await db.eventCustomField.create({ data: { event_id: eventId, ...field } });
  await db.eventItem.create({
    data: { event_id: eventId, key: "gift", label: "Gift", enabled: true, config: { ...itemConfig, content_fields: contentFields } },
  });
  const attendee = await make.attendee(eventId, {});
  await db.attendee.update({ where: { id: attendee.id }, data: { custom_data: answers } });
  return { eventId, attendeeId: attendee.id };
}

const SHIRT: FieldSpec = { source_field: "shirt", label: "Shirt", type: "text" };
const HEALTH: FieldSpec = { source_field: "health", label: "Health", type: "text", sensitive: true };

async function giftHint(eventId: string, attendeeId: string): Promise<{ detail: string | undefined; card: string }> {
  const card = await getAttendeeCard(eventId, attendeeId, db);
  return { detail: card!.items.find((item) => item.key === "gift")!.detail, card: JSON.stringify(card) };
}

describe("the operator's check-in card", () => {
  it("shows a plain question's answer beside an item and leaves a sensitive one out, label and value", async () => {
    const { eventId, attendeeId } = await eventWithItem([SHIRT, HEALTH], ["shirt", "health"], { shirt: PLAIN_ANSWER, health: SENSITIVE_ANSWER });

    const { detail, card } = await giftHint(eventId, attendeeId);

    expect(detail).toBe(`Shirt: ${PLAIN_ANSWER}`);
    expect(card).not.toContain(SENSITIVE_ANSWER);
    expect(card).not.toContain("Health");
  });

  it("says nothing for an item whose only question is sensitive, and no dash for a required one that was not answered", async () => {
    const onlyHealth = await eventWithItem([HEALTH], ["health"], { health: SENSITIVE_ANSWER });
    expect((await giftHint(onlyHealth.eventId, onlyHealth.attendeeId)).detail).toBeUndefined();

    const required = await eventWithItem([{ ...HEALTH, required: true }, SHIRT], ["health", "shirt"], { shirt: PLAIN_ANSWER });
    expect((await giftHint(required.eventId, required.attendeeId)).detail).toBe(`Shirt: ${PLAIN_ANSWER}`);
  });

  it("stops showing a question that became sensitive after an item was set to show it", async () => {
    const { eventId, attendeeId } = await eventWithItem([SHIRT, { source_field: "diet", label: "Diet", type: "text" }], ["shirt", "diet"], {
      shirt: PLAIN_ANSWER,
      diet: SENSITIVE_ANSWER,
    });
    expect((await giftHint(eventId, attendeeId)).detail).toBe(`Shirt: ${PLAIN_ANSWER} · Diet: ${SENSITIVE_ANSWER}`);

    await db.eventCustomField.updateMany({ where: { event_id: eventId, source_field: "diet" }, data: { sensitive: true } });

    const { detail, card } = await giftHint(eventId, attendeeId);
    expect(detail).toBe(`Shirt: ${PLAIN_ANSWER}`);
    expect(card).not.toContain(SENSITIVE_ANSWER);
  });

  it("keeps the companion's name on the hint of an item for guests with a companion, and still leaves a sensitive question out", async () => {
    const { eventId, attendeeId } = await eventWithItem([SHIRT, HEALTH], [], {});
    await ensureCompanionEventItem(eventId, db);
    await db.eventItem.updateMany({
      where: { event_id: eventId, key: COMPANION_ITEM_KEY },
      data: { config: { audience: "with_companion", requires_return: false, content_fields: ["shirt", "health"] } },
    });
    await make.companion(attendeeId, { name: "Companion Example" });
    await db.attendee.update({ where: { id: attendeeId }, data: { custom_data: { shirt: PLAIN_ANSWER, health: SENSITIVE_ANSWER } } });

    const card = await getAttendeeCard(eventId, attendeeId, db);

    expect(card!.items.find((item) => item.key === COMPANION_ITEM_KEY)!.detail).toBe(`Companion Example · Shirt: ${PLAIN_ANSWER}`);
    expect(JSON.stringify(card)).not.toContain(SENSITIVE_ANSWER);
  });
});

describe("buildItemDetail", () => {
  const registry = new Map<string, EventItemContent>([
    ["shirt", { label: "Shirt", source_field: "shirt", type: "text" }],
    ["health", { label: "Health", source_field: "health", type: "text", sensitive: true }],
  ]);

  it("skips a field the registry marks sensitive, whatever the config lists and the answers hold", () => {
    expect(buildItemDetail({ content_fields: ["health", "shirt"] }, { health: SENSITIVE_ANSWER, shirt: "L" }, registry)).toBe("Shirt: L");
    expect(buildItemDetail({ content_fields: ["health"] }, { health: SENSITIVE_ANSWER }, registry)).toBeUndefined();
  });
});

describe("a check of an item's content_fields", () => {
  it("refuses a sensitive question, and still refuses an unknown one first", () => {
    const allowed = new Set(["shirt", "health"]);
    expect(() => validateContentFieldReferences(allowed, ["shirt"], new Set(["health"]))).not.toThrow();
    expect(() => validateContentFieldReferences(allowed, ["shirt", "health"], new Set(["health"]))).toThrow(SensitiveContentFieldError);
    expect(() => validateContentFieldReferences(allowed, ["gone", "health"], new Set(["health"]))).toThrow(UnknownContentFieldError);
    expect(() => validateContentFieldReferences(allowed, ["health"])).not.toThrow();
  });
});

describe("the wallet pass", () => {
  const SELECT_PLAIN: FieldSpec = { source_field: "tshirt", label: "T-shirt", type: "select", options: ["S", "M"] };
  const SELECT_SENSITIVE: FieldSpec = { source_field: "allergy", label: "Allergy", type: "select", options: ["Nuts", "None"], sensitive: true };
  const BOOLEAN_SENSITIVE: FieldSpec = { source_field: "wheelchair", label: "Wheelchair", type: "boolean", sensitive: true };
  const MAPPING = { shirt: "custom:tshirt", allergy: "custom:allergy", chair: "custom:wheelchair" };

  it("carries a plain question's answer and leaves a sensitive one out, even when the saved mapping still names it", async () => {
    const eventId = await make.event();
    for (const field of [SELECT_PLAIN, SELECT_SENSITIVE, BOOLEAN_SENSITIVE]) await db.eventCustomField.create({ data: { event_id: eventId, ...field } });

    const placeholders = await resolveWalletCustomFieldPlaceholders(db, eventId, { tshirt: "M", allergy: "Nuts", wheelchair: "true" }, MAPPING);

    expect(placeholders).toEqual({ [`${WALLET_CUSTOM_FIELD_PLACEHOLDER_PREFIX}tshirt`]: "M" });
    expect(JSON.stringify(placeholders)).not.toContain("Nuts");
  });

  it("puts a question on the pass again if it stops being sensitive", async () => {
    const eventId = await make.event();
    await db.eventCustomField.create({ data: { event_id: eventId, ...SELECT_SENSITIVE } });
    expect(await resolveWalletCustomFieldPlaceholders(db, eventId, { allergy: "Nuts" }, MAPPING)).toEqual({});

    await db.eventCustomField.updateMany({ where: { event_id: eventId }, data: { sensitive: false } });

    expect(await resolveWalletCustomFieldPlaceholders(db, eventId, { allergy: "Nuts" }, MAPPING)).toEqual({ "custom:allergy": "Nuts" });
  });

  it("names the sensitive fields a mapping points at, once each, and none for a fixed placeholder", () => {
    const sensitive = [{ source_field: "allergy", sensitive: true }, { source_field: "wheelchair", sensitive: true }];
    expect(sensitiveWalletMappingFields(MAPPING, sensitive)).toEqual(["allergy", "wheelchair"]);
    expect(sensitiveWalletMappingFields({ a: "custom:allergy", b: "custom:allergy", c: "email", d: "custom:tshirt" }, sensitive)).toEqual(["allergy"]);
    expect(sensitiveWalletMappingFields({ c: "email" }, sensitive)).toEqual([]);
    expect(sensitiveWalletMappingFields(MAPPING, [])).toEqual([]);
  });
});

describe("the readers of the answers a resolved ticket carries", () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const READERS = /\b(?:display|resolved|ticket)\.attendee\.custom_data\b/;

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return ["node_modules", "dist", "generated", "test"].includes(entry) ? [] : files(full);
      return /\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  it("are the wallet pass builders, each of which hands the answers to resolveWalletCustomFieldPlaceholders", () => {
    const readers = ["apps/web/src", "packages"]
      .flatMap((root) => files(path.join(ROOT, root)))
      .filter((file) => READERS.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
      .sort();

    expect(readers).toEqual(["apps/web/src/admin/attendees-api-routes.ts", "apps/web/src/app.ts", "packages/tickets/src/reissue-wallet-pass.ts"]);
    for (const reader of readers) {
      const text = readFileSync(path.join(ROOT, reader), "utf8");
      expect(text).toMatch(/resolveWalletCustomFieldPlaceholders\([^)]*display\.attendee\.custom_data/s);
    }
  });
});
