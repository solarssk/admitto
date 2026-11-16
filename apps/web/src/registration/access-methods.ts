/**
 * Whether each way of reaching the registration form can be used right now (D-C1, D-A6): public link, event password, SSO. All
 * three are always offered; nobody turns one on or off for the organisation. What a way needs decides:
 * link and password need the Turnstile keys (the password form mails addresses too, D-C2) unless the superadmin set bot protection
 * to "not used" (./bot-protection-mode.ts). SSO needs nothing of the system: the identity provider is the event's own
 * (./sso-provider.ts, judged for the event by the page and by the readiness), and it needs no Turnstile, because the form stands
 * behind a sign-in. Losing what a way needs closes the form of every event that uses it; nothing is deleted. Callers decide
 * availability from `resolveAccessMethodAvailability` at request time, never from a cached copy.
 */

import { REGISTRATION_ACCESS_METHOD, type Prisma, type PrismaClient, type RegistrationAccessMethod } from "@admitto/db";
import { botProtectionApplies, getBotProtectionMode } from "./bot-protection-mode.js";
import { resolveTurnstileKeys } from "./turnstile-settings.js";

/** The methods an event can choose in this release: every one the model has. */
export const SELECTABLE_ACCESS_METHODS = ["link", "password", "sso"] as const satisfies readonly RegistrationAccessMethod[];

export type SelectableAccessMethod = (typeof SELECTABLE_ACCESS_METHODS)[number];

type AccessMethodsDb = PrismaClient | Prisma.TransactionClient;

/** What a method waits for when it is not available. */
export type AccessMethodBlocker = "bot_protection" | "identity_provider";

export interface AccessMethodAvailability {
  method: RegistrationAccessMethod;
  available: boolean;
  blockedBy: AccessMethodBlocker | null;
}

/** The rule itself, apart from the lookups. The company sign-in is never blocked here: its provider belongs to the event. */
export function computeAccessMethodAvailability(input: { botProtectionReady: boolean }): AccessMethodAvailability[] {
  return REGISTRATION_ACCESS_METHOD.map((method) => {
    const ready = method === "sso" || input.botProtectionReady;
    return { method, available: ready, blockedBy: ready ? null : "bot_protection" };
  });
}

/**
 * Every method, in the canonical order, with whether it can be used right now. `eventBotProtection` is the event's own switch
 * (`bot_protection_enabled`): with the organisation's switch or the event's off there is nothing to wait for.
 */
export async function resolveAccessMethodAvailability(db: AccessMethodsDb, eventBotProtection = true): Promise<AccessMethodAvailability[]> {
  const [keys, mode] = await Promise.all([resolveTurnstileKeys(db), getBotProtectionMode(db)]);
  return computeAccessMethodAvailability({ botProtectionReady: !botProtectionApplies(mode, eventBotProtection) || keys.state === "ready" });
}
