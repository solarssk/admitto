import type { PrismaClient, Prisma } from "@prisma/client";
import { verifyPasswordOrDummy } from "./password.js";
import { findUserByEmail, normalizeEmail } from "./user.js";
import {
  createSession,
  promoteSessionToFull,
  type ValidatedPartialSession,
} from "./session.js";
import {
  logLoginFailure,
  logLoginSuccess,
  logLogout,
  logMfaFailure,
  logMfaRecoveryConsumed,
  logMfaSuccess,
  type LoginAuditContext,
  type MfaAuditContext,
  type MfaMethod,
} from "./audit.js";
import {
  LOGIN_NEXT,
  SESSION_STAGE,
  type LoginNext,
  type SessionStage,
} from "./constants.js";
import { userRequiresMfa, userHasConfirmedTotp } from "./mfa/policy.js";
import { validateTrustedDevice, createTrustedDevice } from "./mfa/trusted-device.js";
import { findBackupRecoveryRowId } from "./mfa/backup-recovery.js";
import { findEmergencyRecoveryRowId } from "./mfa/emergency-recovery.js";
import { consumeRecoveryRow } from "./mfa/recovery-consume.js";
import { verifyUserTotpCode } from "./mfa/enrollment.js";
import { getTrustedDeviceDays } from "./settings/resolver.js";

/** Credentials and request metadata for `login()`. */
export interface LoginInput {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
  /** Raw trusted-device cookie value, if present. */
  trustedDeviceToken?: string;
}

/** Discriminated result after password verification. */
export type LoginResult =
  | { ok: true; rawToken: string; sessionId: string; userId: string; next: LoginNext }
  | { ok: false; reason: "invalid_credentials" | "inactive" };

const INVALID: LoginResult = { ok: false, reason: "invalid_credentials" };

/**
 * Authenticate by email/password, create session (possibly partial), emit audit logs.
 */
export async function login(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: LoginInput,
  audit?: LoginAuditContext,
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const user = await findUserByEmail(prisma, email);

  const passwordOk = await verifyPasswordOrDummy(input.password, user?.password_hash ?? null);
  if (!user || !passwordOk) {
    logLoginFailure(audit ?? { email, ip: input.ip, userAgent: input.userAgent });
    return INVALID;
  }

  if (!user.is_active) {
    logLoginFailure(audit ?? { email, ip: input.ip, userAgent: input.userAgent });
    return { ok: false, reason: "inactive" };
  }

  const requiresMfa = await userRequiresMfa(prisma, user.id);
  let stage: SessionStage = SESSION_STAGE.FULL;
  let next: LoginNext = LOGIN_NEXT.COMPLETE;

  if (requiresMfa) {
    const hasTotp = await userHasConfirmedTotp(prisma, user.id);
    if (!hasTotp) {
      stage = SESSION_STAGE.ENROLLMENT_REQUIRED;
      next = LOGIN_NEXT.ENROLLMENT_REQUIRED;
    } else if (
      input.trustedDeviceToken &&
      (await validateTrustedDevice(prisma, user.id, input.trustedDeviceToken))
    ) {
      stage = SESSION_STAGE.FULL;
      next = LOGIN_NEXT.COMPLETE;
    } else {
      stage = SESSION_STAGE.MFA_PENDING;
      next = LOGIN_NEXT.MFA_REQUIRED;
    }
  }

  // Forced password change is enforced as a constrained session stage (not just a
  // client-side `next` hint) so no HTTP client can reach protected routes with the
  // temporary credential (IAM-001). MFA-required users hit this gate after MFA, at
  // session promotion time.
  if (stage === SESSION_STAGE.FULL && user.must_change_password) {
    stage = SESSION_STAGE.CHANGE_PASSWORD_REQUIRED;
    next = LOGIN_NEXT.CHANGE_PASSWORD;
  }

  const { session, rawToken } = await createSession(prisma, {
    userId: user.id,
    stage,
    ip: input.ip,
    userAgent: input.userAgent,
    deviceLabel: input.deviceLabel,
  });

  logLoginSuccess(audit ?? { email, ip: input.ip, userAgent: input.userAgent });

  return {
    ok: true,
    rawToken,
    sessionId: session.id,
    userId: user.id,
    next,
  };
}

/** Input for `completeMfa()` after password login with partial session. */
export interface CompleteMfaInput {
  userId: string;
  sessionId: string;
  code: string;
  rememberDevice?: boolean;
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
}

/** Result of MFA verification; includes trusted-device token when remember-device is set. */
export interface CompleteMfaResult {
  ok: boolean;
  trustedDeviceRawToken?: string;
  /** Stage the session reached after promotion (e.g. `backup_codes_required` when codes still owed). */
  stage?: SessionStage;
}

