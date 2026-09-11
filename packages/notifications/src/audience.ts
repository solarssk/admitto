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

/** The event's targetUserId, but only once confirmed to be an active user with a real role
 * assignment in this organization (or instance-wide) - never trusts the call site blindly
 * (prompt 86 §3: "nie ufaj call-site'owi bezkrytycznie"). Returns [] (not a throw) for a
 * missing targetUserId, an inactive user, or a user with no standing in this organization -
 * dispatcher.ts logs and skips on an empty audience rather than failing the caller.
 *
 * "Standing in this organization" includes an event-scoped role assignment for one of this
 * organization's own events, not just instance-/organization-scoped ones - an operator (the
 * typical event-scoped role, see account-routes.ts's own ROLE_PRIORITY) is exactly the kind of
 * user account.auth_factor.changed (ASVS V2.5.5) exists to protect, same as any admin. Missing
 * this originally (checking only scope_type "instance"/"organization") went unnoticed because no
 * registered type used audience "self" until account.auth_factor.changed did - re-verified
 * against the real seeded fixtures in apps/web's own integration tests, not just read as correct.
 */
async function resolveSelf(db: Db, ctx: AudienceContext): Promise<string[]> {
  if (!ctx.targetUserId) return [];

  const user = await db.user.findUnique({
    where: { id: ctx.targetUserId },
    select: { is_active: true },
  });
  if (!user?.is_active) return [];

  const assignments = await db.roleAssignment.findMany({
    where: { user_id: ctx.targetUserId },
    select: { scope_type: true, scope_id: true },
  });

  const hasDirectStanding = assignments.some(
    (a) => a.scope_type === "instance" || (a.scope_type === "organization" && a.scope_id === ctx.organizationId),
  );
  if (hasDirectStanding) return [ctx.targetUserId];

  const eventScopeIds = assignments
    .filter((a) => a.scope_type === "event" && a.scope_id)
    .map((a) => a.scope_id as string);
  if (eventScopeIds.length === 0) return [];

  const ownedEventCount = await db.event.count({
    where: { id: { in: eventScopeIds }, organization_id: ctx.organizationId },
  });
  return ownedEventCount > 0 ? [ctx.targetUserId] : [];
}
