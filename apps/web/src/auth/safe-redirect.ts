const DEFAULT_POST_AUTH_PATH = "/operator";

/** Allow only same-origin relative paths (blocks open redirects). */
export function resolveSafeRedirectPath(next: string | undefined, fallback = DEFAULT_POST_AUTH_PATH): string {
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

/** Default HTML landing path after successful MFA (v0.4 admin UI may override via `?next=`). */
export function defaultPostAuthPath(): string {
  return DEFAULT_POST_AUTH_PATH;
}
