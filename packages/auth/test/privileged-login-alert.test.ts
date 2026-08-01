import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { recordFailedLoginForPrivilegedUser, resetFailedLoginStreak } from "../src/privileged-login-alert.js";
import { resetSystemLogBufferForTest } from "@admitto/shared/system-log";

/** Fake `db` covering exactly what this module touches: role lookup (for `hasElevatedRole`)
 * and `user.update` / `user.updateMany` (for the streak counter) - matching the DI pattern
 * used by audit.test.ts's own fakeDb. */
function fakeDb(opts: {
  roles?: Array<{ role: string }>;
  update?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
} = {}): PrismaClient {
  return {
    roleAssignment: { findMany: vi.fn().mockResolvedValue(opts.roles ?? []) },
    user: {
      update: opts.update ?? vi.fn().mockResolvedValue({ failed_login_streak: 0 }),
      updateMany: opts.updateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
    },
    securityAuditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaClient;
}

describe("privileged-login-alert", () => {
  beforeEach(() => {
    resetSystemLogBufferForTest();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("recordFailedLoginForPrivilegedUser", () => {
    it("does nothing for a non-elevated (operator) account", async () => {
      const update = vi.fn();
      const db = fakeDb({ roles: [{ role: "operator" }], update });
      await recordFailedLoginForPrivilegedUser(
        db,
        { id: "user-1", email: "op@example.com" },
        { ip: "1.2.3.4" },
      );
      expect(update).not.toHaveBeenCalled();
    });

    it("does nothing for an account with no role assignments at all", async () => {
      const update = vi.fn();
      const db = fakeDb({ roles: [], update });
      await recordFailedLoginForPrivilegedUser(
        db,
        { id: "user-1", email: "nobody@example.com" },
        {},
      );
      expect(update).not.toHaveBeenCalled();
    });

    it("atomically increments the streak for an admin account below the alert threshold", async () => {
      const update = vi.fn().mockResolvedValue({ failed_login_streak: 4 });
      const db = fakeDb({ roles: [{ role: "admin" }], update });
      await recordFailedLoginForPrivilegedUser(
        db,
        { id: "user-1", email: "admin@example.com" },
        { ip: "1.2.3.4" },
      );
      expect(update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { failed_login_streak: { increment: 1 } },
        select: { failed_login_streak: true },
      });
      expect(update).toHaveBeenCalledTimes(1);
    });

    it("treats superadmin the same as admin", async () => {
      const update = vi.fn().mockResolvedValue({ failed_login_streak: 1 });
      const db = fakeDb({ roles: [{ role: "superadmin" }], update });
      await recordFailedLoginForPrivilegedUser(
        db,
        { id: "user-1", email: "root@example.com" },
        {},
      );
      expect(update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { failed_login_streak: { increment: 1 } },
        select: { failed_login_streak: true },
      });
    });

    it("resets the streak to 0 and emits an audit alert once the threshold is crossed", async () => {
      const update = vi
        .fn()
        .mockResolvedValueOnce({ failed_login_streak: 5 })
        .mockResolvedValueOnce({});
      const create = vi.fn().mockResolvedValue({});
      const db = {
        roleAssignment: { findMany: vi.fn().mockResolvedValue([{ role: "admin" }]) },
        user: { update },
        securityAuditLog: { create },
      } as unknown as PrismaClient;

      await recordFailedLoginForPrivilegedUser(
        db,
        { id: "user-1", email: "admin@example.com" },
        { ip: "9.9.9.9" },
      );

      expect(update).toHaveBeenNthCalledWith(1, {
        where: { id: "user-1" },
        data: { failed_login_streak: { increment: 1 } },
        select: { failed_login_streak: true },
      });
      expect(update).toHaveBeenNthCalledWith(2, {
        where: { id: "user-1" },
        data: { failed_login_streak: 0 },
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.login.repeated_failures",
          user_id: "user-1",
          ip: "9.9.9.9",
          metadata: { email: "admin@example.com", streak: 5 },
        },
      });
    });
  });

  describe("resetFailedLoginStreak", () => {
    it("clears only a persisted nonzero streak in the database", async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const db = fakeDb({ updateMany });
      await resetFailedLoginStreak(db, "user-1");
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "user-1", failed_login_streak: { gt: 0 } },
        data: { failed_login_streak: 0 },
      });
    });

    it("resets a nonzero persisted streak to 0", async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const db = fakeDb({ updateMany });
      await resetFailedLoginStreak(db, "user-1");
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "user-1", failed_login_streak: { gt: 0 } },
        data: { failed_login_streak: 0 },
      });
    });
  });
});
