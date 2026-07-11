import type { PrismaClient, Prisma } from "@prisma/client";
import { findUserById } from "../user.js";
import { verifyPassword } from "../password.js";
import { userRequiresMfa, userHasConfirmedTotp } from "../mfa/policy.js";
import { verifyTotpOrRecoveryCode } from "../mfa/verify-step-up-code.js";
import { runInTransaction } from "../prisma-tx.js";

export type OidcLinkStepUpFailureReason =
  | "invalid_credentials"
  | "totp_required"
  | "invalid_totp";

export interface VerifyOidcLinkStepUpInput {
  userId: string;
  password: string;
  /** TOTP or recovery code when MFA is required. */
  code?: string;
}

export type VerifyOidcLinkStepUpResult =
  | { ok: true }
  | { ok: false; reason: OidcLinkStepUpFailureReason };

async function verifyOidcLinkStepUpInTransaction(
  tx: Prisma.TransactionClient,
  input: VerifyOidcLinkStepUpInput,
): Promise<VerifyOidcLinkStepUpResult> {
  const user = await findUserById(tx, input.userId);
  if (!user?.is_active) {
    return { ok: false, reason: "invalid_credentials" };
  }

  if (!user.password_hash) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const passwordOk = await verifyPassword(input.password, user.password_hash);
  if (!passwordOk) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const requiresMfa = await userRequiresMfa(tx, input.userId);
  const hasTotp = await userHasConfirmedTotp(tx, input.userId);
  if (!requiresMfa || !hasTotp) {
    return { ok: true };
  }

  const code = input.code?.trim() ?? "";
  if (!code) {
    return { ok: false, reason: "totp_required" };
  }

  const codeOk = await verifyTotpOrRecoveryCode(tx, input.userId, code);
  if (!codeOk) {
    return { ok: false, reason: "invalid_totp" };
  }

  return { ok: true };
}

/** Re-verify password (+ TOTP when required) before linking an external identity. */
export async function verifyOidcLinkStepUp(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: VerifyOidcLinkStepUpInput,
): Promise<VerifyOidcLinkStepUpResult> {
  return runInTransaction(prisma, (tx) => verifyOidcLinkStepUpInTransaction(tx, input));
}
