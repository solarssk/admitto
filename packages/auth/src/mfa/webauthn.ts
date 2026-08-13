import type { PrismaClient, Prisma } from "@admitto/db";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { findUserById } from "../user.js";
import { ensureFreshEnrollmentBackupCodes } from "./backup-recovery.js";
import { userHasAnyConfirmedMfaMethod } from "./policy.js";
import { runInTransaction } from "../prisma-tx.js";

/** "platform" = passkey (Touch ID/Windows Hello/password manager); "cross-platform" = security
 * key (USB/NFC/BLE FIDO2 device). Same ceremony either way — only this hint and the My Account
 * row it's registered from differ. */
export type WebauthnAttachment = "platform" | "cross-platform";

/** Relying Party identity resolved from the instance's own base URL — single-instance app, no
 * per-tenant RP ID. */
export interface WebauthnRpConfig {
  rpName: string;
  /** Bare hostname (no scheme/port), e.g. "admitto.example.com" or "localhost". */
  rpID: string;
  /** Full origin, e.g. "https://admitto.example.com". */
  origin: string;
}

function toTransports(transports: string[]): AuthenticatorTransportFuture[] {
  return transports as AuthenticatorTransportFuture[];
}

export interface BeginWebauthnRegistrationResult {
  options: PublicKeyCredentialCreationOptionsJSON;
  challenge: string;
}

/** Build registration ceremony options for a new passkey/security key. Excludes the user's own
 * existing WebAuthn credentials so the browser won't offer to re-register the same authenticator. */
export async function beginWebauthnRegistration(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  attachment: WebauthnAttachment,
  rp: WebauthnRpConfig,
): Promise<BeginWebauthnRegistrationResult | null> {
  const user = await findUserById(prisma, userId);
  if (!user) return null;

  const existing = await prisma.userMfaMethod.findMany({
    where: { user_id: userId, type: "webauthn", webauthn_credential_id: { not: null } },
    select: { webauthn_credential_id: true, webauthn_transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: user.display_name ?? user.email,
    // Generic FIDO2 acceptance, no vendor attestation checks (out of scope, see plan).
    attestationType: "none",
    excludeCredentials: existing
      .filter((c) => c.webauthn_credential_id !== null)
      .map((c) => ({
        id: c.webauthn_credential_id as string,
        transports: toTransports(c.webauthn_transports),
      })),
    authenticatorSelection: {
      // Passkeys must be discoverable (resident) to earn the name and sync across a password
      // manager/iCloud Keychain. Security keys don't need it — we always pass an explicit
      // `allowCredentials` list at assertion time (never usernameless login), so preferring
      // resident credentials there would only burn a hardware key's limited resident-key slots
      // for no benefit.
      residentKey: attachment === "platform" ? "required" : "discouraged",
      // Ask, don't require — mirrors how a TOTP code alone already counts as the second factor.
      userVerification: "preferred",
    },
    // Non-binding UI ordering hint (WebAuthn Level 3 `hints`, Chrome/Edge 128+) rather than a
    // hard `authenticatorAttachment` filter: a synced/vault-backed authenticator from a
    // third-party password manager extension doesn't always self-identify as "platform", and
    // whether it should is an open dispute (github.com/bitwarden/clients/issues/6963) - a hard
    // requirement there can outright block the ceremony instead of just de-prioritizing it in
    // the picker.
    preferredAuthenticatorType: attachment === "platform" ? "localDevice" : "securityKey",
  });
  // @simplewebauthn/server sets `authenticatorSelection.authenticatorAttachment` itself as a
  // backwards-compatibility side effect of `preferredAuthenticatorType` above - strip it back
  // out, otherwise it reintroduces the exact hard block this whole change exists to avoid.
  delete options.authenticatorSelection?.authenticatorAttachment;

  return { options, challenge: options.challenge };
}

export interface FinishWebauthnRegistrationResult {
  credentialRowId: string;
  /** Plaintext backup codes — only non-empty when this was the user's first-ever confirmed MFA
   * method (mirrors TOTP's fresh-enrollment behavior). */
  backupCodes: string[];
}

/** Verify a registration response and store the new credential. Returns null on any verification
 * failure or if this credential ID is already registered (to this user or another). */
export async function finishWebauthnRegistration(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  attachment: WebauthnAttachment,
  label: string | null,
  rp: WebauthnRpConfig,
): Promise<FinishWebauthnRegistrationResult | null> {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
  } catch {
    return null;
  }
  if (!verification.verified || !verification.registrationInfo) return null;

  const { credential, aaguid } = verification.registrationInfo;

  return runInTransaction(prisma, async (tx) => {
    const dup = await tx.userMfaMethod.findFirst({
      where: { webauthn_credential_id: credential.id },
      select: { id: true },
    });
    if (dup) return null;

    // Must run before creating this row: it looks for any other already-confirmed method to
    // decide whether this is a fresh (first-ever) enrollment, and creating the row first would
    // make it see itself as "already confirmed".
    const isFirstMfaMethod = !(await userHasAnyConfirmedMfaMethod(tx, userId));
    const backupCodes = isFirstMfaMethod ? await ensureFreshEnrollmentBackupCodes(tx, userId) : [];

    const created = await tx.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "webauthn",
        label,
        confirmed_at: new Date(),
        last_used_at: new Date(),
        webauthn_credential_id: credential.id,
        webauthn_public_key: credential.publicKey,
        webauthn_sign_count: credential.counter,
        webauthn_transports: credential.transports ?? [],
        webauthn_attachment: attachment,
        webauthn_aaguid: aaguid,
        // Force the backup-codes acknowledgment step before a full session (IAM-002) — only when
        // this is the first method, same rule as confirmTotpEnrollment. Omitted otherwise, so the
        // column keeps its schema default (already acknowledged).
        ...(isFirstMfaMethod ? { backup_codes_acknowledged_at: null } : {}),
      },
    });

    return { credentialRowId: created.id, backupCodes };
  });
}

