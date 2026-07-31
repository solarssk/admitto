import type { PrismaClient, Prisma } from "@admitto/db";
import { getSetting } from "./resolver.js";
import { SETTING_INSTANCE_URL } from "./keys.js";

/** Instance URL from SystemSettings (`instance_url`), or null when unset.
 *  For mail/ticket link resolution with env/dev fallbacks, use {@link resolveInstanceBaseUrl}. */
export async function getInstanceUrl(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<string | null> {
  const v = await getSetting<string | null>(prisma, SETTING_INSTANCE_URL);
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}
