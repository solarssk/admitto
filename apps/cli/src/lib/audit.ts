import type { PrismaClient } from "@admitto/db";
import { findUserByEmail, normalizeEmail } from "@admitto/auth";
import type { OpsAuditContext } from "@admitto/tickets";
import { CliError, arg } from "./args.js";

export async function resolveOperatorContext(
  db: PrismaClient,
  argv: string[] = process.argv,
): Promise<OpsAuditContext> {
  const email = arg("operator-email", argv);
  if (!email) {
    return { operator: "cli", ip: "127.0.0.1" };
  }
  const user = await findUserByEmail(db, normalizeEmail(email));
  if (!user) {
    throw new CliError(`Operator user not found: ${email}`);
  }
  return { operator: user.id, ip: "127.0.0.1" };
}

export async function requireOperatorUserId(
  db: PrismaClient,
  argv: string[] = process.argv,
): Promise<string> {
  const email = arg("operator-email", argv);
  if (!email) {
    throw new CliError("--operator-email is required for this command (AdminAuditLog actor).");
  }
  const user = await findUserByEmail(db, normalizeEmail(email));
  if (!user) {
    throw new CliError(`Operator user not found: ${email}`);
  }
  return user.id;
}
