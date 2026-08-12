import type { PrismaClient, Prisma } from "@admitto/db";
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
  logTrustedDeviceCreated,
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
import { userRequiresMfa, userHasAnyConfirmedMfaMethod, userHasUnacknowledgedBackupCodes } from "./mfa/policy.js";
import { validateTrustedDevice, createTrustedDevice } from "./mfa/trusted-device.js";
import { verifyTotpOrRecoveryCodeDetailed } from "./mfa/verify-step-up-code.js";
import { getTrustedDeviceDays } from "./settings/resolver.js";
import { recordFailedLoginFailureSideEffects, resetFailedLoginStreak } from "./privileged-login-alert.js";

/** Credentials and request metadata for `login()`. */
export interface LoginInput {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
  /** Raw trusted-device cookie value, if present. */
  trustedDeviceToken?: string;
  /** Browser IANA timezone when captured at sign-in. */
  timezone?: string | null;
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
    await logLoginFailure(
      prisma,
      audit ?? { email, ip: input.ip, userAgent: input.userAgent, timezone: input.timezone },
    );
    await recordFailedLoginFailureSideEffects(prisma, user, { ip: input.ip });
    return INVALID;
  }

  if (!user.is_active) {
    await logLoginFailure(
      prisma,
      audit ?? { email, ip: input.ip, userAgent: input.userAgent, timezone: input.timezone },
    );
    return { ok: false, reason: "inactive" };
  }

  const requiresMfa = await userRequiresMfa(prisma, user.id);
  let stage: SessionStage = SESSION_STAGE.FULL;
  let next: LoginNext = LOGIN_NEXT.COMPLETE;

  if (requiresMfa) {
    const hasConfirmedMfaMethod = await userHasAnyConfirmedMfaMethod(prisma, user.id);
    if (!hasConfirmedMfaMethod) {
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

  // Forced password change and backup-code acknowledgment are enforced as
  // constrained session stages (not just client-side `next` hints) so no HTTP
  // client can reach protected routes while either step is still owed (IAM-001,
  // IAM-002). MFA-required users hit these gates after MFA, at promotion time.
  if (stage === SESSION_STAGE.FULL) {
    if (await userHasUnacknowledgedBackupCodes(prisma, user.id)) {
      stage = SESSION_STAGE.BACKUP_CODES_REQUIRED;
      next = LOGIN_NEXT.BACKUP_CODES_REQUIRED;
    } else if (user.must_change_password) {
      stage = SESSION_STAGE.CHANGE_PASSWORD_REQUIRED;
      next = LOGIN_NEXT.CHANGE_PASSWORD;
    }
  }

  const { session, rawToken } = await createSession(prisma, {
    userId: user.id,
    stage,
    ip: input.ip,
    userAgent: input.userAgent,
    deviceLabel: input.deviceLabel,
    timezone: input.timezone,
  });

  await logLoginSuccess(prisma, {
    ...(audit ?? { email, ip: input.ip, userAgent: input.userAgent, timezone: input.timezone }),
    userId: user.id,
  });
  await resetFailedLoginStreak(prisma, user.id);

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

  const codeResult = await verifyTotpOrRecoveryCodeDetailed(tx, userId, code);
  if (!codeResult.ok) {
    return {
      ok: false,
      reason: codeResult.reason === "consume_conflict" ? "recovery_consume_conflict" : "invalid_code",
    };
  }

  const promotedStage = await promoteSessionToFull(tx, sessionId, userId);
  if (!promotedStage) return { ok: false, reason: "session_not_promoted" };

  const method: MfaMethod = codeResult.method;
  const recoveryMethod = method === "totp" ? undefined : method;

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
        recoveryMethod,
        trustedDeviceRawToken: rawToken,
        stage: promotedStage,
      };
    }
  }

  return { ok: true, method, recoveryMethod, stage: promotedStage };
}

/** Emit MFA audit events after the DB transaction commits (success paths only). */
async function emitMfaAudit(
  db: PrismaClient | Prisma.TransactionClient,
  audit: MfaAuditContext | undefined,
  input: CompleteMfaInput,
  result: CompleteMfaTxResult,
): Promise<void> {
  const auditCtx: MfaAuditContext = audit ?? {
    userId: input.userId,
    sessionId: input.sessionId,
    ip: input.ip,
    userAgent: input.userAgent,
  };
  if (!result.ok) {
    if (result.reason === "invalid_code") {
      await logMfaFailure(db, auditCtx);
    }
    return;
  }
  if (result.recoveryMethod) {
    await logMfaRecoveryConsumed(db, auditCtx, result.recoveryMethod);
  }
  await logMfaSuccess(db, auditCtx, result.method);
  if (result.trustedDeviceRawToken) {
    await logTrustedDeviceCreated(db, auditCtx);
  }
}

/**
 * Complete MFA step: TOTP or backup/emergency recovery code.
 * Promotes session when the code is valid; recovery codes are consumed before
 * promotion so a consume race cannot leave a promoted session behind.
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

  await emitMfaAudit(prisma, audit, input, txResult);

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
    await logLogout(prisma, {
      userId: validated.userId,
      sessionId: validated.session.id,
      ip: audit?.ip,
    });
  }
}
