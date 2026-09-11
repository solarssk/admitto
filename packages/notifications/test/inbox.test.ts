import type { PrismaClient } from "@admitto/db";
import { describe, expect, it } from "vitest";
import {
  clearAllNotifications,
  countUnreadNotifications,
  describePersonalNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../src/inbox.js";
import { createStubDb } from "./stubDb.js";

const ROW = {
  id: "notif-1",
  organization_id: "org-1",
  notification_type: "auth.login.repeated_failures",
  severity: "error",
  title: "5 consecutive failed sign-in attempts",
  body: "5 consecutive failed sign-in attempts on admin@example.com.",
  created_at: new Date("2026-09-10T10:00:00Z"),
  read_at: null as Date | null,
};

describe("describePersonalNotifications", () => {
  it("scopes the query to the caller's own user_id and caps at 30, newest first", async () => {
    const db = createStubDb();
    db.notification.findMany.mockResolvedValue([ROW]);

    const result = await describePersonalNotifications(db as unknown as PrismaClient, "user-1");

    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: "user-1" },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: 30,
      }),
    );
    expect(result).toEqual([
      {
        id: "notif-1",
        organizationId: "org-1",
        notificationType: "auth.login.repeated_failures",
        severity: "error",
        title: ROW.title,
        body: ROW.body,
        createdAt: ROW.created_at,
        readAt: null,
      },
    ]);
  });

  it("includes both read and unread rows", async () => {
    const db = createStubDb();
    db.notification.findMany.mockResolvedValue([{ ...ROW, read_at: new Date("2026-09-10T11:00:00Z") }]);

    const result = await describePersonalNotifications(db as unknown as PrismaClient, "user-1");

    expect(result[0]!.readAt).toEqual(new Date("2026-09-10T11:00:00Z"));
  });
});

describe("countUnreadNotifications", () => {
  it("counts the caller's own unread rows via a read_at:null filter, capped at 30", async () => {
    const db = createStubDb();
    // The query now filters for unread rows directly (not "top-30 recent, then filter"), so the
    // stub only ever returns rows matching the where clause - already-read rows never come back.
    db.notification.findMany.mockResolvedValue([{ id: "n1" }, { id: "n2" }]);

    const count = await countUnreadNotifications(db as unknown as PrismaClient, "user-1");

    expect(count).toBe(2);
    expect(db.notification.findMany).toHaveBeenCalledWith({
      where: { user_id: "user-1", read_at: null },
      take: 30,
      select: { id: true },
    });
  });

  it("never exceeds 30 even when there are more unread rows than that", async () => {
    const db = createStubDb();
    db.notification.findMany.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ id: `n${i}` })));

    const count = await countUnreadNotifications(db as unknown as PrismaClient, "user-1");

    expect(count).toBe(30);
  });

  it("still reports a nonzero count when the caller's unread notification falls outside describePersonalNotifications's own newest-30 window (bot review finding)", async () => {
    // Regression test for capping-then-filtering: if the query took the chronological top-30
    // first and filtered for unread afterward, a user whose 30 most recent notifications are all
    // already read - but who still has one older unread row - would see 0, hiding the badge and
    // "Mark all as read" even though markAllNotificationsRead itself is unbounded and would still
    // catch it. Filtering on read_at directly (the fix) means this scenario is indistinguishable
    // from any other unread row at the query level - this test locks in the query's where clause
    // rather than simulating the DB's actual chronological ordering.
    const db = createStubDb();
    db.notification.findMany.mockResolvedValue([{ id: "old-unread" }]);

    const count = await countUnreadNotifications(db as unknown as PrismaClient, "user-1");

    expect(count).toBe(1);
    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: "user-1", read_at: null } }),
    );
  });
});

describe("clearAllNotifications", () => {
  it("permanently deletes every one of the caller's own notifications and returns the count", async () => {
    const db = createStubDb();
    db.notification.deleteMany.mockResolvedValue({ count: 5 });

    const cleared = await clearAllNotifications(db as unknown as PrismaClient, "user-1");

    expect(cleared).toBe(5);
    expect(db.notification.deleteMany).toHaveBeenCalledWith({ where: { user_id: "user-1" } });
  });
});

describe("markNotificationRead", () => {
  it("returns not_found and never updates when the row doesn't exist", async () => {
    const db = createStubDb();
    db.notification.findUnique.mockResolvedValue(null);

    const result = await markNotificationRead(db as unknown as PrismaClient, "user-1", "notif-x");

    expect(result).toBe("not_found");
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it("returns forbidden and never updates when the row belongs to a different user", async () => {
    const db = createStubDb();
    db.notification.findUnique.mockResolvedValue({ user_id: "user-2", read_at: null });

    const result = await markNotificationRead(db as unknown as PrismaClient, "user-1", "notif-1");

    expect(result).toBe("forbidden");
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it("returns ok without writing again when the caller's own row is already read", async () => {
    const db = createStubDb();
    db.notification.findUnique.mockResolvedValue({
      user_id: "user-1",
      read_at: new Date("2026-09-10T09:00:00Z"),
    });

    const result = await markNotificationRead(db as unknown as PrismaClient, "user-1", "notif-1");

    expect(result).toBe("ok");
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it("marks the caller's own unread row read", async () => {
    const db = createStubDb();
    db.notification.findUnique.mockResolvedValue({ user_id: "user-1", read_at: null });

    const result = await markNotificationRead(db as unknown as PrismaClient, "user-1", "notif-1");

    expect(result).toBe("ok");
    expect(db.notification.update).toHaveBeenCalledWith({
      where: { id: "notif-1" },
      data: { read_at: expect.any(Date) },
    });
  });
});

describe("markAllNotificationsRead", () => {
  it("scopes the bulk update to the caller's own unread rows and returns the affected count", async () => {
    const db = createStubDb();
    db.notification.updateMany.mockResolvedValue({ count: 4 });

    const updated = await markAllNotificationsRead(db as unknown as PrismaClient, "user-1");

    expect(updated).toBe(4);
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { user_id: "user-1", read_at: null },
      data: { read_at: expect.any(Date) },
    });
  });
});
