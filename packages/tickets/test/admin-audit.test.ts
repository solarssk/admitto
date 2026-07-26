import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { writeAdminAuditLog } from "../src/admin-audit.js";

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
