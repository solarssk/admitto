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
  readPasswordFromStdin,
} from "@admitto/auth/cli-helpers";
import { CliError, arg, hasFlag } from "../lib/args.js";
import { confirmYes } from "../lib/confirm.js";

async function confirmForce(): Promise<boolean> {
  return confirmYes("A superadmin@instance already exists. Type 'yes' to create another: ");
}

async function assertBootstrapForceAllowed(db: PrismaClient, force: boolean): Promise<void> {
  const exists = await superadminInstanceExists(db);
  if (!exists) return;
  if (!force) {
    throw new CliError(
      "superadmin@instance already exists. Use --force to create another (with confirmation).",
    );
  }
  if (hasFlag("yes")) return;
  if (!(await confirmForce())) {
    throw new CliError("Aborted.");
  }
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
  const email = arg("email");
  if (!email) {
    throw new CliError("Usage: admitto auth bootstrap-superadmin --email <email> [--force]");
  }

  await assertBootstrapForceAllowed(db, hasFlag("force"));

  assertNoPasswordArgv(process.argv);
  const password = await readPasswordFromStdin();
  const userId = await bootstrapSuperadminChecked(db, email, password);
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
