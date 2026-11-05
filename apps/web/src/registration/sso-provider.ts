/**
 * Which identity provider guests sign in with (D-C4): one for the instance, chosen by a superadmin among the OIDC providers
 * that staff sign in with too. The choice is a `SystemSettings` row holding the id of the provider; it is not a copy of any
 * of the provider's settings, so the endpoints, the client and its secret stay where staff manage them.
 *
 * The company sign-in is available only while the chosen provider exists and is enabled. Disabling or deleting it closes the
 * form of every event that uses the sign-in and deletes nothing, as turning any way in off does (./access-methods.ts). The
 * lookup is made at request time, never cached.
 */
import { findEnabledOidcProviders, findOidcProviderById } from "@admitto/auth";
import type { IdentityProvider, Prisma, PrismaClient } from "@admitto/db";

/** SystemSettings.key of the JSON string that holds the id of the provider guests sign in with. */
export const SSO_PROVIDER_SETTINGS_KEY = "registration_sso_provider_id";

type ProviderDb = PrismaClient | Prisma.TransactionClient;

/**
 * Where the choice stands: `ready` (the provider is there and enabled), `not_selected` (nothing is chosen), `missing` (the
 * chosen provider was deleted, or is not an OIDC provider) or `disabled` (it is there and switched off).
 */
export type GuestSsoProviderState = "ready" | "not_selected" | "missing" | "disabled";

export type GuestSsoProvider = { state: "ready"; provider: IdentityProvider } | { state: Exclude<GuestSsoProviderState, "ready"> };

/** The id of the chosen provider, or null for no choice and for a row that does not read as an id. */
export async function getSsoProviderId(db: ProviderDb): Promise<string | null> {
  const row = await db.systemSettings.findUnique({ where: { key: SSO_PROVIDER_SETTINGS_KEY } });
  if (!row) return null;
  try {
    const value: unknown = JSON.parse(row.value_json);
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Saves the choice; `null` removes it. The caller has checked that the provider can be chosen. */
export async function setSsoProviderId(db: ProviderDb, providerId: string | null): Promise<void> {
  if (providerId === null) {
    await db.systemSettings.deleteMany({ where: { key: SSO_PROVIDER_SETTINGS_KEY } });
    return;
  }
  const value_json = JSON.stringify(providerId);
  await db.systemSettings.upsert({
    where: { key: SSO_PROVIDER_SETTINGS_KEY },
    create: { key: SSO_PROVIDER_SETTINGS_KEY, value_json },
    update: { value_json },
  });
}

/** The chosen provider with its state. The provider's secret is part of the row, so a caller that answers a request from it
 * picks the fields it needs and never passes the row on. */
export async function resolveGuestSsoProvider(db: ProviderDb): Promise<GuestSsoProvider> {
  const id = await getSsoProviderId(db);
  if (id === null) return { state: "not_selected" };
  const provider = await findOidcProviderById(db, id);
  if (!provider) return { state: "missing" };
  return provider.enabled ? { state: "ready", provider } : { state: "disabled" };
}

/** What a superadmin may choose among: the enabled OIDC providers, by id and the name staff gave them. */
export async function listSelectableSsoProviders(db: ProviderDb): Promise<{ id: string; display_name: string }[]> {
  const providers = await findEnabledOidcProviders(db);
  return providers.map((provider) => ({ id: provider.id, display_name: provider.display_name }));
}
