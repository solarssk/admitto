import { validateHttpUrl } from "@admitto/mail-templates";

type EnvLike = Record<string, string | undefined>;

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/$/, "");
  return validateHttpUrl("BASE_URL", trimmed);
}

/** Same policy as apps/web check-in gate — required outside development. */
export function resolveBaseUrl(env: EnvLike = process.env): string {
  const url = env["BASE_URL"];
  if (url) return normalizeBaseUrl(url);
  if (env["NODE_ENV"] !== "development") {
    throw new Error("BASE_URL is required in non-development environments");
  }
  return "http://localhost:3000";
}
