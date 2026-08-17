import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  recordFailedLoginFailureSideEffects,
  resetFailedLoginStreak,
  recordFailedMfaFailureSideEffects,
  resetFailedMfaFailureStreak,
} from "../src/privileged-login-alert.js";
import { PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD } from "../src/constants.js";
import { resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const TIMING_PAD_USER_ID = "00000000-0000-0000-0000-000000000000";

/** Fake `db` covering exactly what this module touches. */
function fakeDb(opts: {
  roles?: Array<{ role: string }>;
  queryRaw?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
} = {}): PrismaClient {
  return {
    roleAssignment: { findMany: vi.fn().mockResolvedValue(opts.roles ?? []) },
    user: {
      updateMany: opts.updateMany ?? vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: opts.queryRaw ?? vi.fn().mockResolvedValue([{ should_alert: false }]),
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

  describe("recordFailedLoginFailureSideEffects", () => {
    it("runs the same timing-pad queries when the email is unknown", async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const findMany = vi.fn().mockResolvedValue([]);
      const db = {
        roleAssignment: { findMany },
        user: { updateMany },
        $queryRaw: vi.fn(),
      } as unknown as PrismaClient;

      await recordFailedLoginFailureSideEffects(db, null, { ip: "1.2.3.4" });

      expect(findMany).toHaveBeenCalledWith({
        where: { user_id: TIMING_PAD_USER_ID },
        select: { role: true },
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: TIMING_PAD_USER_ID },
        data: { failed_login_streak: { increment: 1 } },
      });
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it("uses the timing pad for a non-elevated (operator) account", async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const db = fakeDb({ roles: [{ role: "operator" }], updateMany });

      await recordFailedLoginFailureSideEffects(
        db,
        { id: "user-1", email: "op@example.com" },
        { ip: "1.2.3.4" },
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: TIMING_PAD_USER_ID },
        data: { failed_login_streak: { increment: 1 } },
      });
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it("atomically increments the streak for an admin account below the alert threshold", async () => {
      const queryRaw = vi.fn().mockResolvedValue([{ should_alert: false }]);
      const db = fakeDb({ roles: [{ role: "admin" }], queryRaw });

      await recordFailedLoginFailureSideEffects(
        db,
        { id: "user-1", email: "admin@example.com" },
        { ip: "1.2.3.4" },
      );

      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(db.user.updateMany).not.toHaveBeenCalled();
    });

    it("emits one audit alert when the atomic bump wraps at the threshold", async () => {
      const queryRaw = vi.fn().mockResolvedValue([{ should_alert: true }]);
      const create = vi.fn().mockResolvedValue({});
      const db = {
        roleAssignment: { findMany: vi.fn().mockResolvedValue([{ role: "admin" }]) },
        user: {
          updateMany: vi.fn(),
          findUnique: vi.fn().mockResolvedValue({ email: "admin@example.com", display_name: null }),
        },
        $queryRaw: queryRaw,
        securityAuditLog: { create },
      } as unknown as PrismaClient;

      await recordFailedLoginFailureSideEffects(
        db,
        { id: "user-1", email: "admin@example.com" },
        { ip: "9.9.9.9" },
      );

      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.login.repeated_failures",
          user_id: "user-1",
          user_email: "admin@example.com",
          user_display_name: null,
          ip: "9.9.9.9",
          actor_timezone: null,
          metadata: { streak: PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD },
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

  describe("recordFailedMfaFailureSideEffects", () => {
    it("does nothing for a non-elevated (operator) account", async () => {
      const findMany = vi.fn().mockResolvedValue([{ role: "operator" }]);
      const findUnique = vi.fn();
      const db = {
        roleAssignment: { findMany },
        user: { findUnique, updateMany: vi.fn() },
        $queryRaw: vi.fn(),
      } as unknown as PrismaClient;

      await recordFailedMfaFailureSideEffects(db, "user-1", { ip: "1.2.3.4" });

      expect(findUnique).not.toHaveBeenCalled();
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it("atomically increments the MFA-failure streak for an admin account below the alert threshold", async () => {
      const queryRaw = vi.fn().mockResolvedValue([{ should_alert: false }]);
      const db = {
        roleAssignment: { findMany: vi.fn().mockResolvedValue([{ role: "admin" }]) },
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "user-1", email: "admin@example.com" }),
          updateMany: vi.fn(),
        },
        $queryRaw: queryRaw,
      } as unknown as PrismaClient;

      await recordFailedMfaFailureSideEffects(db, "user-1", { ip: "1.2.3.4" });

      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(String(queryRaw.mock.calls[0]![0])).toContain("failed_mfa_streak");
    });

    it("emits auth.mfa.repeated_failures when the atomic bump wraps at the threshold", async () => {
      const queryRaw = vi.fn().mockResolvedValue([{ should_alert: true }]);
      const create = vi.fn().mockResolvedValue({});
      const db = {
        roleAssignment: { findMany: vi.fn().mockResolvedValue([{ role: "superadmin" }]) },
        user: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({ id: "user-1", email: "admin@example.com" })
            .mockResolvedValue({ email: "admin@example.com", display_name: null }),
          updateMany: vi.fn(),
        },
        $queryRaw: queryRaw,
        securityAuditLog: { create },
      } as unknown as PrismaClient;

      await recordFailedMfaFailureSideEffects(db, "user-1", { ip: "9.9.9.9" });

      expect(create).toHaveBeenCalledWith({
        data: {
          event_type: "auth.mfa.repeated_failures",
          user_id: "user-1",
          user_email: "admin@example.com",
          user_display_name: null,
          ip: "9.9.9.9",
          actor_timezone: null,
          metadata: { streak: PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD },
        },
      });
    });
  });

  describe("resetFailedMfaFailureStreak", () => {
    it("clears only a persisted nonzero MFA-failure streak", async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const db = fakeDb({ updateMany });
      await resetFailedMfaFailureStreak(db, "user-1");
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "user-1", failed_mfa_streak: { gt: 0 } },
        data: { failed_mfa_streak: 0 },
      });
    });
  });
});
