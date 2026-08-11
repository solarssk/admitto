import { Prisma, type PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { bestEffortDeleteReplacedUploadUrls } = vi.hoisted(() => ({
  bestEffortDeleteReplacedUploadUrls: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/admin/branding-upload.js", () => ({
  bestEffortDeleteReplacedUploadUrls,
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
  });

  it("best-effort deletes event branding and named image asset URLs after commit", async () => {
    const eventId = "evt-upload-cleanup";
    const imageUrl = `/uploads/default/event/${eventId}/hero.png`;
    const logoUrl = `/uploads/default/event/${eventId}/logo.png`;

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
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

  it("skips upload cleanup when delete is rejected as not_deletable", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
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
  });
});
