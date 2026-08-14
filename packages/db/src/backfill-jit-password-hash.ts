import type { PrismaClient } from "./generated/prisma/client.js";

/**
 * Idempotent backfill: nulls out `User.password_hash` for accounts that were JIT-provisioned by
 * an OIDC login and never had a real password set since (resolve-user.ts used to give these a
 * hash of an unknowable random value instead of `null`, which made `password_hash !== null`
 * checks throughout the app - "does this account have a local password?" - wrongly report true).
 *
 * A row only matches when it's provably still that original, nobody-knows-it value:
 * - `ExternalIdentity.linked_at` within 5 seconds of `User.created_at` - JIT provisioning
 *   creates the User row and its ExternalIdentity row in the same transaction (resolve-user.ts),
 *   back to back with no I/O in between, so in practice the two `CURRENT_TIMESTAMP` defaults land
 *   within a couple of milliseconds of each other (confirmed empirically - Prisma 7's driver-
 *   adapter query engine does not freeze `now()` per-transaction the way raw Postgres does, so
 *   exact equality is NOT safe here). 5 seconds is generous headroom for that drift while still
 *   being far too tight for a real admin/user action (linking SSO onto a pre-existing local
 *   account) to collide with by coincidence - that always leaves `linked_at` at least minutes,
 *   usually much longer, after `created_at`.
 * - No `AdminAuditLog` row of `account_password_changed` (self-service: change-password, the
 *   forced must-change-password flow, or self-unlink-with-new-password - all three write it with
 *   `actor_user_id` equal to the account itself) or `user_password_reset` (admin-initiated: the
 *   admin reset-password action or admin-initiated unlink, both keyed by `metadata.userId`)
 *   exists for this user - i.e. nobody has ever successfully set a real password on this account.
 *   `verifyPasswordOrDummy` against the original random hash always failed, so "changed
 *   successfully" and "still holds the original placeholder" are mutually exclusive by
 *   construction - this can't skip a row that secretly did get a real password.
 *
 * Runs automatically after `npm run db:migrate`; safe to re-run manually.
 */
export async function backfillJitPasswordHash(prisma: PrismaClient): Promise<{ updated: number }> {
  const updated = await prisma.$executeRaw`
    UPDATE "User" u
    SET password_hash = NULL
    FROM "ExternalIdentity" ei
    WHERE ei.user_id = u.id
      AND ABS(EXTRACT(EPOCH FROM (ei.linked_at - u.created_at))) < 5
      AND u.password_hash IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "AdminAuditLog" log
        WHERE (log.action_type = 'account_password_changed' AND log.actor_user_id = u.id)
           OR (log.action_type = 'user_password_reset' AND log.metadata ->> 'userId' = u.id)
      )
  `;
  return { updated };
}
