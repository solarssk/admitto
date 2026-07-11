import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { deleteEvent } from "../../src/admin/event-deletion.js";

function fkRestrictError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Foreign key constraint violated", {
    code: "P2003",
    clientVersion: "test",
  });
}

describe("deleteEvent — transaction failure mapping", () => {
  function fakeDb(transaction: (...args: unknown[]) => unknown): PrismaClient {
    return { $transaction: transaction } as unknown as PrismaClient;
  }

  it("maps a concurrent-activity FK-restrict rejection (P2003) to not_deletable, not audit_failed", async () => {
    const db = fakeDb(vi.fn().mockRejectedValue(fkRestrictError()));

    const result = await deleteEvent(db, "evt-1", { userId: "user-1" }, null, null);

    expect(result).toEqual({ code: "not_deletable" });
  });

  it("maps any other transaction failure (e.g. a real audit-log write bug) to audit_failed", async () => {
    const db = fakeDb(vi.fn().mockRejectedValue(new Error("write failed")));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await deleteEvent(db, "evt-1", { userId: "user-1" }, null, null);

    expect(result).toEqual({ code: "audit_failed" });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
