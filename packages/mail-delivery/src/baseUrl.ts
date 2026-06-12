type EnvLike = Record<string, string | undefined>;

/** Same policy as apps/web check-in gate — required outside development. */
export function resolveBaseUrl(env: EnvLike = process.env): string {
  const url = env["BASE_URL"];
  if (url) return url.replace(/\/$/, "");
  if (env["NODE_ENV"] !== "development") {
    throw new Error("BASE_URL is required in non-development environments");
  }
  return "http://localhost:3000";
}
