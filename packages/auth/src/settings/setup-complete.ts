import type { PrismaClient, Prisma } from "@prisma/client";
import { getSetting, setSetting } from "./resolver.js";
import { SETTING_SETUP_COMPLETE } from "./keys.js";

/**
 * First-run wizard completion flag.
 * Missing key → true (upgrade-safe); explicit false only after POST /setup.
 */
export async function resolveSetupComplete(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<boolean> {
  const raw = await getSetting<boolean | undefined>(prisma, SETTING_SETUP_COMPLETE);
  if (raw === undefined || raw === null) return true;
  return raw === true;
}

/** Mark onboarding incomplete (atomically with superadmin bootstrap). */
export async function markSetupIncomplete(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  await setSetting(prisma, SETTING_SETUP_COMPLETE, false);
}

/** Mark onboarding complete after wizard step 5. */
export async function markSetupComplete(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  await setSetting(prisma, SETTING_SETUP_COMPLETE, true);
}
