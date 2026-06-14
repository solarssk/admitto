import type { PrismaClient, Prisma } from "@prisma/client";
import { verifyPasswordOrDummy } from "./password.js";
import { findUserByEmail, normalizeEmail } from "./user.js";
import {
  createSession,
  promoteSessionToFull,
  type ValidatedPartialSession,
} from "./session.js";
import { logLoginFailure, logLoginSuccess, type LoginAuditContext } from "./audit.js";
import {
  LOGIN_NEXT,
  SESSION_STAGE,
  type LoginNext,
  type SessionStage,
} from "./constants.js";
import { userRequiresMfa, userHasConfirmedTotp } from "./mfa/policy.js";
import { validateTrustedDevice } from "./mfa/trusted-device.js";
import { findBackupRecoveryRowId } from "./mfa/backup-recovery.js";
import { findEmergencyRecoveryRowId } from "./mfa/emergency-recovery.js";
import { consumeRecoveryRow } from "./mfa/recovery-consume.js";
import { verifyUserTotpCode } from "./mfa/enrollment.js";
import { createTrustedDevice } from "./mfa/trusted-device.js";

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
}

async function completeMfaInTransaction(
  tx: Prisma.TransactionClient,
  input: CompleteMfaInput,
): Promise<CompleteMfaResult> {
  const { userId, sessionId, code } = input;

  const totpOk = await verifyUserTotpCode(tx, userId, code);
  let recoveryRowId: string | null = null;

  if (!totpOk) {
    recoveryRowId = await findBackupRecoveryRowId(tx, userId, code);
    if (!recoveryRowId) {
      recoveryRowId = await findEmergencyRecoveryRowId(tx, userId, code);
    }
  }

  if (!totpOk && !recoveryRowId) return { ok: false };

  const promoted = await promoteSessionToFull(tx, sessionId, userId);
  if (!promoted) return { ok: false };

  if (recoveryRowId) {
    const consumed = await consumeRecoveryRow(tx, recoveryRowId);
    if (!consumed) return { ok: false };
  }

  if (input.rememberDevice) {
    const { rawToken } = await createTrustedDevice(tx, {
      userId,
      ip: input.ip,
      userAgent: input.userAgent,
      label: input.deviceLabel,
    });
    return { ok: true, trustedDeviceRawToken: rawToken };
  }

  return { ok: true };
}

/**
 * Complete MFA step: TOTP or backup/emergency recovery code.
 * Promotes session to full when code is valid; recovery codes are consumed only after promotion.
 */
export async function completeMfa(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CompleteMfaInput,
): Promise<CompleteMfaResult> {
  if ("$transaction" in prisma && typeof prisma.$transaction === "function") {
    return prisma.$transaction((tx) => completeMfaInTransaction(tx, input));
  }
  return completeMfaInTransaction(prisma, input);
}

/** Revoke the validated session row (idempotent when already revoked). */
export async function logout(
  prisma: PrismaClient | Prisma.TransactionClient,
  validated: ValidatedPartialSession | import("./session.js").ValidatedSession | null,
): Promise<void> {
  if (!validated) return;
  await prisma.session.updateMany({
    where: { id: validated.session.id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}
