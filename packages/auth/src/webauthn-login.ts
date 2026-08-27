import type { PrismaClient, Prisma } from "@admitto/db";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { toTransports, type WebauthnRpConfig } from "./mfa/webauthn.js";

export interface BeginPasskeyLoginResult {
  options: PublicKeyCredentialRequestOptionsJSON;
  challenge: string;
}

/**
 * Build a discoverable-credential ("usernameless") authentication ceremony: no `allowCredentials`
 * list, so the browser offers every passkey registered for this origin instead of one already-
 * identified account's credentials (contrast `beginWebauthnAssertion`, the login-time MFA step-up,
 * which always scopes to a known userId). This is the sole factor for signing in this way, not a
 * second factor after a password, so user verification (device PIN/biometric) is required, not
 * merely preferred.
 */
export async function beginPasskeyLogin(rpID: string): Promise<BeginPasskeyLoginResult> {
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
  });
  return { options, challenge: options.challenge };
}

export interface FinishPasskeyLoginResult {
  userId: string;
  credentialRowId: string;
}

/**
 * Verify a usernameless authentication response and resolve which account it belongs to from the
 * credential ID alone - no userId is known ahead of the call, that's the whole point of a
 * discoverable-credential login. Returns null on any verification failure, unknown credential, or
 * counter regression. Shares `finishWebauthnAssertion`'s single-use-challenge contract: the caller
 * owns stashing/consuming `expectedChallenge`, this function neither stores nor invalidates it.
 */
export async function finishPasskeyLogin(
  prisma: PrismaClient | Prisma.TransactionClient,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  rp: WebauthnRpConfig,
): Promise<FinishPasskeyLoginResult | null> {
  const row = await prisma.userMfaMethod.findFirst({
    where: { type: "webauthn", confirmed_at: { not: null }, webauthn_credential_id: response.id },
  });
  if (!row?.webauthn_credential_id || !row.webauthn_public_key || row.webauthn_sign_count == null) {
    return null;
  }

  const credential: WebAuthnCredential = {
    id: row.webauthn_credential_id,
    publicKey: row.webauthn_public_key,
    counter: row.webauthn_sign_count,
    transports: toTransports(row.webauthn_transports),
  };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential,
      requireUserVerification: true,
    });
  } catch {
    return null;
  }
  if (!verification.verified) return null;

  // Compare-and-swap, same race guard as finishWebauthnAssertion (see its doc comment).
  const { count } = await prisma.userMfaMethod.updateMany({
    where: { id: row.id, webauthn_sign_count: row.webauthn_sign_count },
    data: { webauthn_sign_count: verification.authenticationInfo.newCounter, last_used_at: new Date() },
  });
  if (count === 0) return null;

  return { userId: row.user_id, credentialRowId: row.id };
}
