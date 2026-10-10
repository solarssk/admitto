import { Prisma, type PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { bestEffortDeleteReplacedUploadUrls, deleteEventJobFilesBestEffort } = vi.hoisted(() => ({
  bestEffortDeleteReplacedUploadUrls: vi.fn().mockResolvedValue(undefined),
  deleteEventJobFilesBestEffort: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/admin/branding-upload.js", () => ({
  bestEffortDeleteReplacedUploadUrls,
}));

vi.mock("../../src/admin/purge-export-files.js", () => ({
  deleteEventJobFilesBestEffort,
}));

vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return {
    ...actual,
    writeAdminAuditLog: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@admitto/shared/system-log", () => ({
  emitSystemLog: vi.fn(),
  recordSystemLog: vi.fn(),
}));

import { deleteEvent } from "../../src/admin/event-deletion.js";

describe("deleteEvent — managed upload cleanup", () => {
  beforeEach(() => {
    bestEffortDeleteReplacedUploadUrls.mockClear();
    deleteEventJobFilesBestEffort.mockClear();
  });

  it("best-effort deletes event branding and named image asset URLs after commit", async () => {
    const eventId = "evt-upload-cleanup";
    const imageUrl = `/uploads/default/event/${eventId}/hero.png`;
    const logoUrl = `/uploads/default/event/${eventId}/logo.png`;

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      // The event's jobs, deleted with RETURNING: one export file, one job without a file, the staged CSV of a failed import.
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ storage_key: "org-1/events/evt-upload-cleanup/a.csv" }, { storage_key: null }, { storage_key: "org-1/events/evt-upload-cleanup/b.csv" }]),
      event: {
        findUnique: vi.fn().mockResolvedValue({
          archived_at: null,
          pinned_note: null,
          organization_id: "org-1",
          title: "Cleanup Event",
          logo_url: logoUrl,
          logo_original_url: null,
          header_image_url: null,
        }),
        delete: vi.fn().mockResolvedValue({ id: eventId }),
      },
      attendee: { count: vi.fn().mockResolvedValue(0) },
      eventItem: { count: vi.fn().mockResolvedValue(0) },
      ticketType: { count: vi.fn().mockResolvedValue(0) },
      eventContact: { count: vi.fn().mockResolvedValue(0) },
      eventResource: { count: vi.fn().mockResolvedValue(0) },
      mailTemplate: {
        count: vi.fn().mockResolvedValue(0),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      mailSettings: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      eventImageAsset: {
        findMany: vi.fn().mockResolvedValue([{ url: imageUrl }]),
      },
    };

    const db = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
      user: { findUnique: vi.fn().mockResolvedValue({ email: "super@example.com" }) },
    } as unknown as PrismaClient;

    const result = await deleteEvent(db, eventId, { userId: "user-1" }, null, null);

    expect(result).toEqual({ ok: true });
    expect(bestEffortDeleteReplacedUploadUrls).toHaveBeenCalledWith(
      [logoUrl, null, null, imageUrl],
      [],
      { expectedOrgId: "default", expectedKind: "event", expectedEventId: eventId },
    );
  });

  it("hands the keys of the jobs it deleted, and only those that have a file, to the file cleanup after commit", async () => {
    const eventId = "evt-upload-cleanup";
    const calls: string[] = [];
    const tx = {
      // The two advisory locks, told apart by their key: the scoped one of mail settings, then the job queue.
      $executeRaw: vi.fn().mockImplementation(async (sql: { values: unknown[] }) => {
        calls.push(String(sql.values[0]).startsWith("attendee-job-queue:") ? "queue lock" : "scoped lock");
        return 0;
      }),
      // The rows of the jobs are locked first, then the row of the event (both SELECT ... FOR UPDATE), the same order
      // as an import takes them in; the jobs are deleted with RETURNING after that.
      $queryRaw: vi.fn().mockImplementation(async (strings: readonly string[]) => {
        const sql = strings.join("?");
        if (sql.includes("FOR UPDATE") && sql.includes('"AdminJob"')) {
          calls.push("job rows lock");
          return [{ id: "job-1" }];
        }
        if (sql.includes("FOR UPDATE")) {
          calls.push("event row lock");
          return [{ locked: 1 }];
        }
        calls.push("jobs delete");
        return [{ storage_key: "org-1/events/evt-upload-cleanup/a.csv" }, { storage_key: null }, { storage_key: "org-1/events/evt-upload-cleanup/b.csv" }];
      }),
      event: {
        findUnique: vi.fn().mockResolvedValue({
          archived_at: null,
          pinned_note: null,
          organization_id: "org-1",
          title: "Cleanup Event",
          logo_url: null,
          logo_original_url: null,
          header_image_url: null,
        }),
        delete: vi.fn().mockImplementation(async () => {
          calls.push("event.delete");
          return { id: eventId };
        }),
      },
      attendee: { count: vi.fn().mockResolvedValue(0) },
      eventItem: { count: vi.fn().mockResolvedValue(0) },
      ticketType: { count: vi.fn().mockResolvedValue(0) },
      eventContact: { count: vi.fn().mockResolvedValue(0) },
      eventResource: { count: vi.fn().mockResolvedValue(0) },
      mailTemplate: { count: vi.fn().mockResolvedValue(0), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      mailSettings: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      eventImageAsset: { findMany: vi.fn().mockResolvedValue([]) },
    };
    deleteEventJobFilesBestEffort.mockImplementation(async () => {
      calls.push("job files");
    });
    const db = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
      user: { findUnique: vi.fn().mockResolvedValue({ email: "super@example.com" }) },
    } as unknown as PrismaClient;

    const result = await deleteEvent(db, eventId, { userId: "user-1" }, null, null);

    expect(result).toEqual({ ok: true });
    expect(deleteEventJobFilesBestEffort).toHaveBeenCalledWith(eventId, [
      "org-1/events/evt-upload-cleanup/a.csv",
      "org-1/events/evt-upload-cleanup/b.csv",
    ]);
    // The row of the event is locked before its jobs are read, and the files go after the rows: the event is deleted
    // first, in the transaction.
    expect(calls).toEqual(["scoped lock", "queue lock", "job rows lock", "event row lock", "jobs delete", "event.delete", "job files"]);
    deleteEventJobFilesBestEffort.mockReset().mockResolvedValue(undefined);
  });

  it("skips upload cleanup when delete is rejected as not_deletable", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      event: {
        findUnique: vi.fn().mockResolvedValue({
          archived_at: null,
          pinned_note: "blocked",
          organization_id: "org-1",
          title: "Blocked Event",
          logo_url: `/uploads/default/event/evt-blocked/logo.png`,
          logo_original_url: null,
          header_image_url: null,
        }),
      },
      attendee: { count: vi.fn().mockResolvedValue(0) },
      eventItem: { count: vi.fn().mockResolvedValue(0) },
      ticketType: { count: vi.fn().mockResolvedValue(0) },
      eventContact: { count: vi.fn().mockResolvedValue(0) },
      eventResource: { count: vi.fn().mockResolvedValue(0) },
      mailTemplate: { count: vi.fn().mockResolvedValue(0) },
    };

    const db = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    const result = await deleteEvent(db, "evt-blocked", { userId: "user-1" }, null, null);

    expect(result).toEqual({ code: "not_deletable" });
    expect(bestEffortDeleteReplacedUploadUrls).not.toHaveBeenCalled();
    expect(deleteEventJobFilesBestEffort).not.toHaveBeenCalled();
  });

  it("skips upload cleanup when the transaction fails", async () => {
    const db = {
      $transaction: vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Foreign key constraint violated", {
          code: "P2003",
          clientVersion: "test",
        }),
      ),
    } as unknown as PrismaClient;

    const result = await deleteEvent(db, "evt-1", { userId: "user-1" }, null, null);

    expect(result).toEqual({ code: "not_deletable" });
    expect(bestEffortDeleteReplacedUploadUrls).not.toHaveBeenCalled();
    expect(deleteEventJobFilesBestEffort).not.toHaveBeenCalled();
  });
});
