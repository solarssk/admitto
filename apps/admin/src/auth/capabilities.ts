import type { RoleAssignment } from "../api/types.js";

export function canAccessAdminPanel(assignments: RoleAssignment[]): boolean {
  return assignments.some(
    (a) =>
      (a.role === "superadmin" && a.scope_type === "instance") ||
      (a.role === "admin" && a.scope_type === "organization" && a.scope_id),
  );
}

export function canAccessCheckInPanel(assignments: RoleAssignment[]): boolean {
  if (assignments.some((a) => a.role === "superadmin" && a.scope_type === "instance")) {
    return true;
  }
  if (assignments.some((a) => a.role === "admin" && a.scope_type === "organization" && a.scope_id)) {
    return true;
  }
  return assignments.some(
    (a) => a.role === "operator" && a.scope_type === "event" && a.scope_id,
  );
}

/** An explicit event-operator role must keep the dedicated `/operator` surface available even
 * when the same person is also an admin in a different organization. Admin roles alone can use
 * the admin Check-in tab; this assignment is the only one that can grant check-in for an event
 * outside those organizations. */
export function hasEventOperatorAssignment(assignments: RoleAssignment[]): boolean {
  return assignments.some(
    (a) => a.role === "operator" && a.scope_type === "event" && a.scope_id,
  );
}

export function isSuperadmin(assignments: RoleAssignment[]): boolean {
  return assignments.some((a) => a.role === "superadmin" && a.scope_type === "instance");
}

export function isAdmin(assignments: RoleAssignment[]): boolean {
  return (
    isSuperadmin(assignments) ||
    assignments.some((a) => a.role === "admin" && a.scope_type === "organization" && a.scope_id)
  );
}

/**
 * Admin for a SPECIFIC organization — unlike isAdmin, doesn't count an admin
 * assignment on some other org. Matches the server's canManageEvent, which
 * resolves the event's own organization_id before checking the assignment
 * (bot review, #457): a mixed-role user (admin of org A, only operator for
 * an event in org B) is isAdmin()===true globally but canManageEvent()===
 * false for that event, so a control gated on isAdmin() alone would show but
 * always 403. `organizationId` is `null` while the current event's org
 * hasn't loaded yet — treated as not-admin (fail closed) rather than
 * flashing an admin control that might not apply.
 */
export function isOrgAdmin(assignments: RoleAssignment[], organizationId: string | null): boolean {
  if (isSuperadmin(assignments)) return true;
  if (!organizationId) return false;
  return assignments.some(
    (a) => a.role === "admin" && a.scope_type === "organization" && a.scope_id === organizationId,
  );
}
