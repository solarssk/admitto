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
const fakeReadLine = vi.fn();
const createLineReader = vi.fn(() => fakeReadLine);

vi.mock("@admitto/auth/cli-helpers", () => ({
  assertNoPasswordArgv: (...args: unknown[]) => assertNoPasswordArgv(...args),
  readPasswordFromStdin: (...args: unknown[]) => readPasswordFromStdin(...args),
  createLineReader: (...args: unknown[]) => createLineReader(...args),
}));

const confirmYes = vi.fn();

vi.mock("../src/lib/confirm.js", () => ({
  confirmYes: (...args: unknown[]) => confirmYes(...args),
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
    confirmYes.mockReset();
    createLineReader.mockReset().mockReturnValue(fakeReadLine);
    fakeReadLine.mockReset();
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("bootstraps the superadmin and does not call logMfaBreakGlassCli itself", async () => {
    process.argv = ["node", "admitto", "auth", "bootstrap-superadmin", "--email", "admin@example.com"];
    bootstrapSuperadmin.mockResolvedValue({ userId: "user-1" });
    const db = fakeDb();

    await runAuthBootstrapSuperadmin(db);

    expect(bootstrapSuperadmin).toHaveBeenCalledWith(db, "admin@example.com", "Sup3rSecret!23");
    // bootstrapSuperadmin now writes its own auth.superadmin.bootstrap audit record atomically,
    // inside the same transaction as account creation (see packages/auth/src/bootstrap.ts and
    // its own test in packages/auth/test/auth.test.ts) - this layer must not also call
    // logMfaBreakGlassCli, which would both double-log and use the wrong event type.
    expect(logMfaBreakGlassCli).not.toHaveBeenCalled();
  });

  it("rejects a bad-password argv before checking whether a superadmin already exists", async () => {
    process.argv = [
      "node",
      "admitto",
      "auth",
      "bootstrap-superadmin",
      "--email",
      "admin@example.com",
      "--force",
      "--password=hunter2",
    ];
    const callOrder: string[] = [];
    assertNoPasswordArgv.mockImplementation(() => {
      callOrder.push("assertNoPasswordArgv");
      throw new Error("Password cannot be passed via --password; use the stdin prompt.");
    });
    superadminInstanceExists.mockImplementation(async () => {
      callOrder.push("superadminInstanceExists");
      return true;
    });

    await expect(runAuthBootstrapSuperadmin(fakeDb())).rejects.toThrow(
      "Password cannot be passed via --password; use the stdin prompt.",
    );

    // If the argv guard ran after the existence check (the pre-fix ordering), a --force run
    // against an existing instance would have hit the blocking confirmForce() prompt first,
    // leaving the plaintext password on argv for the whole time an operator spent answering it.
    expect(callOrder).toEqual(["assertNoPasswordArgv"]);
    expect(superadminInstanceExists).not.toHaveBeenCalled();
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

  it("reuses one createLineReader() line reader for both the force-confirmation and password prompts", async () => {
    // Regression: two separate readline interfaces (or two separate one-shot question() calls)
    // chained on the same piped stdin can hang forever when both answers arrive in a single
    // chunk - see createLineReader's own comment (@admitto/auth/cli-helpers). This asserts the
    // wiring stays fixed: confirmYes and readPasswordFromStdin must receive the exact same line
    // reader, not two independent ones.
    process.argv = ["node", "admitto", "auth", "bootstrap-superadmin", "--email", "admin@example.com", "--force"];
    superadminInstanceExists.mockResolvedValue(true);
    confirmYes.mockImplementation(async () => true);
    bootstrapSuperadmin.mockResolvedValue({ userId: "user-1" });
    const db = fakeDb();

    await runAuthBootstrapSuperadmin(db);

    expect(createLineReader).toHaveBeenCalledTimes(1);
    expect(confirmYes).toHaveBeenCalledWith(expect.any(String), fakeReadLine);
    expect(readPasswordFromStdin).toHaveBeenCalledWith("Password: ", fakeReadLine);
  });

  it("rejects when a superadmin already exists and --force wasn't passed", async () => {
    process.argv = ["node", "admitto", "auth", "bootstrap-superadmin", "--email", "admin@example.com"];
    superadminInstanceExists.mockResolvedValue(true);
    const db = fakeDb();

    await expect(runAuthBootstrapSuperadmin(db)).rejects.toThrow(
      "superadmin@instance already exists. Use --force to create another (with confirmation).",
    );

    expect(confirmYes).not.toHaveBeenCalled();
    expect(readPasswordFromStdin).not.toHaveBeenCalled();
    expect(bootstrapSuperadmin).not.toHaveBeenCalled();
  });

  it("aborts without prompting for a password when the force-confirmation is answered no", async () => {
    process.argv = ["node", "admitto", "auth", "bootstrap-superadmin", "--email", "admin@example.com", "--force"];
    superadminInstanceExists.mockResolvedValue(true);
    confirmYes.mockImplementation(async () => false);
    const db = fakeDb();

    await expect(runAuthBootstrapSuperadmin(db)).rejects.toThrow("Aborted.");

    expect(readPasswordFromStdin).not.toHaveBeenCalled();
    expect(bootstrapSuperadmin).not.toHaveBeenCalled();
  });
});
