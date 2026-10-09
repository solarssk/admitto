/**
 * The attendee list, its count and the exports for an event that has erased attendees: hidden by
 * default (list and count), shown only on request, and never in an export.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { eraseAttendees } from "../src/erase-attendees.js";
import {
  countFilteredAttendees,
  findFilteredAttendeesForExport,
  findFilteredAttendeesForList,
  findSelectedAttendeesForExport,
} from "../src/attendees-list-filters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");
const EVENT_ID = "evt-erased-lists";

let prisma: PrismaClient;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
  await prisma.organization.create({ data: { id: "org_lists", name: "Lists", slug: "lists-org" } });
  await prisma.event.create({
    data: { id: EVENT_ID, title: "Lists", slug: "lists", organization_id: "org_lists", date: new Date("2026-09-01T09:00:00Z") },
  });
  for (const [id, name] of [
    ["lists-live", "Live Lister"],
    ["lists-gone", "Gone Lister"],
  ] as const) {
    await prisma.attendee.create({ data: { id, event_id: EVENT_ID, email: `${id}@example.com`, name } });
  }
  await prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ["lists-gone"] }));
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const all = { status: "all" as const };

describe("count and list", () => {
  it("hide erased attendees by default, with and without a search (Prisma and raw count)", async () => {
    expect(await countFilteredAttendees(prisma, EVENT_ID, all)).toBe(1);
    expect(await countFilteredAttendees(prisma, EVENT_ID, { ...all, q: "e" })).toBe(1);
  });

  it("show them, marked, when includeErased is set", async () => {
    expect(await countFilteredAttendees(prisma, EVENT_ID, { ...all, includeErased: true })).toBe(2);
    expect(await countFilteredAttendees(prisma, EVENT_ID, { ...all, q: "e", includeErased: true })).toBe(2);

    const hidden = await findFilteredAttendeesForList(prisma, EVENT_ID, all, 1, 50);
    expect(hidden.map((r) => r.id)).toEqual(["lists-live"]);
    const shown = await findFilteredAttendeesForList(prisma, EVENT_ID, { ...all, includeErased: true }, 1, 50);
    expect(shown.map((r) => [r.id, r.erased_at !== null])).toEqual(
      expect.arrayContaining([
        ["lists-live", false],
        ["lists-gone", true],
      ]),
    );
  });

  it("do not find an erased attendee by the placeholder text unless asked", async () => {
    expect(await findFilteredAttendeesForList(prisma, EVENT_ID, { ...all, q: "erased" }, 1, 50)).toEqual([]);
    expect(await findFilteredAttendeesForList(prisma, EVENT_ID, { ...all, q: "erased", includeErased: true }, 1, 50)).toHaveLength(1);
  });
});

describe("exports", () => {
  it("never include an erased attendee, whatever the list was showing", async () => {
    const plain = await findFilteredAttendeesForExport(prisma, EVENT_ID, { ...all, includeErased: true });
    expect(plain.map((r) => r.email)).toEqual(["lists-live@example.com"]);
    const searched = await findFilteredAttendeesForExport(prisma, EVENT_ID, { ...all, q: "e", includeErased: true });
    expect(searched.map((r) => r.email)).toEqual(["lists-live@example.com"]);
  });

  it("leave an erased attendee out of an explicit selection", async () => {
    const rows = await findSelectedAttendeesForExport(prisma, EVENT_ID, ["lists-live", "lists-gone"]);
    expect(rows.map((r) => r.email)).toEqual(["lists-live@example.com"]);
  });
});
