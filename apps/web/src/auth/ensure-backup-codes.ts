import type { PrismaClient } from "@prisma/client";
import { regenerateBackupRecoveryCodes } from "@admitto/auth";
import {
  extendEnrollmentBackupCodes,
  getStashedEnrollmentBackupCodes,
  stashEnrollmentBackupCodes,
} from "./enrollment-backup-cache.js";

/**
 * Guarantee plaintext backup codes are available in the stash for a session that
 * has (re)entered the `backup_codes_required` stage outside the normal QR-confirm
 * flow — e.g. after a fresh login completes MFA while codes are still owed, or
 * when the completion request lands on a different process (IAM-002).
 *
 * Returns the codes that should be shown to the user once.
 */
export async function ensureEnrollmentBackupCodesStashed(
  db: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<string[]> {
  const existing = getStashedEnrollmentBackupCodes(sessionId);
  if (existing?.length) {
    extendEnrollmentBackupCodes(sessionId);
    return existing;
  }
  const { codes } = await regenerateBackupRecoveryCodes(db, userId);
  stashEnrollmentBackupCodes(sessionId, codes);
  extendEnrollmentBackupCodes(sessionId);
  return codes;
}
