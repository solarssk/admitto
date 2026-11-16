/**
 * Which identity provider guests sign in with (D-C4): each event that uses the company sign-in names one, among the OIDC providers
 * that staff sign in with too (`EventRegistrationSettings.sso_provider_id`; it is not a copy of any of the provider's settings, so
 * the endpoints, the client and its secret stay where staff manage them). The `SystemSettings` row of the single provider for the
 * whole instance (`getSsoProviderId` and the functions around it) is the earlier model: it stays for the superadmin's old screen
 * and for the backfill of the column, and the form of a guest no longer reads it.
 *
 * The company sign-in is available to an event only while its provider exists and is enabled. Disabling or deleting it closes the
 * form of every event that uses it and deletes nothing, as turning any way in off does (./access-methods.ts). The lookup is made
 * at request time, never cached.
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

/** The state of a choice from the stored id and the provider row found for it (null: none). One id, so the two cannot disagree. */
export function ssoProviderState(id: string | null, provider: { enabled: boolean } | null): GuestSsoProviderState {
  if (id === null) return "not_selected";
  if (!provider) return "missing";
  return provider.enabled ? "ready" : "disabled";
}

/** The provider with this id (the one an event chose) and its state. The provider's secret is part of the row, so a caller that
 * answers a request from it picks the fields it needs and never passes the row on. Reads nothing of `SystemSettings`. */
export async function resolveGuestSsoProvider(db: ProviderDb, providerId: string | null): Promise<GuestSsoProvider> {
  if (providerId === null) return { state: "not_selected" };
  const provider = await findOidcProviderById(db, providerId);
  if (!provider) return { state: "missing" };
  return provider.enabled ? { state: "ready", provider } : { state: "disabled" };
}

/**
 * The provider an event chose, as an organiser may see it: the id, the name staff gave it, its kind and where it stands. Null for
 * no choice. A provider that is gone, or is not an OIDC one, keeps its id and has neither name nor kind. No endpoint, no client, no secret.
 */
export type EventSsoProviderDto = {
  id: string;
  state: Exclude<GuestSsoProviderState, "not_selected">;
  display_name: string | null;
  kind: SsoProviderKind | null;
};

export async function loadEventSsoProvider(db: ProviderDb, providerId: string | null): Promise<EventSsoProviderDto | null> {
  if (providerId === null) return null;
  const provider = await findOidcProviderById(db, providerId);
  if (!provider) return { id: providerId, state: "missing", display_name: null, kind: null };
  return { id: providerId, state: provider.enabled ? "ready" : "disabled", display_name: provider.display_name, kind: ssoProviderKind(provider.issuer) };
}

export type SsoProviderKind = "entra" | "google" | "generic";

/** The kind of a provider, told from its issuer: the screen shows an icon for it, and the issuer itself is never sent. */
export function ssoProviderKind(issuer: string): SsoProviderKind {
  let host = "";
  try {
    host = new URL(issuer).hostname.toLowerCase();
  } catch {
    return "generic";
  }
  if (host === "login.microsoftonline.com" || host === "sts.windows.net" || host === "login.windows.net") return "entra";
  return host === "accounts.google.com" ? "google" : "generic";
}

export type SelectableSsoProvider = { id: string; display_name: string; kind: SsoProviderKind };

/** What can be chosen: the enabled OIDC providers, by id, the name staff gave them and their kind. */
export async function listSelectableSsoProviders(db: ProviderDb): Promise<SelectableSsoProvider[]> {
  const providers = await findEnabledOidcProviders(db);
  return providers.map((provider) => ({ id: provider.id, display_name: provider.display_name, kind: ssoProviderKind(provider.issuer) }));
}
