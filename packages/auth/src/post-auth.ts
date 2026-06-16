export interface RoleAssignmentLike {
  role: string;
  scope_type: string;
  scope_id: string | null;
}

const DEFAULT_OPERATOR_PATH = "/operator";
const DEFAULT_ADMIN_PATH = "/admin";

function isAdminRole(a: RoleAssignmentLike): boolean {
  return a.role === "superadmin" || (a.role === "admin" && a.scope_type === "organization");
}

function isOperatorOnly(assignments: RoleAssignmentLike[]): boolean {
  if (assignments.length === 0) return false;
  const hasAdmin = assignments.some(isAdminRole);
  const hasOperator = assignments.some((a) => a.role === "operator");
  return hasOperator && !hasAdmin;
}

/** Default post-login landing path from role assignments. */
export function resolvePostAuthPath(assignments: RoleAssignmentLike[]): string {
  if (assignments.some((a) => a.role === "superadmin" && a.scope_type === "instance")) {
    return DEFAULT_ADMIN_PATH;
  }
  if (assignments.some((a) => a.role === "admin" && a.scope_type === "organization")) {
    return DEFAULT_ADMIN_PATH;
  }
  if (isOperatorOnly(assignments)) {
    return DEFAULT_OPERATOR_PATH;
  }
  if (assignments.some((a) => a.role === "operator")) {
    return DEFAULT_OPERATOR_PATH;
  }
  return DEFAULT_OPERATOR_PATH;
}
