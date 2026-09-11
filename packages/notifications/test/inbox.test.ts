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
  it("counts only the caller's own unread rows, within the same newest-30 window the list shows", async () => {
    const db = createStubDb();
    db.notification.findMany.mockResolvedValue([
      { read_at: null },
      { read_at: new Date("2026-09-10T09:00:00Z") },
      { read_at: null },
    ]);

    const count = await countUnreadNotifications(db as unknown as PrismaClient, "user-1");

    expect(count).toBe(2);
    expect(db.notification.findMany).toHaveBeenCalledWith({
      where: { user_id: "user-1" },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: 30,
      select: { read_at: true },
    });
  });

  it("never exceeds what describePersonalNotifications can ever show - more than 30 unread rows in the window still counts as at most 30", async () => {
    const db = createStubDb();
    db.notification.findMany.mockResolvedValue(Array.from({ length: 30 }, () => ({ read_at: null })));

    const count = await countUnreadNotifications(db as unknown as PrismaClient, "user-1");

    expect(count).toBe(30);
  });

  it("orders by the same tiebreak as describePersonalNotifications, so both queries agree on which rows fall inside the top-30 window when several share the exact same created_at", async () => {
    const listDb = createStubDb();
    listDb.notification.findMany.mockResolvedValue([]);
    const countDb = createStubDb();
    countDb.notification.findMany.mockResolvedValue([]);

    await describePersonalNotifications(listDb as unknown as PrismaClient, "user-1");
    await countUnreadNotifications(countDb as unknown as PrismaClient, "user-1");

    const listOrderBy = listDb.notification.findMany.mock.calls[0]![0].orderBy;
    const countOrderBy = countDb.notification.findMany.mock.calls[0]![0].orderBy;
    expect(listOrderBy).toEqual(countOrderBy);
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
