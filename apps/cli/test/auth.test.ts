import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";

const bootstrapSuperadmin = vi.fn();
const findUserByEmail = vi.fn();
const generateEmergencyRecoveryCode = vi.fn();
const logMfaBreakGlassCli = vi.fn();
const normalizeEmail = vi.fn((email: string) => email.toLowerCase());
const resetUserMfa = vi.fn();
const superadminInstanceExists = vi.fn();
const userIsInstanceSuperadmin = vi.fn();
const verifyPassword = vi.fn();

class PasswordPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

vi.mock("@admitto/auth", () => ({
  bootstrapSuperadmin: (...args: unknown[]) => bootstrapSuperadmin(...args),
  findUserByEmail: (...args: unknown[]) => findUserByEmail(...args),
  generateEmergencyRecoveryCode: (...args: unknown[]) => generateEmergencyRecoveryCode(...args),
  logMfaBreakGlassCli: (...args: unknown[]) => logMfaBreakGlassCli(...args),
  normalizeEmail: (...args: unknown[]) => normalizeEmail(...args),
  PASSWORD_MIN_LENGTH: 12,
  PasswordPolicyError,
  resetUserMfa: (...args: unknown[]) => resetUserMfa(...args),
  superadminInstanceExists: (...args: unknown[]) => superadminInstanceExists(...args),
  userIsInstanceSuperadmin: (...args: unknown[]) => userIsInstanceSuperadmin(...args),
  verifyPassword: (...args: unknown[]) => verifyPassword(...args),
}));

const assertNoPasswordArgv = vi.fn();
const readPasswordFromStdin = vi.fn();

vi.mock("@admitto/auth/cli-helpers", () => ({
  assertNoPasswordArgv: (...args: unknown[]) => assertNoPasswordArgv(...args),
  readPasswordFromStdin: (...args: unknown[]) => readPasswordFromStdin(...args),
}));

const { runAuthBootstrapSuperadmin } = await import("../src/commands/auth.js");

function fakeDb(): PrismaClient {
  return {} as PrismaClient;
}

describe("runAuthBootstrapSuperadmin", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    bootstrapSuperadmin.mockReset();
    logMfaBreakGlassCli.mockReset().mockResolvedValue(undefined);
    superadminInstanceExists.mockReset().mockResolvedValue(false);
    assertNoPasswordArgv.mockReset();
    readPasswordFromStdin.mockReset().mockResolvedValue("Sup3rSecret!23");
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("records a bootstrap_superadmin audit entry after a successful bootstrap", async () => {
    process.argv = ["node", "admitto", "auth", "bootstrap-superadmin", "--email", "admin@example.com"];
    bootstrapSuperadmin.mockResolvedValue({ userId: "user-1" });
    const db = fakeDb();

    await runAuthBootstrapSuperadmin(db);

    expect(logMfaBreakGlassCli).toHaveBeenCalledWith(db, {
      action: "bootstrap_superadmin",
      email: "admin@example.com",
      userId: "user-1",
    });
  });

  it("rejects --password=<value> on argv before ever prompting for a password or creating a superadmin", async () => {
    process.argv = [
      "node",
      "admitto",
      "auth",
      "bootstrap-superadmin",
      "--email",
      "admin@example.com",
      "--password=hunter2",
    ];
    // Mirrors the real assertNoPasswordArgv fix (packages/auth/src/cli-helpers.ts), whose own
    // matching logic is exercised directly in packages/auth/test/cli.test.ts.
    assertNoPasswordArgv.mockImplementation((argv: string[]) => {
      if (argv.some((a) => a === "--password" || a.startsWith("--password="))) {
        throw new Error("Password cannot be passed via --password; use the stdin prompt.");
      }
    });
    const db = fakeDb();

    await expect(runAuthBootstrapSuperadmin(db)).rejects.toThrow(
      "Password cannot be passed via --password; use the stdin prompt.",
    );

    expect(readPasswordFromStdin).not.toHaveBeenCalled();
    expect(bootstrapSuperadmin).not.toHaveBeenCalled();
    expect(logMfaBreakGlassCli).not.toHaveBeenCalled();
  });
});
