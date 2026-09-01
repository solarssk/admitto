import type { Context } from "hono";

/** GET /.well-known/change-password - W3C "Well-Known URL for Changing Passwords"
 * (https://w3c.github.io/webappsec-change-password-url/). Browsers and password managers
 * request this path to find the account's password-change page directly, instead of guessing
 * from whatever page the user happened to be on. A 302 (not 301) so the destination can move
 * without a stale cached redirect. */
export function handleGetChangePasswordWellKnown(c: Context): Response {
  return c.redirect("/change-password", 302);
}
