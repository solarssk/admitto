import type { PrismaClient } from "@prisma/client";
import { purgeAuthRetention } from "@admitto/auth";
import { nullifyDeliverySnapshots } from "@admitto/mail-delivery";
import { writeAdminAuditLog } from "@admitto/tickets";
import { hasFlag } from "../lib/args.js";
import { requireOperatorUserId } from "../lib/audit.js";

export async function runRetention(db: PrismaClient): Promise<void> {
  const dryRun = hasFlag("dry-run");

  if (!dryRun) {
    const actorUserId = await requireOperatorUserId(db);
    const authResult = await purgeAuthRetention(db, { dryRun: false });
    const mailResult = await nullifyDeliverySnapshots(db, { dryRun: false });

    await writeAdminAuditLog(db, {
      actorUserId,
      actionType: "retention_run",
      ip: "127.0.0.1",
      metadata: {
        source: "cli",
        authSessions: authResult.sessions,
        authTrustedDevices: authResult.trustedDevices,
        mailDeliveries: mailResult.deliveries,
      },
    });

    console.log(
      `Purged/nullified auth: ${authResult.sessions} sessions, ${authResult.trustedDevices} trusted devices; ` +
        `mail: ${mailResult.deliveries} delivery snapshot(s).`,
    );
    return;
  }

  const authResult = await purgeAuthRetention(db, { dryRun: true });
  const mailResult = await nullifyDeliverySnapshots(db, { dryRun: true });

  console.log(
    `Would purge/nullify auth: ${authResult.sessions} sessions, ${authResult.trustedDevices} trusted devices; ` +
      `mail: ${mailResult.deliveries} delivery snapshot(s).`,
  );
}
