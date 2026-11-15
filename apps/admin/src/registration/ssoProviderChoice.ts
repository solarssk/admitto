import type { EventSsoProviderDto, RegistrationSettingsDto } from "../api/types.js";
import type { SearchableSelectOption } from "../components/SearchableSelect.js";
import type { AccessDraft, AccessMethod } from "./accessSettings.js";
import { ssoProviderIcon } from "./ssoProviderKind.js";

type Providers = RegistrationSettingsDto["sso_providers"];

/** The words of the choice of the identity provider of an event. */
export const PROVIDER_HINT = "The provider guests sign in with. A superadmin sets providers up under Identity.";
export const PROVIDER_TURNED_OFF = " (turned off)";
const READY = "Guests sign in with their work account. Their email comes from that sign-in.";
const NOT_CHOSEN = "Choose an identity provider. Until you do, the form stays closed.";
const GONE = "The identity provider that was chosen no longer exists, so the form stays closed. Choose another one.";
const CHANGED = "Guests who are filling in the form will have to sign in again.";

/** Why Company SSO cannot be chosen while no identity provider is turned on: a superadmin is told where to add one, anybody else to ask. */
export const NO_PROVIDER_FOR_SUPERADMIN = "No identity provider is turned on. Add one under Identity.";
export const NO_PROVIDER_FOR_ORGANISER = "No identity provider is set up. Ask a superadmin to set up an identity provider.";

/** Why an event that is limited to one company has its provider shown and not offered. */
export const LOCKED_NOTE = "Only a superadmin can change the identity provider while the event is limited to one company.";

/** What choosing a method changes in the form: Company SSO with a single provider to use takes that provider, when none is chosen yet. */
export function methodEdit(method: AccessMethod, draft: Pick<AccessDraft, "sso_provider_id">, providers: Providers): Partial<AccessDraft> {
  const only = providers.length === 1 ? providers[0] : undefined;
  return method === "sso" && draft.sso_provider_id === null && only !== undefined ? { method, sso_provider_id: only.id } : { method };
}

/** Whether the provider of an event is only a superadmin's to change: a restriction to one company is saved for Company SSO. */
export function providerIsLocked(saved: Pick<RegistrationSettingsDto, "access_methods" | "sso_claim_name">, superadmin: boolean): boolean {
  return !superadmin && saved.access_methods.includes("sso") && saved.sso_claim_name !== null;
}

/**
 * The providers the picker lists: the ones that are turned on, by the name staff gave them, with the icon of their kind. The provider
 * the event has chosen stays in the list when it is turned off, marked, so that the choice reads as it is.
 */
export function providerOptions(providers: Providers, current: EventSsoProviderDto | null, chosenId: string | null): SearchableSelectOption[] {
  const options: SearchableSelectOption[] = providers.map((provider) => ({ id: provider.id, label: provider.display_name, icon: ssoProviderIcon(provider.kind) }));
  const off = current !== null && current.id === chosenId && current.state === "disabled" && current.display_name !== null;
  if (off && !options.some((option) => option.id === chosenId)) {
    options.push({ id: current.id, label: `${current.display_name}${PROVIDER_TURNED_OFF}`, icon: current.kind === null ? undefined : ssoProviderIcon(current.kind) });
  }
  return options;
}

export interface ProviderNotice {
  variant: "info" | "warning";
  text: string;
}

/** How the choice in the form stands: ready, not made, turned off or gone. A provider that is off or gone keeps the form closed. */
function standOf(providers: Providers, current: EventSsoProviderDto | null, chosenId: string | null): ProviderNotice {
  if (chosenId === null) return { variant: "warning", text: NOT_CHOSEN };
  if (providers.some((provider) => provider.id === chosenId)) return { variant: "info", text: READY };
  if (current !== null && current.id === chosenId && current.state === "disabled") {
    const name = current.display_name ?? "This provider";
    return { variant: "warning", text: `${name} is turned off, so the form stays closed. Choose another provider or ask a superadmin to turn it on.` };
  }
  return { variant: "warning", text: GONE };
}

/** The notice under the choice. A change of the provider of an event that already has one adds that guests who are signing in must do it again. */
export function providerNotice(args: {
  providers: Providers;
  current: EventSsoProviderDto | null;
  chosenId: string | null;
  saved: { method: AccessMethod | null; providerId: string | null };
}): ProviderNotice {
  const { providers, current, chosenId, saved } = args;
  const stand = standOf(providers, current, chosenId);
  const moves = saved.method === "sso" && saved.providerId !== null && chosenId !== null && chosenId !== saved.providerId;
  return moves ? { ...stand, text: `${stand.text} ${CHANGED}` } : stand;
}
