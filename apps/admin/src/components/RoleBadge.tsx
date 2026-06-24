import type { RoleAssignment } from "../api/types.js";

export function RoleBadge({ assignments }: { assignments: RoleAssignment[] }) {
  const isSA = assignments.some((a) => a.role === "superadmin");
  const isAD = assignments.some((a) => a.role === "admin");
  const abbr = isSA ? "SA" : isAD ? "AD" : "OP";
  const cls = isSA ? "role-badge--sa" : isAD ? "role-badge--ad" : "role-badge--op";

  return <span className={`role-badge ${cls}`}>{abbr}</span>;
}
