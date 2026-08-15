import type { PrismaClient, Prisma, TrustedDevice } from "@admitto/db";
import { generateToken, hashToken } from "@admitto/tickets";
import { getTrustedDeviceDays } from "../settings/resolver.js";

export interface CreateTrustedDeviceInput {
  userId: string;
  ip?: string;
  userAgent?: string;
  label?: string;
}

/** Current request's IP/User-Agent, checked against what was recorded when the device was trusted. */
export interface ValidateTrustedDeviceContext {
  ip?: string;
  userAgent?: string;
}

/** Create trusted-device row; returns raw token for cookie (once). */
export async function createTrustedDevice(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CreateTrustedDeviceInput,
): Promise<{ trustedDevice: TrustedDevice; rawToken: string }> {
  const rawToken = generateToken();
  const token_hash = hashToken(rawToken);
  const days = await getTrustedDeviceDays(prisma);
  const now = new Date();
  const expires_at = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const trustedDevice = await prisma.trustedDevice.create({
    data: {
      user_id: input.userId,
      token_hash,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      label: input.label ?? null,
      last_used_at: now,
      expires_at,
    },
  });

  return { trustedDevice, rawToken };
}

/**
 * A trusted-device cookie must still look like the same browser it was minted for, otherwise it's
 * a fully portable bearer token for its whole validity window if exfiltrated (infostealer, stolen
 * laptop, leaked browser-profile backup) - see security finding on this function.
 *
 * A row with no recorded IP (created before this check shipped) has no baseline to compare
 * against, so it stays valid. Otherwise the request's IP must match. An earlier version also
 * accepted a bare User-Agent match as sufficient on its own - but this cookie is checked only
 * after the attacker already has both the account password AND the raw cookie value
 * (validateTrustedDevice is only consulted post-password in login.ts), so it is the LAST factor
 * standing between that attacker and a full MFA bypass. User-Agent is a client-supplied header
 * with no network-level verification at all - trivially copied, and low-entropy enough to guess
 * outright (a handful of common browser/OS strings cover most real traffic) - so accepting it
 * alone made this check defeatable by an attacker on any network who simply sends a common
 * User-Agent string. IP is a materially harder signal to fake for a real, stateful HTTP request
 * (it takes actual network presence, not just a header value), so it's the one signal this check
 * actually gates on now. This does mean a device's remembered trust no longer survives an IP
 * change (mobile network roaming, VPN) - re-verifying MFA in that case is the accepted, deliberate
 * trade-off for closing the guessable-header bypass; User-Agent is still recorded on the row for
 * context, just no longer part of the accept/reject decision.
 */
function deviceContextMatches(
  row: Pick<TrustedDevice, "ip">,
  context: ValidateTrustedDeviceContext,
): boolean {
  if (row.ip === null) return true;
  return row.ip === context.ip;
}

/**
 * Validate trusted-device cookie token for a user. Returns false immediately when
 * trusted_device_days = 0 (feature disabled), or when `context`'s IP no longer matches the one
 * recorded at creation time (see `deviceContextMatches`).
 */
export async function validateTrustedDevice(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  rawToken: string,
  context: ValidateTrustedDeviceContext = {},
): Promise<boolean> {
  const days = await getTrustedDeviceDays(prisma);
  if (days === 0) return false;

  const token_hash = hashToken(rawToken);
  const row = await prisma.trustedDevice.findUnique({
    where: { token_hash },
  });

  if (row?.user_id !== userId) return false;
  if (row.revoked_at) return false;
  if (row.expires_at.getTime() <= Date.now()) return false;
  if (!deviceContextMatches(row, context)) return false;

  await prisma.trustedDevice.update({
    where: { id: row.id },
    data: { last_used_at: new Date() },
  });

  return true;
}

/** Revoke the trusted-device row matching the current cookie token (logout). */
export async function revokeTrustedDeviceByToken(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  rawToken: string | undefined,
): Promise<void> {
  if (!rawToken) return;
  const token_hash = hashToken(rawToken);
  await prisma.trustedDevice.updateMany({
    where: { token_hash, user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

/** Revoke all trusted devices for a user. */
export async function revokeAllTrustedDevicesForUser(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const result = await prisma.trustedDevice.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  return result.count;
}
