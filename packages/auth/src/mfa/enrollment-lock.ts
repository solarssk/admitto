import type { Prisma } from "@admitto/db";

/** Serialize the "is this the account's first MFA method?" decision for one user. Taken as the
 * first statement of every transaction that adds an MFA method behind that decision (the account
 * page's ungated first-method path and the login-time enrollment finishes), so two overlapping
 * enrollments run one after the other and the later one re-checks after the earlier one's commit. */
export async function acquireMfaEnrollmentLock(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const key = `account-mfa-enroll:${userId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
