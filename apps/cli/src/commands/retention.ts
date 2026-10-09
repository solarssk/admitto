import type { PrismaClient } from "@admitto/db";
import { purgeAuthRetention, purgeSecurityAuditLog, resolveSecurityAuditLogRetentionDays } from "@admitto/auth";
import { nullifyDeliverySnapshots, resolveDeliverySnapshotRetentionDays } from "@admitto/mail-delivery";
import { purgeNotifications, resolveNotificationRetentionDays } from "@admitto/notifications";
import { writeAdminAuditLog } from "@admitto/tickets";
import { hasFlag } from "../lib/args.js";
import { requireOperatorUserId } from "../lib/audit.js";
import { erasedWalletPassesLeft, sweepErasedWalletPasses } from "../lib/retention-erased-wallet-passes.js";
import { purgeJobFilesForRetention } from "../lib/retention-job-files.js";

export async function runRetention(db: PrismaClient): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const retentionDays = resolveSecurityAuditLogRetentionDays(process.env);
  const notificationRetentionDays = resolveNotificationRetentionDays(process.env);
  const snapshotRetentionDays = resolveDeliverySnapshotRetentionDays(process.env);

  if (!dryRun) {
    const actorUserId = await requireOperatorUserId(db);
    const authResult = await purgeAuthRetention(db, { dryRun: false });
    const mailResult = await nullifyDeliverySnapshots(db, {
      dryRun: false,
      retentionDays: snapshotRetentionDays,
    });
    const securityAuditResult = await purgeSecurityAuditLog(db, { dryRun: false, retentionDays });
    const notificationsResult = await purgeNotifications(db, {
      dryRun: false,
      retentionDays: notificationRetentionDays,
    });
    const jobFilesResult = await purgeJobFilesForRetention(db, false);
    const walletSweep = await sweepErasedWalletPasses(db, { dryRun: false });
    const walletPassesLeft = erasedWalletPassesLeft(walletSweep);

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
        exportFiles: jobFilesResult.exportFiles,
        stagedImportFiles: jobFilesResult.stagedImportFiles,
        erasedWalletPassesDeleted: walletSweep.deleted,
        erasedWalletPassesLeft: walletPassesLeft,
      },
    });

    const failedFilesNote = jobFilesResult.failures > 0 ? ` (${jobFilesResult.failures} could not be deleted)` : "";
    const walletPassesLeftNote = walletPassesLeft > 0 ? ` (${walletPassesLeft} still to delete, see the System logs)` : "";
    console.log(
      `Purged/nullified auth: ${authResult.sessions} sessions, ${authResult.trustedDevices} trusted devices; ` +
        `mail: ${mailResult.deliveries} delivery snapshot(s); ` +
        `security audit log: ${securityAuditResult.deleted} row(s); ` +
        `notifications: ${notificationsResult.deleted} row(s); ` +
        `job files: ${jobFilesResult.exportFiles} export file(s), ${jobFilesResult.stagedImportFiles} staged import CSV(s)` +
        `${failedFilesNote}; ` +
        `erased wallet passes: ${walletSweep.deleted} deleted at the provider` +
        `${walletPassesLeftNote}.`,
    );
    return;
  }

  const authResult = await purgeAuthRetention(db, { dryRun: true });
  const mailResult = await nullifyDeliverySnapshots(db, {
    dryRun: true,
    retentionDays: snapshotRetentionDays,
  });
  const securityAuditResult = await purgeSecurityAuditLog(db, { dryRun: true, retentionDays });
  const notificationsResult = await purgeNotifications(db, {
    dryRun: true,
    retentionDays: notificationRetentionDays,
  });
  const jobFilesResult = await purgeJobFilesForRetention(db, true);
  const walletSweep = await sweepErasedWalletPasses(db, { dryRun: true });

  console.log(
    `Would purge/nullify auth: ${authResult.sessions} sessions, ${authResult.trustedDevices} trusted devices; ` +
      `mail: ${mailResult.deliveries} delivery snapshot(s); ` +
      `security audit log: ${securityAuditResult.deleted} row(s); ` +
      `notifications: ${notificationsResult.deleted} row(s); ` +
      `job files: ${jobFilesResult.exportFiles} export file(s), ${jobFilesResult.stagedImportFiles} staged import CSV(s); ` +
      `erased wallet passes: ${walletSweep.pending} still to delete at the provider.`,
  );
}
