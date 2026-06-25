import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { hashPassword, revokeOtherSessions } from "@admitto/auth";
import {
  getChangePasswordPageSecurityHeaders,
  renderChangePasswordForm,
  PASSWORD_INVALID,
  PASSWORD_MISMATCH,
  PASSWORD_TOO_SHORT,
} from "../change-password-page.js";
import { resolvePostLoginRedirectForUser } from "./post-login-redirect.js";

const MIN_PASSWORD_LEN = 8;

function htmlResponse(c: Context, html: string, status: 200 | 400 = 200): Response {
  for (const [name, value] of Object.entries(getChangePasswordPageSecurityHeaders())) {
    c.header(name, value);
  }
  return c.html(html, status);
}

async function parseForm(c: Context): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await c.req.parseBody();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  return {};
}

async function requireForcedPasswordChange(
  c: Context,
  db: PrismaClient,
): Promise<{ userId: string; sessionId: string } | Response> {
  const auth = c.get("auth");
  if (!auth?.userId || !auth.sessionId) {
    return c.redirect("/login", 302);
  }
  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: { must_change_password: true },
  });
  if (!user?.must_change_password) {
    const landing = await resolvePostLoginRedirectForUser(db, auth.userId);
    return c.redirect(landing, 302);
  }
  return { userId: auth.userId, sessionId: auth.sessionId };
}

/** GET /change-password — forced password change form. */
export async function handleGetChangePassword(c: Context, db: PrismaClient): Promise<Response> {
  const gate = await requireForcedPasswordChange(c, db);
  if (gate instanceof Response) return gate;
  return htmlResponse(c, renderChangePasswordForm());
}

/** POST /change-password — update password, clear flag, revoke other sessions. */
export async function handlePostChangePassword(c: Context, db: PrismaClient): Promise<Response> {
  const gate = await requireForcedPasswordChange(c, db);
  if (gate instanceof Response) return gate;

  const form = await parseForm(c);
  const password = form.password ?? "";
  const confirm = form.password_confirm ?? "";

  if (password.length < MIN_PASSWORD_LEN) {
    return htmlResponse(c, renderChangePasswordForm(PASSWORD_TOO_SHORT), 400);
  }
  if (password !== confirm) {
    return htmlResponse(c, renderChangePasswordForm(PASSWORD_MISMATCH), 400);
  }

  try {
    const hash = await hashPassword(password);
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: gate.userId },
        data: { password_hash: hash, must_change_password: false },
      });
      await revokeOtherSessions(tx, gate.userId, gate.sessionId);
    });
  } catch {
    return htmlResponse(c, renderChangePasswordForm(PASSWORD_INVALID), 400);
  }

  const landing = await resolvePostLoginRedirectForUser(db, gate.userId);
  return c.redirect(landing, 302);
}
