import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { acquireEventTicketTypesLock } from "@admitto/tickets";
import { runImport } from "../src/cli.js";
import { assertTestDatabaseUrl } from "./assertTestDatabaseUrl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

let prisma: PrismaClient;

const ORG_ID = "org_cli_import";
const EVENT_ID = "test-event-cli-import";

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");

  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  prisma = new PrismaClient();

  await prisma.organization.create({
    data: { id: ORG_ID, name: "CLI Import Org", slug: "cli-import-org" },
  });

  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "CLI Import Event",
      slug: "cli-import-event",
      date: new Date("2026-09-01T09:00:00Z"),
      organization_id: ORG_ID,
    },
  });
});

afterAll(async () => {
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.ticketType.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

/** Write a small temp CSV fixture for a runImport() call — caller removes the containing dir. */
function writeTempCsv(rows: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admitto-cli-import-"));
  const file = path.join(dir, "attendees.csv");
  fs.writeFileSync(file, rows.join("\n"), "utf8");
  return file;
}

describe("runImport - bad --event id", () => {
  it("surfaces 'Event not found' even when the CSV has zero valid rows, instead of silently reporting nothing to import", async () => {
    const file = writeTempCsv(["first_name,last_name,email", "Bad,,not-an-email"]);
    try {
      await expect(
        runImport({ eventId: "no-such-event", filePath: file, commit: false, overwrite: false }),
      ).rejects.toThrow('Event not found: "no-such-event"');
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});

// TOCTOU regression: packages/import/src/cli.ts previously committed via the bare `prisma`
// client with no lock at all, so a concurrent DELETE /api/admin/events/:eventId/ticket-types/:id
// (apps/web) could remove a type in the same narrow window a CLI import was about to write an
// attendee referencing it — Attendee.ticket_type has no FK, so nothing else would catch that.
// This races runImport()'s own transaction against the same lock+in-use-recheck the DELETE route
// uses (apps/web/src/admin/ticket-types-routes.ts's handleDeleteEventTicketType), replicated here
// via Prisma directly rather than over HTTP, since packages/import cannot depend on apps/web.
describe("runImport - concurrent ticket-type delete (TOCTOU)", () => {
  it("never orphans an attendee when a ticket type is deleted concurrently with a CLI import commit", async () => {
    const raceType = await prisma.ticketType.create({
      data: { event_id: EVENT_ID, key: "concurrent-vip", label: "Concurrent VIP", sort_order: 50 },
    });
    const file = writeTempCsv([
      "first_name,last_name,email,ticket_type",
      "Concurrent,Race,cli-concurrent-vip@example.com,concurrent-vip",
    ]);

    async function deleteTicketTypeIfUnused(): Promise<"deleted" | "in_use"> {
      // A few ms head start for runImport()'s own pre-transaction reads (event lookup, file read,
      // catalog snapshot, parse) - without it, this plain DB delete (no auth/session overhead,
      // unlike the real HTTP DELETE route) can complete before runImport's outer catalog snapshot
      // even runs, which would exclude the row there instead of at the lock-time recheck this test
      // means to exercise (same narrower window as admin-import.test.ts's analogous HTTP test,
      // where the DELETE route's own auth/lookup overhead naturally provides that head start).
      await new Promise((resolve) => setTimeout(resolve, 15));
      return prisma.$transaction(async (tx) => {
        await acquireEventTicketTypesLock(tx, EVENT_ID);
        const inUseCount = await tx.attendee.count({
          where: { event_id: EVENT_ID, ticket_type: raceType.key },
        });
        if (inUseCount > 0) return "in_use";
        await tx.ticketType.delete({ where: { id: raceType.id } });
        return "deleted";
      });
    }

    try {
      const [importResult, deleteResult] = await Promise.all([
        runImport({ eventId: EVENT_ID, filePath: file, commit: true, overwrite: false }),
        deleteTicketTypeIfUnused(),
      ]);

      const attendee = await prisma.attendee.findFirst({
        where: { event_id: EVENT_ID, email: "cli-concurrent-vip@example.com" },
      });

      // Whichever side won the advisory lock first, the outcome must be consistent: either the
      // delete won (the import's lock-time recheck excluded the row) or the import won (the
      // delete's in-use recheck found the freshly created attendee) — never both an attendee
      // referencing the now-gone type AND a successful delete.
      if (deleteResult === "deleted") {
        expect(importResult.summary?.created).toBe(0);
        expect(importResult.invalidRows).toHaveLength(1);
        expect(importResult.invalidRows[0]!.reason).toBe('Unknown ticket type: "concurrent-vip"');
        expect(attendee).toBeNull();
      } else {
        expect(deleteResult).toBe("in_use");
        expect(importResult.summary?.created).toBe(1);
        expect(attendee?.ticket_type).toBe("concurrent-vip");
      }
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
      await prisma.attendee.deleteMany({
        where: { event_id: EVENT_ID, email: "cli-concurrent-vip@example.com" },
      });
      await prisma.ticketType.deleteMany({ where: { id: raceType.id } });
    }
  });
});
