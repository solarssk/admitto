import type { PrismaClient, Prisma } from "@prisma/client";
import { getSetting } from "./resolver.js";
import { SETTING_INSTANCE_URL } from "./keys.js";

/** Instance URL from SystemSettings (`instance_url`), or null when unset. */
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
