/**
 * Which ways of reaching the registration form the system administrator has made available
 * (D-C1, D-A6): public link, event password, SSO. The list is empty until a superadmin decides,
 * and an event can pick only a method that is available.
 *
 * "Available" is stricter than "enabled". A method the administrator enabled is available only when
 * what it needs is there: link and password need the Turnstile keys (the password form mails
 * addresses too, D-C2), SSO needs an enabled OIDC provider. Turning a method off, or losing what
 * it needs, closes the form of every event that uses it; nothing is deleted. Callers decide
 * availability from `resolveAccessMethodAvailability` at request time, never from a cached copy.
 */

import { findEnabledOidcProviders } from "@admitto/auth";
import { REGISTRATION_ACCESS_METHOD, type Prisma, type PrismaClient, type RegistrationAccessMethod } from "@admitto/db";
import { resolveTurnstileKeys } from "./turnstile-settings.js";

/** SystemSettings.key of the JSON array of enabled method names. */
export const ACCESS_METHODS_SETTINGS_KEY = "registration_access_methods";

type AccessMethodsDb = PrismaClient | Prisma.TransactionClient;

/** What a method waits for when it is enabled but not available. */
export type AccessMethodBlocker = "bot_protection" | "identity_provider";

export interface AccessMethodAvailability {
  method: RegistrationAccessMethod;
  enabled: boolean;
  available: boolean;
  blockedBy: AccessMethodBlocker | null;
}

/** The known methods that appear in `value`, once each, in the canonical order. Anything else
 * (an unknown name, a duplicate, a value that is not an array) is dropped. */
function knownMethods(value: unknown): RegistrationAccessMethod[] {
  if (!Array.isArray(value)) return [];
  return REGISTRATION_ACCESS_METHOD.filter((method) => value.includes(method));
}

/** The methods the system administrator enabled. Empty by default and for a corrupt row. */
export async function getEnabledAccessMethods(db: AccessMethodsDb): Promise<RegistrationAccessMethod[]> {
  const row = await db.systemSettings.findUnique({ where: { key: ACCESS_METHODS_SETTINGS_KEY } });
  if (!row) return [];
  try {
    return knownMethods(JSON.parse(row.value_json));
  } catch {
    return [];
  }
}

/** Replaces the enabled methods. Unknown names and duplicates are dropped; `[]` turns all off. */
export async function setEnabledAccessMethods(
  db: AccessMethodsDb,
  methods: readonly string[],
): Promise<RegistrationAccessMethod[]> {
  const enabled = knownMethods(methods);
  const value_json = JSON.stringify(enabled);
  await db.systemSettings.upsert({
    where: { key: ACCESS_METHODS_SETTINGS_KEY },
    create: { key: ACCESS_METHODS_SETTINGS_KEY, value_json },
    update: { value_json },
  });
  return enabled;
}

/** The rule itself, apart from the lookups. */
export function computeAccessMethodAvailability(input: {
  enabled: readonly RegistrationAccessMethod[];
  botProtectionReady: boolean;
  identityProviderEnabled: boolean;
}): AccessMethodAvailability[] {
  return REGISTRATION_ACCESS_METHOD.map((method) => {
    const enabled = input.enabled.includes(method);
    const ready = method === "sso" ? input.identityProviderEnabled : input.botProtectionReady;
    const blocker: AccessMethodBlocker = method === "sso" ? "identity_provider" : "bot_protection";
    return { method, enabled, available: enabled && ready, blockedBy: enabled && !ready ? blocker : null };
  });
}

/** Every method, in the canonical order, with whether the administrator enabled it and whether it
 * can be used right now. */
export async function resolveAccessMethodAvailability(db: AccessMethodsDb): Promise<AccessMethodAvailability[]> {
  const [enabled, keys, providers] = await Promise.all([
    getEnabledAccessMethods(db),
    resolveTurnstileKeys(db),
    findEnabledOidcProviders(db),
  ]);
  return computeAccessMethodAvailability({
    enabled,
    botProtectionReady: keys.state === "ready",
    identityProviderEnabled: providers.length > 0,
  });
}
