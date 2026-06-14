import type { Context } from "hono";

/** Reject cross-site POST when `Origin`/`Referer` do not match the request host. */
export function rejectCrossSitePost(c: Context): Response | null {
  const expectedHost = new URL(c.req.url).host;

  const origin = c.req.header("origin");
  if (origin) {
    try {
      return new URL(origin).host === expectedHost ? null : c.text("Forbidden", 403);
    } catch {
      return c.text("Forbidden", 403);
    }
  }

  const referer = c.req.header("referer");
  if (referer) {
    try {
      return new URL(referer).host === expectedHost ? null : c.text("Forbidden", 403);
    } catch {
      return c.text("Forbidden", 403);
    }
  }

  return c.text("Forbidden", 403);
}
