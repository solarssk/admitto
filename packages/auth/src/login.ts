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
import { finishWebauthnAssertion, type WebauthnRpConfig } from "./mfa/webauthn.js";
import { getTrustedDeviceDays } from "./settings/resolver.js";
import {
  recordFailedLoginFailureSideEffects,
  resetFailedLoginStreak,
  recordFailedMfaFailureSideEffects,
  resetFailedMfaFailureStreak,
} from "./privileged-login-alert.js";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

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
      "invalid_credentials",
    );
    await recordFailedLoginFailureSideEffects(prisma, user, { ip: input.ip });
    return INVALID;
  }

  if (!user.is_active) {
    await logLoginFailure(
      prisma,
      audit ?? { email, ip: input.ip, userAgent: input.userAgent, timezone: input.timezone },
      "inactive",
    );
    // Same side-effect round trips as the invalid-credentials branch above (P0 security
    // review): a correct password against a deactivated account must take the same time as a
    // wrong password, or response latency alone tells an attacker with a breached credential
    // pair that the password is right and only the account is deactivated.
    await recordFailedLoginFailureSideEffects(prisma, user, { ip: input.ip });
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
      (await validateTrustedDevice(prisma, user.id, input.trustedDeviceToken, {
        ip: input.ip,
        userAgent: input.userAgent,
      }))
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
  | { ok: false; reason: "invalid_code" | "recovery_consume_conflict" }
  | { ok: false; reason: "session_not_promoted"; method: MfaMethod }
  | {
      ok: true;
      method: MfaMethod;
      recoveryMethod?: "backup" | "emergency";
      trustedDeviceRawToken?: string;
      stage: SessionStage;
    };

/**
 * Thrown only inside `completeMfaInTransaction`, and only after `verifyTotpOrRecoveryCodeDetailed`
 * has already verified (and, for a recovery code, consumed) the code. Letting this escape the
 * `$transaction` callback aborts it, rolling the consumption back too - otherwise a locked-out
 * user's single active emergency code could be permanently burned for nothing just because their
 * partial session expired or was concurrently revoked between code entry and promotion. Caught in
 * `completeMfa` and turned back into a normal `session_not_promoted` failure result, but only
 * when `completeMfa` opened this transaction itself - see that function's own docstring.
 */
class SessionPromotionFailedAfterCodeVerifiedError extends Error {
  constructor(public readonly method: MfaMethod) {
    super("mfa session promotion failed after code verification");
  }
}

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
  if (!promotedStage) throw new SessionPromotionFailedAfterCodeVerifiedError(codeResult.method);

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

/** Emit MFA audit events, and the repeated-failure alert side effect, after the DB transaction
 * settles (both success and failure paths - every failure reason is now audited, not just a
 * wrong code, so a `session_not_promoted` rollback still leaves a forensic trail). */
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
    await logMfaFailure(db, auditCtx, result.reason, result.reason === "session_not_promoted" ? result.method : undefined);
    // Only a wrong code counts toward the repeated-guessing alert streak - a recovery-consume
    // race or a session-promotion failure both mean the code itself was correct.
    if (result.reason === "invalid_code") {
      await recordFailedMfaFailureSideEffects(db, input.userId, { ip: input.ip });
    }
    return;
  }
  if (result.recoveryMethod) {
    await logMfaRecoveryConsumed(db, auditCtx, result.recoveryMethod);
  }
  await logMfaSuccess(db, auditCtx, result.method);
  await resetFailedMfaFailureStreak(db, input.userId);
  if (result.trustedDeviceRawToken) {
    await logTrustedDeviceCreated(db, auditCtx);
  }
}

/**
 * Complete MFA step: TOTP or backup/emergency recovery code.
 * Promotes session when the code is valid; recovery codes are consumed before
 * promotion so a consume race cannot leave a promoted session behind. When a code
 * verifies correctly but promotion still fails afterward, the transaction rolls back
 * (see `SessionPromotionFailedAfterCodeVerifiedError`) so the code is never burned for
 * nothing, and the failure is still audited via `emitMfaAudit`.
 *
 * That rollback guarantee only holds when `prisma` is a root client: this function opens its
 * own `$transaction` there, so it's the one rolling the consumption back before converting the
 * thrown sentinel into a normal `session_not_promoted` result. When `prisma` is already a
 * `Prisma.TransactionClient` (a caller-owned transaction), this function has no authority to
 * roll that transaction back itself - swallowing the sentinel here would let the caller commit
 * a verified, consumed code with no session ever granted. So in that mode the sentinel is left
 * to propagate uncaught: the caller's own transaction wrapper must abort on it (and, if it wants
 * one, produce its own audit record - `emitMfaAudit` below never runs on this path).
 */
