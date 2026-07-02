import type { PrismaClient } from "@prisma/client";
import { findUserByEmail, normalizeEmail, purgeAllSessions, revokeUserAuthState } from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { CliError, arg, hasFlag, parseFormat } from "../lib/args.js";
import { requireOperatorUserId } from "../lib/audit.js";
import { confirmYes } from "../lib/confirm.js";
import { formatJson } from "../lib/output.js";

export async function runSessionsRevokeUser(db: PrismaClient): Promise<void> {
  const email = arg("user");
  if (!email) {
    throw new CliError("Usage: admitto sessions revoke --user <email>");
  }

  if (hasFlag("dry-run")) {
    console.log(`Dry run: would revoke sessions and trusted devices for ${email}.`);
    return;
  }

  const user = await findUserByEmail(db, normalizeEmail(email));
  if (!user) {
    throw new CliError("User not found.");
  }

  const result = await revokeUserAuthState(db, user.id);
  console.log(
    `Revoked ${result.sessionsRevoked} session(s) and ${result.trustedDevicesRevoked} trusted device(s) for ${email}.`,
  );
}

export async function runSessionsPurgeAll(db: PrismaClient): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const yes = hasFlag("yes");

  if (!dryRun && !yes) {
    const ok = await confirmYes(
      "This revokes ALL active sessions and trusted devices instance-wide. Type 'yes' to confirm: ",
    );
    if (!ok) {
      throw new CliError("Aborted.");
    }
  }

  const result = await purgeAllSessions(db, { dryRun });
  const format = parseFormat();

  if (dryRun) {
    const msg = `Would revoke ${result.sessionsRevoked} session(s) and ${result.trustedDevicesRevoked} trusted device(s).`;
    console.log(format === "json" ? formatJson({ ...result, dryRun: true }) : msg);
    return;
  }

  const actorUserId = await requireOperatorUserId(db);
  await writeAdminAuditLog(db, {
    actorUserId,
    actionType: "emergency_session_purge",
    ip: "127.0.0.1",
    metadata: {
      source: "cli",
      sessionsRevoked: result.sessionsRevoked,
      trustedDevicesRevoked: result.trustedDevicesRevoked,
    },
  });

  const msg = `Purged ${result.sessionsRevoked} session(s) and ${result.trustedDevicesRevoked} trusted device(s).`;
  console.log(format === "json" ? formatJson(result) : msg);
}
