import type { PrismaClient } from "@admitto/db";
import type { NotificationAudienceKey } from "./types.js";

// Never Prisma.TransactionClient - see the Db comment in ./dispatcher.ts.
type Db = PrismaClient;

/** Thrown by resolveAudienceCandidates for "event-staff" - reserved for a future event-day-ops
 * notification prompt; no registry entry uses this strategy yet. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

export interface AudienceContext {
  organizationId: string;
  /** Required when strategy is "self"; ignored otherwise. */
  targetUserId?: string;
}

/**
 * Resolves the user_ids who should receive a notification for the given audience strategy.
 * Never throws for "org-staff"/"self" - always returns a possibly-empty array. dispatcher.ts
 * treats an empty array as "nothing to send", not an error.
 */
export async function resolveAudienceCandidates(
  db: Db,
  strategy: NotificationAudienceKey,
  ctx: AudienceContext,
): Promise<string[]> {
  switch (strategy) {
    case "org-staff":
      return resolveOrgStaff(db, ctx.organizationId);
    case "self":
      return resolveSelf(db, ctx);
    case "event-staff":
      throw new NotImplementedError(
        'audience "event-staff" is reserved for a future event-day-ops notification prompt and has no implementation yet',
      );
    default: {
      const exhaustive: never = strategy;
      throw new Error(`Unknown notification audience strategy: ${String(exhaustive)}`);
    }
  }
}

/** Every active superadmin (instance-scoped) plus every active admin scoped to this organization
 * - the same rule ADR 0044 §2 keeps unchanged from ADR 0038 §4: recipients for a security-critical
 * type are never narrowed to one person by a per-user preference, only the audience-resolution
 * rule below decides who is a candidate at all. */
async function resolveOrgStaff(db: Db, organizationId: string): Promise<string[]> {
  const assignments = await db.roleAssignment.findMany({
    where: {
      OR: [
        { role: "superadmin", scope_type: "instance" },
        { role: "admin", scope_type: "organization", scope_id: organizationId },
      ],
    },
    select: { user_id: true, user: { select: { is_active: true } } },
  });
  const activeUserIds = new Set(
    assignments.filter((assignment) => assignment.user.is_active).map((assignment) => assignment.user_id),
  );
  return [...activeUserIds];
}

/**
 * The event's targetUserId, but only once confirmed to be a real user row - never trusts the call
 * site blindly (prompt 86 §3: "nie ufaj call-site'owi bezkrytycznie"). Returns [] (not a throw)
 * for a missing targetUserId or a user id that doesn't exist - dispatcher.ts logs and skips on an
 * empty audience rather than failing the caller. The existence check itself matters, not just as
 * defense-in-depth: InAppChannel's Notification row has a real FK to User, so resolving a
 * genuinely nonexistent id here would surface as a DB constraint failure deep in dispatchToChannels
 * instead of a clean, early empty-audience skip.
 *
 * Deliberately does NOT also require the user to be active (an earlier version of this function
 * did). The admin UI exposes MFA reset/password reset/SSO unlink for a disabled account (only
 * SSO-managed status gates those actions, not is_active - apps/admin/src/pages/users/
 * UserEditModal.tsx), so gating delivery on is_active silently and permanently dropped this
 * mandatory notification for exactly that case, with no queue or replay once the account is later
 * re-enabled (bot review finding, PR #1308). A disabled account can still have its own real email
 * inbox and its own future re-enabled self, so there's no privacy or security reason to withhold
 * the alert - only a technical implementation habit (borrowed from resolveOrgStaff's own
 * is_active filter, which exists for a different reason: excluding a disabled ADMIN from being
 * bothered about someone else's incident, not about their own account).
 *
 * Also deliberately does NOT require a role assignment in `ctx.organizationId` (an even earlier
 * version of this function did, first instance-/organization-scoped only, then also
 * event-scoped). Every real call site already independently proves targetUserId's identity
 * before ever reaching notify() - it's either the authenticated caller's own session userId
 * (account-routes.ts's self-service endpoints), or a user id an admin route already wrote to
 * moments earlier in the same request (the admin-assisted reset paths this registers targets) -
 * so an org-membership gate here added no real protection, only two ways to wrongly reject a
 * legitimate recipient: `ctx.organizationId` for a self-audience type is whatever
 * resolveInstanceOrganizationId() happens to resolve (the instance's single default
 * organization), not necessarily an organization the recipient is actually a member of; and an
 * active user can genuinely have zero role assignments today - revoking a plain admin's or
 * operator's only role has no equivalent of assertLastSuperadminRemovalAllowed's lockout guard
 * (users-lockout-guards.ts), yet that account stays active and able to reach My Account. Found by
 * Codex bot review on PR #1304, once account.auth_factor.changed became the first real caller of
 * this audience strategy.
 */
async function resolveSelf(db: Db, ctx: AudienceContext): Promise<string[]> {
  if (!ctx.targetUserId) return [];

  const user = await db.user.findUnique({
    where: { id: ctx.targetUserId },
    select: { id: true },
  });
  if (!user) return [];

  return [ctx.targetUserId];
}
