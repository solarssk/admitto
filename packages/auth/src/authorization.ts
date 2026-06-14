import type { PrismaClient, Prisma } from "@prisma/client";
import { hasScope } from "@admitto/db";

/** High-level permission names used by HTTP middleware and future admin UI. */
export type AuthCapability = "checkin" | "manageEvent" | "manageInstance";

async function loadEventOrgId(
  prisma: PrismaClient | Prisma.TransactionClient,
  eventId: string,
): Promise<string | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organization_id: true },
  });
  return event?.organization_id ?? null;
}

/** User can see the event within their scope (read/access boundary). */
export async function canAccessEvent(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  eventId: string,
): Promise<boolean> {
  if (await hasScope(prisma, userId, "superadmin", "instance")) return true;

  const orgId = await loadEventOrgId(prisma, eventId);
  if (!orgId) return false;

  if (await hasScope(prisma, userId, "admin", "organization", orgId)) return true;
  return hasScope(prisma, userId, "operator", "event", eventId);
}

/** Check-in allowed for superadmin, org admin, or event operator on target event. */
export async function canPerformCheckIn(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  eventId: string,
): Promise<boolean> {
  return canAccessEvent(prisma, userId, eventId);
}

/** Event management: superadmin or org admin for the event's organization. */
export async function canManageEvent(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  eventId: string,
): Promise<boolean> {
  if (await hasScope(prisma, userId, "superadmin", "instance")) return true;

  const orgId = await loadEventOrgId(prisma, eventId);
  if (!orgId) return false;

  return hasScope(prisma, userId, "admin", "organization", orgId);
}

/** Instance-wide administration. */
export async function canManageInstance(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  return hasScope(prisma, userId, "superadmin", "instance");
}

/** Dispatch a capability check; `eventId` required for event-scoped capabilities. */
export async function checkCapability(
  prisma: PrismaClient | Prisma.TransactionClient,
  capability: AuthCapability,
  userId: string,
  eventId?: string,
): Promise<boolean> {
  switch (capability) {
    case "checkin":
      if (!eventId) return false;
      return canPerformCheckIn(prisma, userId, eventId);
    case "manageEvent":
      if (!eventId) return false;
      return canManageEvent(prisma, userId, eventId);
    case "manageInstance":
      return canManageInstance(prisma, userId);
    default: {
      const _exhaustive: never = capability;
      return _exhaustive;
    }
  }
}
