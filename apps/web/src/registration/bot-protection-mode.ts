/**
 * Whether the public registration form is guarded by a bot check at all (A2): an instance setting that only a superadmin
 * changes, kept in SystemSettings like the Turnstile keys and the ways in.
 *
 * - `required` (the default, and what every row that is missing or does not read back means): the link and the password
 *   need the Turnstile keys, and every submission carries a token that Cloudflare confirms (./bot-challenge.ts).
 * - `not_used`: for an organisation that runs the form inside its own network or does not use Cloudflare. The link and the
 *   password work without keys, the page has no widget, and nothing but the usual limits of
 *   `apps/web/src/rate-limit/policies.ts` stands between a script and the form (they are not tightened: the guests of a company
 *   share one address, and a form opens at a fixed hour). The company sign-in is not affected: it never had a check.
 *
 * Read at every request, never cached, like the keys: a change is in force at once on every replica.
 */
import type { Prisma, PrismaClient } from "@admitto/db";

/** SystemSettings.key of the JSON string that holds the mode. */
export const BOT_PROTECTION_SETTINGS_KEY = "registration_bot_protection";

export const BOT_PROTECTION_MODES = ["required", "not_used"] as const;

export type BotProtectionMode = (typeof BOT_PROTECTION_MODES)[number];

type ModeDb = PrismaClient | Prisma.TransactionClient;

/** The mode, `required` for a missing, corrupt or unknown row: the check is never dropped by accident. */
export async function getBotProtectionMode(db: ModeDb): Promise<BotProtectionMode> {
  const row = await db.systemSettings.findUnique({ where: { key: BOT_PROTECTION_SETTINGS_KEY } });
  if (!row) return "required";
  try {
    return JSON.parse(row.value_json) === "not_used" ? "not_used" : "required";
  } catch {
    return "required";
  }
}

/** Saves the mode. `required` is stored as a row too, so that the audit trail and the stored value agree. */
export async function setBotProtectionMode(db: ModeDb, mode: BotProtectionMode): Promise<void> {
  const value_json = JSON.stringify(mode);
  await db.systemSettings.upsert({
    where: { key: BOT_PROTECTION_SETTINGS_KEY },
    create: { key: BOT_PROTECTION_SETTINGS_KEY, value_json },
    update: { value_json },
  });
}
