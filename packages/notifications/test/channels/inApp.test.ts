import type { PrismaClient } from "@admitto/db";
import { describe, expect, it } from "vitest";
import { InAppChannel } from "../../src/channels/inApp.js";
import type { DispatchedNotification } from "../../src/types.js";
import { createStubDb } from "../stubDb.js";

const EVENT: DispatchedNotification = {
  type: "auth.login.repeated_failures",
  severity: "error",
  organizationId: "org-1",
  title: "Repeated failed logins",
  body: "5 consecutive failed attempts.",
};

describe("InAppChannel", () => {
  it("is a no-op success when there are no recipients", async () => {
    const db = createStubDb();
    const channel = new InAppChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, []);

    expect(result).toEqual({ ok: true, noop: true });
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("inserts one row per recipient with the event's type/severity/title/body", async () => {
    const db = createStubDb();
    db.notification.createMany.mockResolvedValue({ count: 2 });
    const channel = new InAppChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1", "u-2"]);

    expect(result).toEqual({ ok: true });
    expect(db.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          user_id: "u-1",
          notification_type: EVENT.type,
          severity: EVENT.severity,
          title: EVENT.title,
          body: EVENT.body,
          metadata: undefined,
        },
        {
          user_id: "u-2",
          notification_type: EVENT.type,
          severity: EVENT.severity,
          title: EVENT.title,
          body: EVENT.body,
          metadata: undefined,
        },
      ],
    });
  });

  it("reports a failure instead of throwing when the insert fails", async () => {
    const db = createStubDb();
    db.notification.createMany.mockRejectedValue(new Error("connection lost"));
    const channel = new InAppChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("connection lost");
  });

  it("falls back to a generic failure message when the driver error has nothing to sanitize", async () => {
    const db = createStubDb();
    db.notification.createMany.mockRejectedValue(new Error("")); // NOSONAR - deliberately empty, exercises the "nothing to sanitize" fallback
    const channel = new InAppChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result).toEqual({ ok: false, error: "In-app write failed." });
  });

  it("stringifies a non-Error thrown value before sanitizing it", async () => {
    const db = createStubDb();
    db.notification.createMany.mockRejectedValue("db pool exhausted");
    const channel = new InAppChannel(db as unknown as PrismaClient);

    const result = await channel.send(EVENT, ["u-1"]);

    expect(result).toEqual({ ok: false, error: "db pool exhausted" });
  });
});
