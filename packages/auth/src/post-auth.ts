export interface RoleAssignmentLike {
  role: string;
  scope_type: string;
  scope_id: string | null;
}

const DEFAULT_OPERATOR_PATH = "/operator";
const DEFAULT_ADMIN_PATH = "/admin";
const NO_ACCESS_PATH = "/login";

/** Whether an assignment grants admin-panel access (matches `canAccessAdminPanel` rules). */
export function isAdminRoleAssignment(a: RoleAssignmentLike): boolean {
  return (
    (a.role === "superadmin" && a.scope_type === "instance") ||
    (a.role === "admin" && a.scope_type === "organization" && a.scope_id != null)
  );
}

function isOperatorOnly(assignments: RoleAssignmentLike[]): boolean {
  if (assignments.length === 0) return false;
  const hasAdmin = assignments.some(isAdminRoleAssignment);
  const hasOperator = assignments.some((a) => a.role === "operator");
  return hasOperator && !hasAdmin;
}

/** Default post-login landing path from role assignments. */
export function resolvePostAuthPath(assignments: RoleAssignmentLike[]): string {
  if (assignments.length === 0) return NO_ACCESS_PATH;
  if (assignments.some((a) => a.role === "superadmin" && a.scope_type === "instance")) {
    return DEFAULT_ADMIN_PATH;
  }
  if (
    assignments.some(
      (a) => a.role === "admin" && a.scope_type === "organization" && a.scope_id != null,
    )
  ) {
    return DEFAULT_ADMIN_PATH;
  }
  if (isOperatorOnly(assignments)) {
    return DEFAULT_OPERATOR_PATH;
  }
  if (assignments.some((a) => a.role === "operator")) {
    return DEFAULT_OPERATOR_PATH;
  }
  return NO_ACCESS_PATH;
}
