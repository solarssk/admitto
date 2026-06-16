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

export function isSuperadmin(assignments: RoleAssignment[]): boolean {
  return assignments.some((a) => a.role === "superadmin" && a.scope_type === "instance");
}
