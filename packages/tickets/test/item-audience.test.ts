/**
 * The rule of which items an attendee is offered (itemAppliesToAttendee), the helpers that read the companion for it, and a
 * guard on the code that lists an attendee's items: each reader applies the rule, or says why it does not.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  attendeeIdsWithCompanion,
  EVENT_ITEM_AUDIENCES,
  filterItemsForAttendee,
  isCompanionAudience,
  itemAppliesToAttendee,
} from "../src/item-audience.js";

describe("itemAppliesToAttendee", () => {
  it("offers an item for guests with a companion to those who have one, and to nobody else", () => {
    expect(itemAppliesToAttendee({ audience: "with_companion" }, true)).toBe(true);
    expect(itemAppliesToAttendee({ audience: "with_companion" }, false)).toBe(false);
  });

  it("offers every other item to everyone: 'all', no audience, no config at all", () => {
    for (const config of [{ audience: "all" as const }, {}, { requires_return: true }, null, undefined]) {
      expect(itemAppliesToAttendee(config, true)).toBe(true);
      expect(itemAppliesToAttendee(config, false)).toBe(true);
    }
  });

  it("reads an audience it does not know as 'all', so that a value from the future never hides an item", () => {
    const unknown = { audience: "vip" } as never;
    expect(itemAppliesToAttendee(unknown, false)).toBe(true);
    expect(isCompanionAudience(unknown)).toBe(false);
  });

  it("knows exactly the two audiences the item routes accept", () => {
    expect([...EVENT_ITEM_AUDIENCES]).toEqual(["all", "with_companion"]);
  });
});

describe("isCompanionAudience", () => {
  it("is true only for an item for guests with a companion", () => {
    expect(isCompanionAudience({ audience: "with_companion" })).toBe(true);
    expect(isCompanionAudience({ audience: "all" })).toBe(false);
    expect(isCompanionAudience({})).toBe(false);
    expect(isCompanionAudience(null)).toBe(false);
    expect(isCompanionAudience(undefined)).toBe(false);
  });
});

/** A database that knows `rows` as the companions of the attendees, and counts the questions put to it. */
function fakeDb(companionsOf: Record<string, number>) {
  const count = vi.fn(({ where }: { where: { attendee_id: string } }) => Promise.resolve(companionsOf[where.attendee_id] ?? 0));
  const findMany = vi.fn(({ where }: { where: { attendee_id: { in: string[] } } }) =>
    Promise.resolve(
      where.attendee_id.in.filter((id) => (companionsOf[id] ?? 0) > 0).map((id) => ({ attendee_id: id })),
    ),
  );
  return { db: { attendeeCompanion: { count, findMany } } as unknown as PrismaClient, count, findMany };
}