export interface WebauthnCredentialSummary {
  id: string;
  label: string | null;
  attachment: WebauthnAttachment | null;
  confirmedAt: Date | null;
  lastUsedAt: Date | null;
}

/** List a user's confirmed WebAuthn credentials (passkeys and security keys together). */
export async function listWebauthnCredentials(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<WebauthnCredentialSummary[]> {
  const rows = await prisma.userMfaMethod.findMany({
    where: { user_id: userId, type: "webauthn", confirmed_at: { not: null } },
    orderBy: { created_at: "asc" },
    select: { id: true, label: true, webauthn_attachment: true, confirmed_at: true, last_used_at: true },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    attachment: r.webauthn_attachment as WebauthnAttachment | null,
    confirmedAt: r.confirmed_at,
    lastUsedAt: r.last_used_at,
  }));
}

/** Remove one WebAuthn credential by its row id. Returns false if it doesn't exist or isn't
 * owned by this user (caller decides whether that's a 404). */
export async function removeWebauthnCredential(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  credentialRowId: string,
): Promise<boolean> {
  const { count } = await prisma.userMfaMethod.deleteMany({
    where: { id: credentialRowId, user_id: userId, type: "webauthn" },
  });
  return count > 0;
}

export interface BeginWebauthnAssertionResult {
  options: PublicKeyCredentialRequestOptionsJSON;
  challenge: string;
}

/** Build authentication ceremony options against a user's registered credentials. Returns null
 * when the user has none. */
export async function beginWebauthnAssertion(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  rpID: string,
): Promise<BeginWebauthnAssertionResult | null> {
  const credentials = await prisma.userMfaMethod.findMany({
    where: { user_id: userId, type: "webauthn", confirmed_at: { not: null }, webauthn_credential_id: { not: null } },
    select: { webauthn_credential_id: true, webauthn_transports: true },
  });
  if (credentials.length === 0) return null;

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials
      .filter((c) => c.webauthn_credential_id !== null)
      .map((c) => ({
        id: c.webauthn_credential_id as string,
        transports: toTransports(c.webauthn_transports),
      })),
    // Discoverable-credential UV, not required — WebAuthn here is always the *second* factor
    // (after password), same trust level as a TOTP code.
    userVerification: "preferred",
  });

  return { options, challenge: options.challenge };
}

export interface FinishWebauthnAssertionResult {
  credentialRowId: string;
}

/**
 * Verify an authentication response against the credential it claims to be, updating its sign
 * counter. Returns null on any verification failure, unknown credential, or counter regression.
 *
 * `expectedChallenge` is the caller's responsibility to make single-use: this function does not
 * store, consume, or invalidate it. The caller must persist each challenge keyed uniquely (e.g.
 * per session) and delete it immediately after this call — success or failure — so a captured
 * response can never be replayed against a still-valid challenge. The sign-counter check alone
 * is not a substitute: many real authenticators (most platform passkeys) always report counter
 * `0`, and `@simplewebauthn/server` only rejects a counter *regression* when at least one of the
 * stored/new values is nonzero — an authenticator stuck at `0` gets no counter-based replay
 * protection at all, so single-use challenge storage is the only real defense in that case.
 */
export async function finishWebauthnAssertion(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  rp: WebauthnRpConfig,
): Promise<FinishWebauthnAssertionResult | null> {
  const row = await prisma.userMfaMethod.findFirst({
    where: {
      user_id: userId,
      type: "webauthn",
      confirmed_at: { not: null },
      webauthn_credential_id: response.id,
    },
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
      requireUserVerification: false,
    });
  } catch {
    return null;
  }
  if (!verification.verified) return null;

  await prisma.userMfaMethod.update({
    where: { id: row.id },
    data: { webauthn_sign_count: verification.authenticationInfo.newCounter, last_used_at: new Date() },
  });

  return { credentialRowId: row.id };
}
