import { isAdminRoleAssignment, resolvePostAuthPath, type RoleAssignmentLike } from "@admitto/auth";

const LEGACY_DEFAULT = "/operator";

function hasCheckInLandingAccess(assignments: RoleAssignmentLike[]): boolean {
  if (assignments.some(isAdminRoleAssignment)) return true;
  return assignments.some(
    (a) => a.role === "operator" && a.scope_type === "event" && a.scope_id != null,
  );
}

function isAdminStaffPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}

function isOperatorStaffPath(path: string): boolean {
  return path === "/operator" || path.startsWith("/operator/");
}

/** Whether `next` is allowed for the user's role assignments (v0.4 post-login contract). */
export function isNextAllowedForAssignments(
  next: string,
  assignments: RoleAssignmentLike[],
): boolean {
  if (isAdminStaffPath(next)) {
    return assignments.some(isAdminRoleAssignment);
  }
  if (isOperatorStaffPath(next)) {
    return hasCheckInLandingAccess(assignments);
  }
  if (next === "/login" || next.startsWith("/login?")) {
    return true;
  }
  return false;
}

/** Allow only same-origin relative paths (blocks open redirects). */
export function resolveOptionalSafeRedirectPath(next: string | undefined): string | undefined {
  if (!next?.trim()) return undefined;
  const trimmed = next.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\\") ||
    /[\t\r\n]/.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

/** Allow only same-origin relative paths (blocks open redirects). */
export function resolveSafeRedirectPath(next: string | undefined, fallback = LEGACY_DEFAULT): string {
  return resolveOptionalSafeRedirectPath(next) ?? fallback;
}

/** Role-aware post-login landing; honors `?next=` only when path matches role. */
export function resolvePostLoginRedirect(
  next: string | undefined,
  assignments: RoleAssignmentLike[],
): string {
  const fallback = resolvePostAuthPath(assignments);
  const candidate = resolveOptionalSafeRedirectPath(next);
  if (!candidate) return fallback;
  if (isNextAllowedForAssignments(candidate, assignments)) return candidate;
  return fallback;
}

/** @deprecated Use resolvePostAuthPath from @admitto/auth */
export function defaultPostAuthPath(): string {
  return LEGACY_DEFAULT;
}
