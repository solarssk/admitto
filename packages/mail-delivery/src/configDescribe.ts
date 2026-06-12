import type { PrismaClient } from "@prisma/client";
import {
  describeMailConfig,
  type ConfigDescriptor,
} from "@admitto/mailer-config";

/**
 * Read-only masked mail config for an event (secrets never decrypted).
 * Thin passthrough for future admin UI — same semantics as describeMailConfig.
 */
export async function getMailConfigDescription(
  eventId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConfigDescriptor> {
  return describeMailConfig(eventId, prisma, env);
}
