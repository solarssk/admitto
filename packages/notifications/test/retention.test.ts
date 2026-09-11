import type { PrismaClient } from "@admitto/db";
import { describe, expect, it } from "vitest";
import { purgeNotifications, resolveNotificationRetentionDays } from "../src/retention.js";
import { createStubDb } from "./stubDb.js";

const NOW = new Date("2026-09-11T12:00:00Z");
const DEFAULT_CUTOFF = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);

describe("purgeNotifications", () => {
  it("dry run counts matching rows without deleting anything", async () => {
    const db = createStubDb();
    db.notification.count.mockResolvedValue(7);

    const result = await purgeNotifications(db as unknown as PrismaClient, { now: NOW, dryRun: true });

    expect(result).toEqual({ deleted: 7 });
    expect(db.notification.count).toHaveBeenCalledWith({ where: { created_at: { lte: DEFAULT_CUTOFF } } });
    expect(db.notification.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes matching rows in a single batch when everything fits", async () => {
    const db = createStubDb();
    db.notification.findMany
      .mockResolvedValueOnce([{ id: "n1" }, { id: "n2" }])
      .mockResolvedValueOnce([]);
    db.notification.deleteMany.mockResolvedValue({ count: 2 });

    const result = await purgeNotifications(db as unknown as PrismaClient, { now: NOW, dryRun: false });

    expect(result).toEqual({ deleted: 2 });
    expect(db.notification.findMany).toHaveBeenCalledWith({
      where: { created_at: { lte: DEFAULT_CUTOFF } },
      select: { id: true },
      orderBy: { created_at: "asc" },
      take: 1000,
    });
    expect(db.notification.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["n1", "n2"] } } });
  });

  it("loops in bounded batches until a short page signals the end", async () => {
    const db = createStubDb();
    db.notification.findMany
      .mockResolvedValueOnce([{ id: "a" }, { id: "b" }]) // full batch of batchSize=2 - loop again
      .mockResolvedValueOnce([{ id: "c" }]); // short page - stop
    db.notification.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await purgeNotifications(db as unknown as PrismaClient, {
      now: NOW,
      dryRun: false,
      batchSize: 2,
    });

    expect(result).toEqual({ deleted: 3 });
    expect(db.notification.findMany).toHaveBeenCalledTimes(2);
    expect(db.notification.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("honors a custom retentionDays override in the cutoff", async () => {
    const db = createStubDb();
    db.notification.count.mockResolvedValue(0);

    await purgeNotifications(db as unknown as PrismaClient, { now: NOW, dryRun: true, retentionDays: 7 });

    expect(db.notification.count).toHaveBeenCalledWith({
      where: { created_at: { lte: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000) } },
    });
  });

  it("falls back to the 30-day default for a non-positive or non-finite retentionDays", async () => {
    const db = createStubDb();
    db.notification.count.mockResolvedValue(0);

    for (const invalid of [0, -5, Number.NaN]) {
      await purgeNotifications(db as unknown as PrismaClient, { now: NOW, dryRun: true, retentionDays: invalid });
      expect(db.notification.count).toHaveBeenLastCalledWith({ where: { created_at: { lte: DEFAULT_CUTOFF } } });
    }
  });

  it("clamps an absurdly large retentionDays instead of producing an Invalid Date cutoff", async () => {
    const db = createStubDb();
    db.notification.count.mockResolvedValue(0);

    const result = await purgeNotifications(db as unknown as PrismaClient, {
      now: NOW,
      dryRun: true,
      retentionDays: 1_000_000_000,
    });

    expect(result.deleted).toBe(0);
    const call = db.notification.count.mock.calls[0]![0] as { where: { created_at: { lte: Date } } };
    expect(Number.isNaN(call.where.created_at.lte.getTime())).toBe(false);
  });
});

describe("resolveNotificationRetentionDays", () => {
  it("resolves retention days from env with a safe fallback", () => {
    expect(resolveNotificationRetentionDays({})).toBe(30);
    expect(resolveNotificationRetentionDays({ NOTIFICATION_RETENTION_DAYS: "90" })).toBe(90);
    expect(resolveNotificationRetentionDays({ NOTIFICATION_RETENTION_DAYS: "abc" })).toBe(30);
    expect(resolveNotificationRetentionDays({ NOTIFICATION_RETENTION_DAYS: "30days" })).toBe(30);
    expect(resolveNotificationRetentionDays({ NOTIFICATION_RETENTION_DAYS: "0" })).toBe(30);
  });
});
