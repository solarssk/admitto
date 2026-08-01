import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  hashPassword,
  isPasswordTooCommon,
  PASSWORD_TOO_COMMON_CODE,
  revokeOtherSessions,
  promoteSessionToFull,
  PASSWORD_MIN_LENGTH,
  SESSION_STAGE,
  type SessionStage,
} from "@admitto/auth";
import { writeAdminAuditLogBestEffort } from "@admitto/tickets";
import {
  getChangePasswordPageSecurityHeaders,
  renderChangePasswordForm,
  PASSWORD_INVALID,
  PASSWORD_MISMATCH,
  PASSWORD_TOO_SHORT,
  PASSWORD_COMPLETE_FAILED,
} from "../change-password-page.js";
import { createAuthPageScriptNonce } from "../auth-page-security.js";
import { resolvePostLoginRedirectForUser } from "./post-login-redirect.js";
import { ensureEnrollmentBackupCodesStashed } from "./ensure-backup-codes.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import { resolveClientTimezone } from "../admin/admin-helpers.js";
import { resolveInstanceOrganizationId } from "../admin/instance-org.js";

function htmlResponse(c: Context, html: string, scriptNonce: string, status: 200 | 400 = 200): Response {
  for (const [name, value] of Object.entries(getChangePasswordPageSecurityHeaders(scriptNonce))) {
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
  const scriptNonce = createAuthPageScriptNonce();
  return htmlResponse(c, renderChangePasswordForm(scriptNonce), scriptNonce);
}

/** POST /change-password — update password, clear flag, revoke other sessions. */
export async function handlePostChangePassword(c: Context, db: PrismaClient): Promise<Response> {
  const gate = await requireForcedPasswordChange(c, db);
  if (gate instanceof Response) return gate;

  const form = await parseForm(c);
  const password = form.password ?? "";
  const confirm = form.password_confirm ?? "";

  if (password.length < PASSWORD_MIN_LENGTH) {
    const scriptNonce = createAuthPageScriptNonce();
    return htmlResponse(c, renderChangePasswordForm(scriptNonce, PASSWORD_TOO_SHORT), scriptNonce, 400);
  }
  if (isPasswordTooCommon(password)) {
    const scriptNonce = createAuthPageScriptNonce();
    return htmlResponse(c, renderChangePasswordForm(scriptNonce, PASSWORD_TOO_COMMON_CODE), scriptNonce, 400);
  }
  // eslint-disable-next-line security/detect-possible-timing-attacks -- non-secret auth probe status string
  if (password !== confirm) {
    const scriptNonce = createAuthPageScriptNonce();
    return htmlResponse(c, renderChangePasswordForm(scriptNonce, PASSWORD_MISMATCH), scriptNonce, 400);
  }

  try {
    const hash = await hashPassword(password);
    const orgId = await resolveInstanceOrganizationId(db);
    let promotedStage: SessionStage | null = null;
    let revokedCount = 0;
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: gate.userId },
        data: { password_hash: hash, must_change_password: false },
      });
      revokedCount = await revokeOtherSessions(tx, gate.userId, gate.sessionId);
      // Flag is now cleared, so promote the constrained session and resolve any
      // remaining gates (backup codes, then full) in one transaction (IAM-001).
      promotedStage = await promoteSessionToFull(tx, gate.sessionId, gate.userId);
      if (!promotedStage) throw new Error("session_promotion_failed");
    });

    // Audit write runs after the transaction commits, not inside it: the password
    // change and session promotion have already succeeded at this point, and a
    // transient audit-write failure must not roll that back (CodeRabbit PR #611).
    // No `auth`/full session exists yet at this stage (IAM-001) - build the audit
    // context from the partial-session gate instead of `adminAuditFromContext(c)`.
    await writeAdminAuditLogBestEffort(db, {
      organizationId: orgId,
      actorUserId: gate.userId,
      sessionId: gate.sessionId,
      ip: resolveClientIp(c),
      timezone: resolveClientTimezone(c) ?? undefined,
      actionType: "account_password_changed",
      metadata: { forced: true, sessionsRevoked: revokedCount },
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
    const scriptNonce = createAuthPageScriptNonce();
    return htmlResponse(c, renderChangePasswordForm(scriptNonce, message), scriptNonce, 400);
  }
}
