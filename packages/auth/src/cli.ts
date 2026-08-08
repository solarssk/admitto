#!/usr/bin/env node
/**
 * Auth CLI — bootstrap superadmin, MFA break-glass (prompt 16a).
 *
 *   npm run cli -w @admitto/auth -- bootstrap-superadmin --email admin@example.com
 *   npm run cli -w @admitto/auth -- reset-mfa --email superadmin@example.com
 *   npm run cli -w @admitto/auth -- generate-emergency-recovery --email superadmin@example.com
 *   npm run cli -w @admitto/auth -- purge-auth-retention [--dry-run]
 *   npm run cli -w @admitto/auth -- purge-security-audit-log [--dry-run]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { prisma } from "@admitto/db";
import { bootstrapSuperadmin, superadminInstanceExists, userIsInstanceSuperadmin } from "./bootstrap.js";
import { PASSWORD_MIN_LENGTH } from "./constants.js";
import { PasswordPolicyError } from "./password-policy.js";
import { findUserByEmail, normalizeEmail } from "./user.js";
import { verifyPassword } from "./password.js";
import { resetUserMfa } from "./mfa/enrollment.js";
import { generateEmergencyRecoveryCode } from "./mfa/emergency-recovery.js";
import { logMfaBreakGlass } from "./audit.js";
import { loadEnvFile } from "@admitto/shared/load-env-file";
import { assertNoPasswordArgv, CliError, readPasswordFromStdin } from "./cli-helpers.js";
import { purgeAuthRetention, purgeSecurityAuditLog, resolveSecurityAuditLogRetentionDays } from "./retention.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): void {
  const monorepoRoot = path.join(__dirname, "..", "..", "..");
  const candidates = [
    path.join(monorepoRoot, ".env"),
    path.join(monorepoRoot, "packages", "db", ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const envPath of candidates) {
    loadEnvFile(envPath);
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.error(`Usage:
  npm run cli -w @admitto/auth -- bootstrap-superadmin --email <email> [--force]
  npm run cli -w @admitto/auth -- reset-mfa --email <email>
  npm run cli -w @admitto/auth -- generate-emergency-recovery --email <email>
  npm run cli -w @admitto/auth -- purge-auth-retention [--dry-run]
  npm run cli -w @admitto/auth -- purge-security-audit-log [--dry-run]`);
  throw new CliError("Invalid usage");
}

async function confirmForce(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(
      "A superadmin@instance already exists. Type 'yes' to create another: ",
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "yes");
      },
    );
  });
}

async function verifyTargetUserPassword(email: string): Promise<{ userId: string }> {
  assertNoPasswordArgv(process.argv);

  const normalized = normalizeEmail(email);
  const user = await findUserByEmail(prisma, normalized);
  if (!user) {
    throw new CliError("User not found.");
  }

  const isSuperadmin = await userIsInstanceSuperadmin(prisma, user.id);
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

async function runBootstrapSuperadmin(): Promise<void> {
  const email = arg("email");
  if (!email) usage();

  const force = hasFlag("force");
  const exists = await superadminInstanceExists(prisma);
  if (exists && !force) {
    throw new CliError(
      "superadmin@instance already exists. Use --force to create another (with confirmation).",
    );
  }
  if (exists && force) {
    const ok = await confirmForce();
    if (!ok) {
      throw new CliError("Aborted.");
    }
  }

  const password = await readPasswordFromStdin();
  let userId: string;
  try {
    ({ userId } = await bootstrapSuperadmin(prisma, email, password));
  } catch (err) {
    if (err instanceof PasswordPolicyError) {
      if (err.code === "password_too_short") {
        throw new CliError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      }
      throw new CliError(
        "Password is too common or predictable. Choose a different one.",
      );
    }
    throw err;
  }
  console.log(`Superadmin created: ${userId} (${email})`);
}

async function runResetMfa(): Promise<void> {
  const email = arg("email");
  if (!email) usage();

  const { userId } = await verifyTargetUserPassword(email);
  await resetUserMfa(prisma, userId);
  await logMfaBreakGlass(prisma, { action: "reset_mfa", email, userId, quiet: true });
  console.log(`MFA reset for ${email} (sessions and trusted devices revoked).`);
}

async function runGenerateEmergencyRecovery(): Promise<void> {
  const email = arg("email");
  if (!email) usage();

  const { userId } = await verifyTargetUserPassword(email);
  const { code } = await generateEmergencyRecoveryCode(prisma, userId);
  await logMfaBreakGlass(prisma, { action: "generate_emergency_recovery", email, userId, quiet: true });
  console.log(`Emergency one-time recovery code (shown once): ${code}`);
}

async function runPurgeAuthRetention(): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const result = await purgeAuthRetention(prisma, { dryRun });
  const verb = dryRun ? "Would delete" : "Deleted";
  console.log(
    `${verb} ${result.sessions} expired/revoked sessions and ${result.trustedDevices} expired/revoked trusted devices.`,
  );
}

async function runPurgeSecurityAuditLog(): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const retentionDays = resolveSecurityAuditLogRetentionDays(process.env);
  const result = await purgeSecurityAuditLog(prisma, { dryRun, retentionDays });
  const verb = dryRun ? "Would delete" : "Deleted";
  console.log(`${verb} ${result.deleted} security audit log row(s) older than ${retentionDays} days.`);
}

async function main(): Promise<void> {
  loadDotEnv();

  if (!process.env["DATABASE_URL"]) {
    throw new CliError("DATABASE_URL is required");
  }

  const sub = process.argv[2];
  if (sub === "bootstrap-superadmin") {
    await runBootstrapSuperadmin();
  } else if (sub === "reset-mfa") {
    await runResetMfa();
  } else if (sub === "generate-emergency-recovery") {
    await runGenerateEmergencyRecovery();
  } else if (sub === "purge-auth-retention") {
    await runPurgeAuthRetention();
  } else if (sub === "purge-security-audit-log") {
    await runPurgeSecurityAuditLog();
  } else {
    usage();
  }
}

try {
  await main();
} catch (err) {
  if (err instanceof CliError) {
    console.error(err.message);
    process.exitCode = err.exitCode;
  } else {
    console.error(err);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
