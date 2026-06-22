import type { PrismaClient, Prisma, TrustedDevice } from "@prisma/client";
import { generateToken, hashToken } from "@admitto/tickets";
import { getTrustedDeviceDays } from "../settings/resolver.js";

export interface CreateTrustedDeviceInput {
  userId: string;
  ip?: string;
  userAgent?: string;
  label?: string;
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

/** Validate trusted-device cookie token for a user. Returns false immediately when trusted_device_days = 0 (feature disabled). */
export async function validateTrustedDevice(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  rawToken: string,
): Promise<boolean> {
  const days = await getTrustedDeviceDays(prisma);
  if (days === 0) return false;

  const token_hash = hashToken(rawToken);
  const row = await prisma.trustedDevice.findUnique({
    where: { token_hash },
  });

  if (!row || row.user_id !== userId) return false;
  if (row.revoked_at) return false;
  if (row.expires_at.getTime() <= Date.now()) return false;

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