describe("filterItemsForAttendee", () => {
  const giftbag = { key: "giftbag", config: null };
  const companion = { key: "companion", config: { audience: "with_companion" } };
  const headset = { key: "headset", config: { audience: "all" } };
  const items = [giftbag, companion, headset];

  it("keeps every item, in order, for a guest with a companion", async () => {
    const { db } = fakeDb({ guest: 1 });
    expect(await filterItemsForAttendee(db, "guest", items)).toEqual(items);
  });

  it("drops the items for guests with a companion for one who has none, and keeps the order of the rest", async () => {
    const { db } = fakeDb({});
    expect(await filterItemsForAttendee(db, "guest", items)).toEqual([giftbag, headset]);
  });

  it("does not look for a companion when no item is for them", async () => {
    const { db, count } = fakeDb({});
    expect(await filterItemsForAttendee(db, "guest", [giftbag, headset])).toEqual([giftbag, headset]);
    expect(await filterItemsForAttendee(db, "guest", [])).toEqual([]);
    expect(count).not.toHaveBeenCalled();
  });

  it("looks once, whatever the number of items for them", async () => {
    const { db, count } = fakeDb({ guest: 2 });
    await filterItemsForAttendee(db, "guest", [companion, { key: "bag", config: { audience: "with_companion" } }, giftbag]);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("returns a list of its own, so that a caller may change it, whether or not anything was dropped", async () => {
    const { db } = fakeDb({});
    const plain = [giftbag, headset];
    const mixed = [giftbag, companion];
    const keptPlain = await filterItemsForAttendee(db, "guest", plain);
    const keptMixed = await filterItemsForAttendee(db, "guest", mixed);
    expect(keptPlain).toEqual(plain);
    expect(keptPlain).not.toBe(plain);
    expect(keptMixed).toEqual([giftbag]);
    expect(keptMixed).not.toBe(mixed);
  });
});

describe("attendeeIdsWithCompanion", () => {
  it("is the attendees among those asked about who have a companion", async () => {
    const { db, findMany } = fakeDb({ one: 1, three: 2 });
    expect(await attendeeIdsWithCompanion(db, ["one", "two", "three"])).toEqual(new Set(["one", "three"]));
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("asks nothing about nobody", async () => {
    const { db, findMany } = fakeDb({ one: 1 });
    expect(await attendeeIdsWithCompanion(db, [])).toEqual(new Set());
    expect(findMany).not.toHaveBeenCalled();
  });
});

/**
 * The code that lists the items of an attendee, or makes the hand-out states they hold, applies the rule. A file that
 * reads the item tables in a way that could list items for an attendee has to mention the rule (itemAppliesToAttendee,
 * or filterItemsForAttendee, which applies it), unless it is listed here with the reason it need not: it works with the
 * configuration of the items, or with states that exist already. A new file that reads them fails this test until it
 * applies the rule or is added below, so a new list of an attendee's items cannot show a companion's item to everybody.
 */
describe("the readers of an attendee's items", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const READS_ITEMS = /\b(?:eventItem\.(?:findMany|createMany)|attendeeItemState\.(?:findMany|createMany))\b/;
  const APPLIES_THE_RULE = /\b(?:itemAppliesToAttendee|filterItemsForAttendee)\b/;
  const NEED_NOT = new Map<string, string>([
    ["packages/tickets/src/event-items.ts", "makes the default items of an event"],
    ["packages/tickets/src/bulk-revoke.ts", "resets states that exist, whichever items they are for"],
    ["apps/web/src/admin/event-items-api-routes.ts", "the organiser's list and edits of the items themselves"],
    ["apps/web/src/admin/event-custom-fields-routes.ts", "scans the configuration of the items for a field in use"],
    ["apps/web/src/admin/overview-routes.ts", "looks up the labels of items named in the activity feed"],
  ]);

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }
  const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const readers = [path.join(root, "packages/tickets/src"), path.join(root, "apps/web/src")]
    .flatMap((directory) => sourceFiles(directory))
    .filter((file) => READS_ITEMS.test(readFileSync(file, "utf8")))
    .map(relative);
  readers.sort();

  it("finds the readers it knows, so that the scan is looking in the right place", () => {
    expect(readers).toEqual(
      expect.arrayContaining([
        "apps/web/src/admin/attendees-api-routes.ts",
        "apps/web/src/admin/reports-routes.ts",
        "packages/tickets/src/attendee-card.ts",
        "packages/tickets/src/item-states.ts",
      ]),
    );
  });

  it("applies the rule in each, except those that say why they need not", () => {
    const unguarded = readers.filter(
      (file) => !NEED_NOT.has(file) && !APPLIES_THE_RULE.test(readFileSync(path.join(root, file), "utf8")),
    );
    expect(
      unguarded,
      "These files read the item tables and do not apply itemAppliesToAttendee (src/item-audience.ts): apply it, or add the file to NEED_NOT with the reason it need not.",
    ).toEqual([]);
  });

  it("lists no file that is gone or that no longer reads the items", () => {
    for (const file of NEED_NOT.keys()) expect(readers).toContain(file);
  });
});
