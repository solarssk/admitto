import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { writeAdminAuditLog, writeAdminAuditLogBestEffort } from "../src/admin-audit.js";

function makeMockDb() {
  const create = vi.fn().mockResolvedValue(undefined);
  return { db: { adminAuditLog: { create } } as unknown as PrismaClient, create };
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
    const db = { adminAuditLog: { create } } as unknown as PrismaClient;

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
    const db = { adminAuditLog: { create } } as unknown as PrismaClient;

    await writeAdminAuditLogBestEffort(db, { actorUserId: "user-1", actionType: "instance_setup_completed" });

    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
    expect(payload.error).toBe("timeout");
  });
});
