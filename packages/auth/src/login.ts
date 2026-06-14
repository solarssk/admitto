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
import { verifyBackupRecoveryCode } from "./mfa/backup-recovery.js";
import { verifyEmergencyRecoveryCode } from "./mfa/emergency-recovery.js";
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

export interface CompleteMfaInput {
  userId: string;
  sessionId: string;
  code: string;
  rememberDevice?: boolean;
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
}

export interface CompleteMfaResult {
  ok: boolean;
  trustedDeviceRawToken?: string;
}

/**
 * Complete MFA step: TOTP or backup/emergency recovery code.
 * Promotes session to full; optionally creates trusted device.
 */
export async function completeMfa(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CompleteMfaInput,
): Promise<CompleteMfaResult> {
  const { userId, sessionId, code } = input;

  let verified = await verifyUserTotpCode(prisma, userId, code);
  if (!verified) {
    verified = await verifyBackupRecoveryCode(prisma, userId, code);
  }
  if (!verified) {
    verified = await verifyEmergencyRecoveryCode(prisma, userId, code);
  }
  if (!verified) return { ok: false };

  await promoteSessionToFull(prisma, sessionId, userId);

  if (input.rememberDevice) {
    const { rawToken } = await createTrustedDevice(prisma, {
      userId,
      ip: input.ip,
      userAgent: input.userAgent,
      label: input.deviceLabel,
    });
    return { ok: true, trustedDeviceRawToken: rawToken };
  }

  return { ok: true };
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
