import { resolvePostAuthPath, type RoleAssignmentLike } from "@admitto/auth";

const LEGACY_DEFAULT = "/operator";

/** Allow only same-origin relative paths (blocks open redirects). */
export function resolveSafeRedirectPath(next: string | undefined, fallback = LEGACY_DEFAULT): string {
  if (!next) return fallback;
  const trimmed = next.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\\") ||
    /[\r\n]/.test(trimmed)
  ) {
    return fallback;
  }
  return trimmed;
}

/** Role-aware post-login landing when `?next=` is absent. */
export function resolvePostLoginRedirect(
  next: string | undefined,
  assignments: RoleAssignmentLike[],
): string {
  const fallback = resolvePostAuthPath(assignments);
  return resolveSafeRedirectPath(next, fallback);
}

/** @deprecated Use resolvePostAuthPath from @admitto/auth */
export function defaultPostAuthPath(): string {
  return LEGACY_DEFAULT;
}
