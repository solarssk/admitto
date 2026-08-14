import type { Context } from "hono";

/** Deliberately does not Disallow anything: the `X-Robots-Tag: noindex, nofollow` header on
 * every public response (see getTicketPageSecurityHeaders, getAuthPageInlineScriptHeaders,
 * getBaselineSecurityHeaders) is what keeps this instance out of search results. A robots.txt
 * disallow would stop compliant crawlers from ever fetching these pages, so they'd never see
 * that header - and a URL already indexed (e.g. discovered through an external link) could
 * never be removed, since Google can't recrawl a page it isn't allowed to request. */
const ROBOTS_TXT = "User-agent: *\nAllow: /\n";

/** GET /robots.txt */
export function handleGetRobotsTxt(c: Context): Response {
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(ROBOTS_TXT);
}
