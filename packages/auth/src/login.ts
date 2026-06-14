import type { PrismaClient, Prisma } from "@prisma/client";
import { verifyPasswordOrDummy } from "./password.js";
import { findUserByEmail, normalizeEmail } from "./user.js";
import { createSession, type ValidatedSession } from "./session.js";
import { logLoginFailure, logLoginSuccess, type LoginAuditContext } from "./audit.js";

/** Credentials and request metadata for `login()`. */
export interface LoginInput {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

/** Discriminated result: raw session token on success; uniform failure reasons for callers. */
export type LoginResult =
  | { ok: true; rawToken: string; sessionId: string; userId: string }
  | { ok: false; reason: "invalid_credentials" | "inactive" };

const INVALID: LoginResult = { ok: false, reason: "invalid_credentials" };

/**
 * Authenticate by email/password, create a session, and emit audit logs.
 * Inactive users and wrong credentials both fail closed; HTTP layers map failures to 401.
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

  const { session, rawToken } = await createSession(prisma, {
    userId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  logLoginSuccess(audit ?? { email, ip: input.ip, userAgent: input.userAgent });

  return {
    ok: true,
    rawToken,
    sessionId: session.id,
    userId: user.id,
  };
}

/** Revoke the validated session row (idempotent when already revoked). */
export async function logout(
  prisma: PrismaClient | Prisma.TransactionClient,
  validated: ValidatedSession | null,
): Promise<void> {
  if (!validated) return;
  await prisma.session.updateMany({
    where: { id: validated.session.id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}
