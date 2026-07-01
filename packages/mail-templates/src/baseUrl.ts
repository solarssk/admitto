import { validateHttpUrl } from "./escape.js";

type EnvLike = Record<string, string | undefined>;

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/$/, "");
  return validateHttpUrl("BASE_URL", trimmed);
}

/**
 * Resolve the public instance URL for ticket links and absolutizing `/uploads/…` in email HTML.
 * Required outside development — localhost fallback is dev-only (same policy as apps/web and mail-delivery).
 */
export function resolvePublicBaseUrl(env: EnvLike = process.env): string {
  const url = env["BASE_URL"];
  if (url) return normalizeBaseUrl(url);
  if (env["NODE_ENV"] !== "development") {
    throw new Error("BASE_URL is required in non-development environments");
  }
  return "http://localhost:3000";
}
