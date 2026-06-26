import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import {
  hashPassword,
  revokeOtherSessions,
  promoteSessionToFull,
  PASSWORD_MIN_LENGTH,
  SESSION_STAGE,
  type SessionStage,
} from "@admitto/auth";
import {
  getChangePasswordPageSecurityHeaders,
  renderChangePasswordForm,
  PASSWORD_INVALID,
  PASSWORD_MISMATCH,
  PASSWORD_TOO_SHORT,
  PASSWORD_COMPLETE_FAILED,
} from "../change-password-page.js";
import { resolvePostLoginRedirectForUser } from "./post-login-redirect.js";
import { ensureEnrollmentBackupCodesStashed } from "./ensure-backup-codes.js";

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
  // Route is wired to a partial-session guard restricted to the
  // `change_password_required` stage, so a full session can never reach here
  // and the temporary credential cannot be used against other routes (IAM-001).
  const partial = c.get("partialAuth");
  if (!partial?.userId || !partial.sessionId) {
    return c.redirect("/login", 302);
  }
  const user = await db.user.findUnique({
    where: { id: partial.userId },
    select: { must_change_password: true },
  });
  if (!user?.must_change_password) {
    const landing = await resolvePostLoginRedirectForUser(db, partial.userId);
    return c.redirect(landing, 302);
  }
  return { userId: partial.userId, sessionId: partial.sessionId };
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

  if (password.length < PASSWORD_MIN_LENGTH) {
    return htmlResponse(c, renderChangePasswordForm(PASSWORD_TOO_SHORT), 400);
  }
  if (password !== confirm) {
    return htmlResponse(c, renderChangePasswordForm(PASSWORD_MISMATCH), 400);
  }

  try {
    const hash = await hashPassword(password);
    let promotedStage: SessionStage | null = null;
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: gate.userId },
        data: { password_hash: hash, must_change_password: false },
      });
      await revokeOtherSessions(tx, gate.userId, gate.sessionId);
      // Flag is now cleared, so promote the constrained session and resolve any
      // remaining gates (backup codes, then full) in one transaction (IAM-001).
      promotedStage = await promoteSessionToFull(tx, gate.sessionId, gate.userId);
      if (!promotedStage) throw new Error("session_promotion_failed");
    });

    if (promotedStage === SESSION_STAGE.BACKUP_CODES_REQUIRED) {
      await ensureEnrollmentBackupCodesStashed(db, gate.sessionId, gate.userId);
      return c.redirect("/mfa/enroll/backup-codes", 302);
    }

    const landing = await resolvePostLoginRedirectForUser(db, gate.userId);
    return c.redirect(landing, 302);
  } catch (err) {
    console.error("change-password transaction failed:", err);
    const message =
      err instanceof Error && err.message === "session_promotion_failed"
        ? PASSWORD_COMPLETE_FAILED
        : PASSWORD_INVALID;
    return htmlResponse(c, renderChangePasswordForm(message), 400);
  }
}
