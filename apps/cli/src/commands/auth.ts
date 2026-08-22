import { createInterface, type Interface } from "node:readline";
import type { PrismaClient } from "@admitto/db";
import {
  bootstrapSuperadmin,
  findUserByEmail,
  generateEmergencyRecoveryCode,
  logMfaBreakGlassCli,
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
  PasswordPolicyError,
  resetUserMfa,
  superadminInstanceExists,
  userIsInstanceSuperadmin,
  verifyPassword,
} from "@admitto/auth";
import {
  assertNoPasswordArgv,
  createLineReader,
  readPasswordFromStdin,
} from "@admitto/auth/cli-helpers";
import { CliError, arg, hasFlag } from "../lib/args.js";
import { confirmYes } from "../lib/confirm.js";

type ForceConfirmResult = { rl: Interface; readLine: (prompt: string) => Promise<string> } | undefined;

// Returns the readline.Interface (and its line reader) it prompted on, if any, so the caller
// can reuse the same one for the password prompt right after this. See createLineReader's own
// comment (@admitto/auth/cli-helpers) for why chaining two separate prompts on piped (non-TTY)
// stdin needs this instead of a plain confirmYes() + readPasswordFromStdin() pair, each reading
// from its own fresh interface.
async function assertBootstrapForceAllowed(db: PrismaClient, force: boolean): Promise<ForceConfirmResult> {
  const exists = await superadminInstanceExists(db);
  if (!exists) return undefined;
  if (!force) {
    throw new CliError(
      "superadmin@instance already exists. Use --force to create another (with confirmation).",
    );
  }
  if (hasFlag("yes")) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const readLine = createLineReader(rl, process.stderr);
  const confirmed = await confirmYes(
    "A superadmin@instance already exists. Type 'yes' to create another: ",
    readLine,
  );
  if (!confirmed) {
    rl.close();
    throw new CliError("Aborted.");
  }
  return { rl, readLine };
}

async function bootstrapSuperadminChecked(
  db: PrismaClient,
  email: string,
  password: string,
): Promise<string> {
  try {
    const { userId } = await bootstrapSuperadmin(db, email, password);
    return userId;
  } catch (err) {
    if (err instanceof PasswordPolicyError) {
      if (err.code === "password_too_short") {
        throw new CliError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      }
      throw new CliError("Password is too common or predictable. Choose a different one.");
    }
    throw err;
  }
}

async function verifyTargetUserPassword(
  db: PrismaClient,
  email: string,
): Promise<{ userId: string }> {
  assertNoPasswordArgv(process.argv);
  const normalized = normalizeEmail(email);
  const user = await findUserByEmail(db, normalized);
  if (!user) {
    throw new CliError("User not found.");
  }
  const isSuperadmin = await userIsInstanceSuperadmin(db, user.id);
  if (!isSuperadmin) {
    throw new CliError("Break-glass MFA commands require a superadmin@instance user.");
  }
  const password = await readPasswordFromStdin("Target superadmin password: ");
  if (!user.password_hash) {
    throw new CliError("Password verification failed.");
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    throw new CliError("Password verification failed.");
  }
  return { userId: user.id };
}

export async function runAuthBootstrapSuperadmin(db: PrismaClient): Promise<void> {
  // Checked before any DB lookup or interactive prompt below - assertBootstrapForceAllowed's
  // confirmation prompt (on --force against an existing instance) is blocking, and would
  // otherwise leave a --password=<value> argv sitting in the process list for the whole time
  // the operator spends answering it.
  assertNoPasswordArgv(process.argv);

  const email = arg("email");
  if (!email) {
    throw new CliError("Usage: admitto auth bootstrap-superadmin --email <email> [--force]");
  }

  const forceConfirm = await assertBootstrapForceAllowed(db, hasFlag("force"));

  const password = await readPasswordFromStdin("Password: ", forceConfirm?.readLine);
  forceConfirm?.rl.close();
  const userId = await bootstrapSuperadminChecked(db, email, password);
  // bootstrapSuperadmin writes the auth.superadmin.bootstrap audit record itself, inside the
  // same transaction as the account creation - no separate call needed here.
  console.log(`Superadmin created: ${userId} (${email})`);
}

export async function runAuthResetMfa(db: PrismaClient): Promise<void> {
  const email = arg("email");
  if (!email) {
    throw new CliError("Usage: admitto auth reset-mfa --email <email>");
  }
  const { userId } = await verifyTargetUserPassword(db, email);
  await resetUserMfa(db, userId);
  await logMfaBreakGlassCli(db, { action: "reset_mfa", email, userId });
  console.log(`MFA reset for ${email} (sessions and trusted devices revoked).`);
}

export async function runAuthGenerateEmergencyRecovery(db: PrismaClient): Promise<void> {
  const email = arg("email");
  if (!email) {
    throw new CliError("Usage: admitto auth generate-emergency-recovery --email <email>");
  }
  const { userId } = await verifyTargetUserPassword(db, email);
  const { code } = await generateEmergencyRecoveryCode(db, userId);
  await logMfaBreakGlassCli(db, { action: "generate_emergency_recovery", email, userId });
  console.log(`Emergency one-time recovery code (shown once): ${code}`);
}
