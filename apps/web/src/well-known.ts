import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, SESSION_STAGE, validatePartialSession } from "@admitto/auth";

/** GET /.well-known/change-password - W3C "Well-Known URL for Changing Passwords"
 * (https://w3c.github.io/webappsec-change-password-url/). Browsers and password managers
 * request this path to find the account's password-change page directly, instead of guessing
 * from whatever page the user happened to be on.
 *
 * Two different pages can answer this depending on session state, so this checks which one
 * actually applies rather than picking one statically: `/change-password` is gated to only the
 * `CHANGE_PASSWORD_REQUIRED` partial-session stage (IAM-001, see app.ts's
 * requireChangePasswordSession) - a normal signed-in staff member hitting it would just bounce
 * straight back to `/login`, defeating the whole point of this endpoint for the common case. My
 * Account's own "Change password" section at `/account` is what a full session needs instead;
 * that route already redirects to sign-in on its own when there is no session at all. A 302 (not
 * 301) either way, so the destination can move without a stale cached redirect. */
export async function handleGetChangePasswordWellKnown(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (rawToken) {
    const validated = await validatePartialSession(db, rawToken);
    if (validated?.stage === SESSION_STAGE.CHANGE_PASSWORD_REQUIRED) {
      return c.redirect("/change-password", 302);
    }
  }
  return c.redirect("/account", 302);
}
