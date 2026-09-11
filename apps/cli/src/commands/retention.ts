import type { PrismaClient } from "@admitto/db";
import { purgeAuthRetention, purgeSecurityAuditLog, resolveSecurityAuditLogRetentionDays } from "@admitto/auth";
import { nullifyDeliverySnapshots } from "@admitto/mail-delivery";
import { purgeNotifications, resolveNotificationRetentionDays } from "@admitto/notifications";
import { writeAdminAuditLog } from "@admitto/tickets";
import { hasFlag } from "../lib/args.js";
import { requireOperatorUserId } from "../lib/audit.js";

export async function runRetention(db: PrismaClient): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const retentionDays = resolveSecurityAuditLogRetentionDays(process.env);
  const notificationRetentionDays = resolveNotificationRetentionDays(process.env);

  if (!dryRun) {
    const actorUserId = await requireOperatorUserId(db);
    const authResult = await purgeAuthRetention(db, { dryRun: false });
    const mailResult = await nullifyDeliverySnapshots(db, { dryRun: false });
    const securityAuditResult = await purgeSecurityAuditLog(db, { dryRun: false, retentionDays });
    const notificationsResult = await purgeNotifications(db, {
      dryRun: false,
      retentionDays: notificationRetentionDays,
    });

    await writeAdminAuditLog(db, {
      actorUserId,
      actionType: "retention_run",
      ip: "127.0.0.1",
      metadata: {
        source: "cli",
        authSessions: authResult.sessions,
        authTrustedDevices: authResult.trustedDevices,
        mailDeliveries: mailResult.deliveries,
        securityAuditLogRows: securityAuditResult.deleted,
        notificationRows: notificationsResult.deleted,
      },
    });

    console.log(
      `Purged/nullified auth: ${authResult.sessions} sessions, ${authResult.trustedDevices} trusted devices; ` +
        `mail: ${mailResult.deliveries} delivery snapshot(s); ` +
        `security audit log: ${securityAuditResult.deleted} row(s); ` +
        `notifications: ${notificationsResult.deleted} row(s).`,
    );
    return;
  }

  const authResult = await purgeAuthRetention(db, { dryRun: true });
  const mailResult = await nullifyDeliverySnapshots(db, { dryRun: true });
  const securityAuditResult = await purgeSecurityAuditLog(db, { dryRun: true, retentionDays });
  const notificationsResult = await purgeNotifications(db, {
    dryRun: true,
    retentionDays: notificationRetentionDays,
  });

  console.log(
    `Would purge/nullify auth: ${authResult.sessions} sessions, ${authResult.trustedDevices} trusted devices; ` +
      `mail: ${mailResult.deliveries} delivery snapshot(s); ` +
      `security audit log: ${securityAuditResult.deleted} row(s); ` +
      `notifications: ${notificationsResult.deleted} row(s).`,
  );
}
