import type { PrismaClient, Prisma } from "@admitto/db";
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

/** Admin panel entry (/admin picker) — no eventId required. */
export async function canAccessAdminPanel(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  if (await hasScope(prisma, userId, "superadmin", "instance")) return true;
  const adminOrg = await prisma.roleAssignment.findFirst({
    where: {
      user_id: userId,
      role: "admin",
      scope_type: "organization",
      scope_id: { not: null },
    },
    select: { id: true },
  });
  return adminOrg != null;
}

/** Check-in surface entry (/operator) — user can check in on at least one event. */
export async function canAccessCheckInPanel(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  if (await hasScope(prisma, userId, "superadmin", "instance")) {
    const event = await prisma.event.findFirst({ select: { id: true } });
    return event != null;
  }

  const assignments = await prisma.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true, scope_type: true, scope_id: true },
  });

  const orgIds = new Set<string>();
  const eventIds = new Set<string>();

  for (const a of assignments) {
    if (a.role === "admin" && a.scope_type === "organization" && a.scope_id) {
      orgIds.add(a.scope_id);
    }
    if (a.scope_type === "event" && a.scope_id && a.role === "operator") {
      eventIds.add(a.scope_id);
    }
  }

  if (orgIds.size === 0 && eventIds.size === 0) return false;

  const or: Prisma.EventWhereInput[] = [];
  if (orgIds.size > 0) {
    or.push({ organization_id: { in: [...orgIds] } });
  }
  if (eventIds.size > 0) {
    or.push({ id: { in: [...eventIds] } });
  }

  const event = await prisma.event.findFirst({
    where: { OR: or },
    select: { id: true },
  });
  return event != null;
}

export interface EventSummary {
  id: string;
  title: string;
  slug: string;
  date: Date;
  timezone: string;
  location: string | null;
  /** True when EventLocation has both latitude and longitude (static map preview available). */
  has_coordinates: boolean;
  organization_id: string;
  archived_at: Date | null;
  created_at: Date;
  created_by_user_id: string | null;
  created_by_timezone: string | null;
  archived_by_user_id: string | null;
  archived_by_timezone: string | null;
}

const eventSelect = {
  id: true,
  title: true,
  slug: true,
  date: true,
  timezone: true,
  location_details: { select: { venue_name: true, latitude: true, longitude: true } },
  organization_id: true,
  archived_at: true,
  created_at: true,
  created_by_user_id: true,
  created_by_timezone: true,
  archived_by_user_id: true,
  archived_by_timezone: true,
} as const;

/** Maps the raw `eventSelect` row (which has `location_details.venue_name`, a relation) to the
 * flat `EventSummary` shape callers expect (`location: string | null`) — keeps this internal
 * schema detail from leaking into every call site. */
function toEventSummary(
  row: Prisma.EventGetPayload<{ select: typeof eventSelect }>,
): EventSummary {
  const { location_details, ...rest } = row;
  const lat = location_details?.latitude;
  const lng = location_details?.longitude;
  return {
    ...rest,
    location: location_details?.venue_name ?? null,
    has_coordinates: lat != null && lng != null,
  };
}

/** Events where user has check-in capability (matches canPerformCheckIn). Excludes archived events — archiving an event ends check-in for it, same as admin mutating APIs. */
export async function listCheckInEvents(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<EventSummary[]> {
  if (await hasScope(prisma, userId, "superadmin", "instance")) {
    const rows = await prisma.event.findMany({
      where: { archived_at: null },
      select: eventSelect,
      orderBy: { date: "asc" },
    });
    return rows.map(toEventSummary);
  }

  const assignments = await prisma.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true, scope_type: true, scope_id: true },
  });

  const orgIds = new Set<string>();
  const eventIds = new Set<string>();

  for (const a of assignments) {
    if (a.role === "admin" && a.scope_type === "organization" && a.scope_id) {
      orgIds.add(a.scope_id);
    }
    if (a.scope_type === "event" && a.scope_id) {
      if (a.role === "operator") eventIds.add(a.scope_id);
    }
  }

  if (orgIds.size === 0 && eventIds.size === 0) return [];

  const or: Prisma.EventWhereInput[] = [];
  if (orgIds.size > 0) {
    or.push({ organization_id: { in: [...orgIds] } });
  }
  if (eventIds.size > 0) {
    or.push({ id: { in: [...eventIds] } });
  }

  const rows = await prisma.event.findMany({
    where: { archived_at: null, OR: or },
    select: eventSelect,
    orderBy: { date: "asc" },
  });
  return rows.map(toEventSummary);
}

/** Events visible on admin picker (superadmin: all; org admin: org events). Set includeArchived to list archived rows. */
export async function listAdminEvents(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  options?: { includeArchived?: boolean },
): Promise<EventSummary[]> {
  if (!(await canAccessAdminPanel(prisma, userId))) return [];

  const archivedWhere = options?.includeArchived ? undefined : { archived_at: null };

  if (await hasScope(prisma, userId, "superadmin", "instance")) {
    const rows = await prisma.event.findMany({
      ...(archivedWhere ? { where: archivedWhere } : {}),
      select: eventSelect,
      orderBy: { date: "asc" },
    });
    return rows.map(toEventSummary);
  }

  const orgAssignments = await prisma.roleAssignment.findMany({
    where: { user_id: userId, role: "admin", scope_type: "organization" },
    select: { scope_id: true },
  });
  const orgIds = orgAssignments.map((a) => a.scope_id).filter((id): id is string => !!id);
  if (orgIds.length === 0) return [];

  const rows = await prisma.event.findMany({
    where: {
      organization_id: { in: orgIds },
      ...archivedWhere,
    },
    select: eventSelect,
    orderBy: { date: "asc" },
  });
  return rows.map(toEventSummary);
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
