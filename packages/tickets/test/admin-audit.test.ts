import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { writeAdminAuditLog, writeAdminAuditLogBestEffort } from "../src/admin-audit.js";

const ACTOR_SNAPSHOT = { email: "actor@example.com", display_name: "Actor User" };

function makeMockDb() {
  const create = vi.fn().mockResolvedValue(undefined);
  const findUnique = vi.fn().mockResolvedValue(ACTOR_SNAPSHOT);
  return {
    db: { adminAuditLog: { create }, user: { findUnique } } as unknown as PrismaClient,
    create,
    findUnique,
  };
}

describe("writeAdminAuditLog", () => {
  it("maps timezone to actor_timezone when provided", async () => {
    const { db, create } = makeMockDb();

    await writeAdminAuditLog(db, {
      actorUserId: "user-1",
      actionType: "event_created",
      timezone: "Europe/Warsaw",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actor_timezone: "Europe/Warsaw" }) }),
    );
  });

  it("persists immutable actor email/display_name snapshot columns", async () => {
    const { db, create } = makeMockDb();

    await writeAdminAuditLog(db, {
      actorUserId: "user-1",
      actionType: "event_created",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actor_email: ACTOR_SNAPSHOT.email,
          actor_display_name: ACTOR_SNAPSHOT.display_name,
        }),
      }),
    );
  });

  it("prefers the live User row over an actorEmail override", async () => {
    const { db, create } = makeMockDb();

    await writeAdminAuditLog(db, {
      actorUserId: "user-1",
      actionType: "event_created",
      actorEmail: "forged@example.com",
      actorDisplayName: "Forged Name",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actor_email: ACTOR_SNAPSHOT.email,
          actor_display_name: ACTOR_SNAPSHOT.display_name,
        }),
      }),
    );
  });

  it("uses a server-resolved actorEmail override when the User row is missing", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const findUnique = vi.fn().mockResolvedValue(null);
    const db = {
      adminAuditLog: { create },
      user: { findUnique },
    } as unknown as PrismaClient;

    await writeAdminAuditLog(db, {
      actorUserId: "deleted-user",
      actionType: "retention_run",
      actorEmail: "cli@example.com",
      actorDisplayName: "CLI Operator",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actor_email: "cli@example.com",
          actor_display_name: "CLI Operator",
        }),
      }),
    );
  });

  it("falls back to a server-resolved actorEmail override when the User lookup throws", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const findUnique = vi.fn().mockRejectedValue(new Error("db unavailable"));
    const db = {
      adminAuditLog: { create },
      user: { findUnique },
    } as unknown as PrismaClient;

    await writeAdminAuditLog(db, {
      actorUserId: "deleted-user",
      actionType: "retention_run",
      actorEmail: "cli@example.com",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actor_email: "cli@example.com",
          actor_display_name: null,
        }),
      }),
    );
  });

  it("persists null actor snapshot columns when lookup fails and no override is provided", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const findUnique = vi.fn().mockRejectedValue(new Error("db unavailable"));
    const db = {
      adminAuditLog: { create },
      user: { findUnique },
    } as unknown as PrismaClient;

    await writeAdminAuditLog(db, {
      actorUserId: "deleted-user",
      actionType: "retention_run",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actor_email: null,
          actor_display_name: null,
        }),
      }),
    );
  });

  it("defaults actor_timezone to null when timezone is omitted (CLI-originated writes)", async () => {
    const { db, create } = makeMockDb();

    await writeAdminAuditLog(db, {
      actorUserId: "user-1",
      actionType: "retention_run",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actor_timezone: null }) }),
    );
  });
});

describe("writeAdminAuditLogBestEffort", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes through to writeAdminAuditLog on success", async () => {
    const { db, create } = makeMockDb();

    await writeAdminAuditLogBestEffort(db, {
      actorUserId: "user-1",
      actionType: "identity_provider_created",
      metadata: { providerId: "prov-1" },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actor_user_id: "user-1", action_type: "identity_provider_created" }),
      }),
    );
  });

  it("logs and resolves instead of throwing when the write fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(new Error("connection lost"));
    const db = {
      adminAuditLog: { create },
      user: { findUnique: vi.fn().mockResolvedValue(ACTOR_SNAPSHOT) },
    } as unknown as PrismaClient;

    await expect(
      writeAdminAuditLogBestEffort(db, { actorUserId: "user-1", actionType: "account_password_changed" }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      event: "admin_audit_log.write_failed",
      action_type: "account_password_changed",
      error: "connection lost",
    });
  });

  it("stringifies a non-Error rejection instead of reading .message off it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue("timeout");
    const db = {
      adminAuditLog: { create },
      user: { findUnique: vi.fn().mockResolvedValue(ACTOR_SNAPSHOT) },
    } as unknown as PrismaClient;

    await writeAdminAuditLogBestEffort(db, { actorUserId: "user-1", actionType: "instance_setup_completed" });

    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
    expect(payload.error).toBe("timeout");
  });
});