export async function completeMfa(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CompleteMfaInput,
  audit?: MfaAuditContext,
): Promise<CompleteMfaResult> {
  let txResult: CompleteMfaTxResult;
  if ("$transaction" in prisma && typeof prisma.$transaction === "function") {
    try {
      txResult = await prisma.$transaction((tx) => completeMfaInTransaction(tx, input));
    } catch (err) {
      if (!(err instanceof SessionPromotionFailedAfterCodeVerifiedError)) throw err;
      txResult = { ok: false, reason: "session_not_promoted", method: err.method };
    }
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

/** Input for `completeMfaWithWebauthn()` after password login with partial session. `challenge`
 * is the caller's own responsibility to have stashed at the matching assert/begin call and
 * consumed (single-use) before calling this - see `finishWebauthnAssertion`'s own docstring. */
export interface CompleteMfaWithWebauthnInput {
  userId: string;
  sessionId: string;
  response: AuthenticationResponseJSON;
  challenge: string;
  rp: WebauthnRpConfig;
  rememberDevice?: boolean;
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
}

type CompleteMfaWithWebauthnTxResult =
  | { ok: false; reason: "invalid_webauthn" }
  | { ok: false; reason: "session_not_promoted" }
  | { ok: true; trustedDeviceRawToken?: string; stage: SessionStage };

/** Sibling of `SessionPromotionFailedAfterCodeVerifiedError` for the WebAuthn path - same
 * roll-back-the-verification-too rationale, just nothing to "burn" here (an assertion isn't a
 * one-time code), so it exists purely to keep the transaction atomic and the failure audited. */
class WebauthnSessionPromotionFailedAfterVerifiedError extends Error {
  constructor() {
    super("mfa session promotion failed after webauthn assertion verified");
  }
}

async function completeMfaWithWebauthnInTransaction(
  tx: Prisma.TransactionClient,
  input: CompleteMfaWithWebauthnInput,
): Promise<CompleteMfaWithWebauthnTxResult> {
  const { userId, sessionId, response, challenge, rp } = input;

  const verified = await finishWebauthnAssertion(tx, userId, response, challenge, rp);
  if (!verified) return { ok: false, reason: "invalid_webauthn" };

  const promotedStage = await promoteSessionToFull(tx, sessionId, userId);
  if (!promotedStage) throw new WebauthnSessionPromotionFailedAfterVerifiedError();

  if (input.rememberDevice) {
    const days = await getTrustedDeviceDays(tx);
    if (days > 0) {
      const { rawToken } = await createTrustedDevice(tx, {
        userId,
        ip: input.ip,
        userAgent: input.userAgent,
        label: input.deviceLabel,
      });
      return { ok: true, trustedDeviceRawToken: rawToken, stage: promotedStage };
    }
  }

  return { ok: true, stage: promotedStage };
}

/** Sibling of `emitMfaAudit` for the WebAuthn path. Unlike a wrong code, a rejected assertion
 * isn't something an attacker can practically brute-force, so it doesn't feed the repeated-
 * guessing alert streak (`recordFailedMfaFailureSideEffects`) - that streak exists for
 * enumerable/guessable credentials. */
async function emitMfaWebauthnAudit(
  db: PrismaClient | Prisma.TransactionClient,
  audit: MfaAuditContext | undefined,
  input: CompleteMfaWithWebauthnInput,
  result: CompleteMfaWithWebauthnTxResult,
): Promise<void> {
  const auditCtx: MfaAuditContext = audit ?? {
    userId: input.userId,
    sessionId: input.sessionId,
    ip: input.ip,
    userAgent: input.userAgent,
  };
  if (!result.ok) {
    await logMfaFailure(db, auditCtx, result.reason, result.reason === "session_not_promoted" ? "webauthn" : undefined);
    return;
  }
  await logMfaSuccess(db, auditCtx, "webauthn");
  await resetFailedMfaFailureStreak(db, input.userId);
  if (result.trustedDeviceRawToken) {
    await logTrustedDeviceCreated(db, auditCtx);
  }
}

/**
 * Complete MFA step via a WebAuthn assertion - sibling of `completeMfa`, same
 * transaction/rollback/audit shape, but verifying a signed assertion instead of a TOTP/recovery
 * code. Kept separate rather than folding into `completeMfa`'s single `code: string` input: the
 * two failure taxonomies don't map onto each other cleanly (`recovery_consume_conflict` has no
 * WebAuthn equivalent), and there are only two call sites total, so the ~associated duplication
 * here is cheaper than a generalized, harder-to-follow shared code path.
 */
export async function completeMfaWithWebauthn(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CompleteMfaWithWebauthnInput,
  audit?: MfaAuditContext,
): Promise<CompleteMfaResult> {
  let txResult: CompleteMfaWithWebauthnTxResult;
  if ("$transaction" in prisma && typeof prisma.$transaction === "function") {
    try {
      txResult = await prisma.$transaction((tx) => completeMfaWithWebauthnInTransaction(tx, input));
    } catch (err) {
      if (!(err instanceof WebauthnSessionPromotionFailedAfterVerifiedError)) throw err;
      txResult = { ok: false, reason: "session_not_promoted" };
    }
  } else {
    txResult = await completeMfaWithWebauthnInTransaction(prisma, input);
  }

  await emitMfaWebauthnAudit(prisma, audit, input, txResult);

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