type CompleteMfaTxResult =
  | { ok: false; reason: "invalid_code" | "session_not_promoted" | "recovery_consume_conflict" }
  | {
      ok: true;
      method: MfaMethod;
      recoveryMethod?: "backup" | "emergency";
      trustedDeviceRawToken?: string;
      stage: SessionStage;
    };

async function completeMfaInTransaction(
  tx: Prisma.TransactionClient,
  input: CompleteMfaInput,
): Promise<CompleteMfaTxResult> {
  const { userId, sessionId, code } = input;

  const totpOk = await verifyUserTotpCode(tx, userId, code);
  let recoveryRowId: string | null = null;
  let recoveryMethod: "backup" | "emergency" | null = null;

  if (!totpOk) {
    recoveryRowId = await findBackupRecoveryRowId(tx, userId, code);
    if (recoveryRowId) {
      recoveryMethod = "backup";
    } else {
      recoveryRowId = await findEmergencyRecoveryRowId(tx, userId, code);
      if (recoveryRowId) recoveryMethod = "emergency";
    }
  }

  if (!totpOk && !recoveryRowId) return { ok: false, reason: "invalid_code" };

  const promotedStage = await promoteSessionToFull(tx, sessionId, userId);
  if (!promotedStage) return { ok: false, reason: "session_not_promoted" };

  let method: MfaMethod;
  if (totpOk) {
    method = "totp";
  } else if (recoveryMethod) {
    method = recoveryMethod;
  } else {
    return { ok: false, reason: "invalid_code" };
  }

  if (recoveryRowId) {
    const consumed = await consumeRecoveryRow(tx, recoveryRowId);
    if (!consumed) return { ok: false, reason: "recovery_consume_conflict" };
  }

  if (input.rememberDevice) {
    const days = await getTrustedDeviceDays(tx);
    if (days > 0) {
      const { rawToken } = await createTrustedDevice(tx, {
        userId,
        ip: input.ip,
        userAgent: input.userAgent,
        label: input.deviceLabel,
      });
      return {
        ok: true,
        method,
        recoveryMethod: recoveryMethod ?? undefined,
        trustedDeviceRawToken: rawToken,
        stage: promotedStage,
      };
    }
  }

  return { ok: true, method, recoveryMethod: recoveryMethod ?? undefined, stage: promotedStage };
}

/** Emit MFA audit events after the DB transaction commits (success paths only). */
function emitMfaAudit(
  audit: MfaAuditContext | undefined,
  input: CompleteMfaInput,
  result: CompleteMfaTxResult,
): void {
  const auditCtx: MfaAuditContext = audit ?? {
    userId: input.userId,
    sessionId: input.sessionId,
    ip: input.ip,
    userAgent: input.userAgent,
  };
  if (!result.ok) {
    if (result.reason === "invalid_code") {
      logMfaFailure(auditCtx);
    }
    return;
  }
  if (result.recoveryMethod) {
    logMfaRecoveryConsumed(auditCtx, result.recoveryMethod);
  }
  logMfaSuccess(auditCtx, result.method);
}

/**
 * Complete MFA step: TOTP or backup/emergency recovery code.
 * Promotes session to full when code is valid; recovery codes are consumed only after promotion.
 */
export async function completeMfa(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CompleteMfaInput,
  audit?: MfaAuditContext,
): Promise<CompleteMfaResult> {
  let txResult: CompleteMfaTxResult;
  if ("$transaction" in prisma && typeof prisma.$transaction === "function") {
    txResult = await prisma.$transaction((tx) => completeMfaInTransaction(tx, input));
  } else {
    txResult = await completeMfaInTransaction(prisma, input);
  }

  emitMfaAudit(audit, input, txResult);

  if (!txResult.ok) return { ok: false };
  return {
    ok: true,
    trustedDeviceRawToken: txResult.trustedDeviceRawToken,
    stage: txResult.stage,
  };
}

/** Post-MFA / full-session next step when password change may be required. */
export async function loginNextAfterFullSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<LoginNext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { must_change_password: true },
  });
  if (user?.must_change_password) return LOGIN_NEXT.CHANGE_PASSWORD;
  return LOGIN_NEXT.COMPLETE;
}

/** Revoke the validated session row (idempotent when already revoked). */
export async function logout(
  prisma: PrismaClient | Prisma.TransactionClient,
  validated: ValidatedPartialSession | import("./session.js").ValidatedSession | null,
  audit?: { ip?: string },
): Promise<void> {
  if (!validated) return;
  const { count } = await prisma.session.updateMany({
    where: { id: validated.session.id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  if (count > 0) {
    logLogout({
      userId: validated.userId,
      sessionId: validated.session.id,
      ip: audit?.ip,
    });
  }
}
