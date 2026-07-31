import type { BadgeVariant } from "@admitto/ui";

export type StaffRole = "superadmin" | "admin" | "operator";

/** Single source of truth for how a staff role reads to a human - the wire/DB value (superadmin/
 * admin/operator) never changes, only this display layer. */
export const ROLE_LABELS: Record<StaffRole, string> = {
  superadmin: "Superadmin",
  admin: "Administrator",
  operator: "Operator",
};

/** One color per role, shared by every badge/avatar-ring that represents a role anywhere in the
 * admin SPA (Staff users, Role assignments, Active sessions, the topbar user menu). */
export const ROLE_BADGE_VARIANT: Record<StaffRole, BadgeVariant> = {
  superadmin: "error",
  admin: "warn",
  operator: "info",
};

function isStaffRole(role: string): role is StaffRole {
  return role === "superadmin" || role === "admin" || role === "operator";
}

/** Capitalized display label for a role; returns the raw value unchanged for anything outside
 * the known set (defensive only - every real role is one of the three above). */
export function roleLabel(role: string): string {
  return isStaffRole(role) ? ROLE_LABELS[role] : role;
}

export function roleBadgeVariant(role: string): BadgeVariant {
  return isStaffRole(role) ? ROLE_BADGE_VARIANT[role] : "neutral";
}
