import type { RegistrationAccessMethod } from "@admitto/db/status";
import type {
  RegistrationAccessMethodsDto,
  RegistrationSsoProviderDto,
  RegistrationSsoProviderState,
  SaveRegistrationAccessMethodsBody,
  SaveRegistrationSsoProviderBody,
} from "../api/types.js";

/** The ways in the card has a switch for: all three the server lists. */
export const SWITCHED_ACCESS_METHODS = ["link", "password", "sso"] as const;

export type SwitchedAccessMethod = (typeof SWITCHED_ACCESS_METHODS)[number];

/** The ways in that need the Turnstile keys: the company sign-in does not, because its form stands behind the provider's sign-in. */
export const TURNSTILE_ACCESS_METHODS = ["link", "password"] as const;

/** What the card reads: the ways in of the instance, and the identity provider guests sign in with. */
export interface WaysIn {
  methods: RegistrationAccessMethodsDto;
  sso: RegistrationSsoProviderDto;
}

/**
 * The edit state of the Ways in card in External services: which of its switches are on, and the provider chosen for the company
 * sign-in (an id, or null for none). The id is kept as it is saved even when that provider is gone or off, so that leaving it
 * alone changes nothing.
 */
export type AccessMethodsDraft = Record<SwitchedAccessMethod, boolean> & { ssoProviderId: string | null };

function isEnabled(dto: RegistrationAccessMethodsDto, method: RegistrationAccessMethod): boolean {
  return dto.methods.some((entry) => entry.method === method && entry.enabled);
}

export function accessMethodsDraftFrom(ways: WaysIn): AccessMethodsDraft {
  return {
    link: isEnabled(ways.methods, "link"),
    password: isEnabled(ways.methods, "password"),
    sso: isEnabled(ways.methods, "sso"),
    ssoProviderId: ways.sso.provider_id,
  };
}

export function accessMethodsDirty(draft: AccessMethodsDraft, saved: AccessMethodsDraft): boolean {
  return SWITCHED_ACCESS_METHODS.some((method) => draft[method] !== saved[method]) || draft.ssoProviderId !== saved.ssoProviderId;
}

/** What to PUT to the list of ways in, or null when no switch changed. The server replaces the whole list of ways that are on. */
export function buildAccessMethodsSaveBody(draft: AccessMethodsDraft, saved: AccessMethodsDraft): SaveRegistrationAccessMethodsBody | null {
  if (SWITCHED_ACCESS_METHODS.every((method) => draft[method] === saved[method])) return null;
  return { methods: SWITCHED_ACCESS_METHODS.filter((method) => draft[method]) };
}

/** What to PUT to the provider choice, or null when it did not change. */
export function buildSsoProviderSaveBody(draft: AccessMethodsDraft, saved: AccessMethodsDraft): SaveRegistrationSsoProviderBody | null {
  return draft.ssoProviderId === saved.ssoProviderId ? null : { provider_id: draft.ssoProviderId };
}

/** What a save of the card got from the server, a part at a time: the answer of a request that worked, null for one that did not run or failed. */
export interface WaysInSaved {
  methods: RegistrationAccessMethodsDto | null;
  sso: RegistrationSsoProviderDto | null;
}

/**
 * The draft and the saved draft once a save is in: a part the server accepted becomes the saved one, and a part that failed stays
 * as the person left it (and still counts as a change), so that a failure of one request never puts the other one's answer on the
 * screen as if it had failed too.
 */
export function afterWaysInSave(
  draft: AccessMethodsDraft,
  saved: AccessMethodsDraft,
  got: WaysInSaved,
): { draft: AccessMethodsDraft; saved: AccessMethodsDraft } {
  const next = { draft: { ...draft }, saved: { ...saved } };
  if (got.methods) {
    for (const method of SWITCHED_ACCESS_METHODS) {
      const enabled = isEnabled(got.methods, method);
      next.draft[method] = enabled;
      next.saved[method] = enabled;
    }
  }
  if (got.sso) {
    next.draft.ssoProviderId = got.sso.provider_id;
    next.saved.ssoProviderId = got.sso.provider_id;
  }
  return next;
}

/** What the server now says about the card: the newest answer of each part. */
export function mergeWaysIn(current: WaysIn, got: WaysInSaved): WaysIn {
  return { methods: got.methods ?? current.methods, sso: got.sso ?? current.sso };
}

/** What the sentence under the provider says: how the choice stands, and what a form that uses the company sign-in does meanwhile. */
export interface SsoProviderNote {
  /** `warning` while guests cannot sign in, `info` otherwise. */
  tone: "warning" | "info";
  text: string;
}

const CLOSED = "Forms of events that use the company sign-in stay closed, and nothing is deleted.";

const NOTES: Readonly<Record<Exclude<RegistrationSsoProviderState, "ready">, string>> = {
  not_selected: `No identity provider is chosen yet. ${CLOSED}`,
  missing: `The identity provider that was chosen no longer exists. ${CLOSED}`,
  disabled: `The identity provider that was chosen is turned off. ${CLOSED}`,
};

/** The options of the picker: the providers that are turned on, by the name staff gave them. */
export function ssoProviderOptions(sso: RegistrationSsoProviderDto): Array<{ id: string; label: string }> {
  return sso.providers.map((provider) => ({ id: provider.id, label: provider.display_name }));
}

/**
 * The sentence about the choice. It says how the SAVED choice stands; while the picker holds another one the sentence is that the
 * change takes effect on Save, since the state of a choice that is not saved is not known to the server.
 */
export function ssoProviderNote(sso: RegistrationSsoProviderDto, draftProviderId: string | null): SsoProviderNote {
  if (draftProviderId !== sso.provider_id) return { tone: "info", text: "The change of provider takes effect when you save." };
  if (sso.state === "ready") {
    const name = sso.providers.find((provider) => provider.id === sso.provider_id)?.display_name ?? "the chosen provider";
    return { tone: "info", text: `Guests sign in with ${name}.` };
  }
  return { tone: "warning", text: NOTES[sso.state] };
}
