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
 * Rows with no recorded IP/User-Agent (created before this check shipped) have no baseline to
 * compare against, so they stay valid. Otherwise either signal matching is enough: User-Agent
 * alone survives IP rotation from mobile networks/ISP DHCP renewal (an exact-IP-only requirement
 * would re-prompt MFA on nearly every trip for those users), IP alone survives a browser update
 * changing the User-Agent string. Only a request that differs on *both* - the expected shape of an
 * exfiltrated cookie used from a different device on a different network - is rejected.
 */
function deviceContextMatches(
  row: Pick<TrustedDevice, "ip" | "user_agent">,
  context: ValidateTrustedDeviceContext,
): boolean {
  if (row.ip === null && row.user_agent === null) return true;

  const ipMatches = row.ip !== null && row.ip === context.ip;
  const userAgentMatches = row.user_agent !== null && row.user_agent === context.userAgent;
  return ipMatches || userAgentMatches;
}

/**
 * Validate trusted-device cookie token for a user. Returns false immediately when
 * trusted_device_days = 0 (feature disabled), or when `context` no longer matches the IP/User-Agent
 * recorded at creation time closely enough (see `deviceContextMatches`).
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
