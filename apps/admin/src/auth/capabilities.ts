import type { RoleAssignment } from "../api/types.js";

export function canAccessAdminPanel(assignments: RoleAssignment[]): boolean {
  return assignments.some(
    (a) =>
      (a.role === "superadmin" && a.scope_type === "instance") ||
      (a.role === "admin" && a.scope_type === "organization"),
  );
}

export function canAccessCheckInPanel(assignments: RoleAssignment[]): boolean {
  if (canAccessAdminPanel(assignments)) return true;
  return assignments.some((a) => a.role === "operator");
}

export function isSuperadmin(assignments: RoleAssignment[]): boolean {
  return assignments.some((a) => a.role === "superadmin" && a.scope_type === "instance");
}
