import type { Context } from "hono";

/** Admitto has no public/marketing surface worth crawling - every route here is either a
 * short-lived attendee ticket link or the staff app, so block indexing wholesale rather than
 * enumerate paths. */
const ROBOTS_TXT = "User-agent: *\nDisallow: /\n";

/** GET /robots.txt */
export function handleGetRobotsTxt(c: Context): Response {
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(ROBOTS_TXT);
}
