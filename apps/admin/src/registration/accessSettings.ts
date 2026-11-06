import type { RegistrationMode } from "@admitto/db/status";
import type { LegalDocumentDto, RegistrationReadinessCheckDto, RegistrationSettingsDto, SaveRegistrationSettingsBody } from "../api/types.js";
import type { SearchableSelectOption } from "../components/SearchableSelect.js";

/** The ways in this screen offers. */
export type AccessMethod = "link" | "password" | "sso";

/** The limits the server keeps to (`SSO_CLAIM_*` in `apps/web/src/registration/sso-claim.ts`): a test holds the two in step. */
export const SSO_CLAIM_NAME_MAX = 100;
export const SSO_CLAIM_VALUE_MAX = 128;
export const SSO_CLAIM_VALUES_MAX = 20;

/**
 * What the Access tab edits: the settings as a form holds them. The way in is one choice or none, and the person a guest may
 * bring is a yes or a no (the server counts them, and takes 0 or 1).
 */
export interface AccessDraft {
  mode: RegistrationMode | null;
  method: AccessMethod | null;
  waitlist_enabled: boolean;
  verify_email: boolean;
  ask_company: boolean;
  ask_department: boolean;
  companion: boolean;
  consent_keys: string[];
  styled_form_controls: boolean;
  /** The company sign-in only: the claim a guest's token must hold, as typed. Empty for no restriction. */
  sso_claim_name: string;
  /** The values of that claim that may register, as typed: one on each line. Empty for no restriction. */
  sso_claim_values: string;
}

/** The way in an event has chosen, when it is exactly one that this screen offers. Any other state is no choice, as it is to the server. */
export function chosenMethod(methods: readonly string[]): AccessMethod | null {
  const only = methods.length === 1 ? methods[0] : undefined;
  return only === "link" || only === "password" || only === "sso" ? only : null;
}

/** The form for settings as the server holds them. */
export function draftFromSettings(settings: RegistrationSettingsDto): AccessDraft {
  return {
    mode: settings.mode,
    method: chosenMethod(settings.access_methods),
    waitlist_enabled: settings.waitlist_enabled,
    verify_email: settings.verify_email,
    ask_company: settings.ask_company,
    ask_department: settings.ask_department,
    companion: settings.max_companions > 0,
    consent_keys: [...settings.consent_keys],
    styled_form_controls: settings.styled_form_controls,
    sso_claim_name: settings.sso_claim_name ?? "",
    sso_claim_values: settings.sso_claim_values.join("\n"),
  };
}

/** The restriction a form holds, read from what was typed: the name without its spaces, the values one to a line, none empty, none twice. */
export function parseClaim(draft: Pick<AccessDraft, "sso_claim_name" | "sso_claim_values">): { name: string; values: string[] } {
  const values = draft.sso_claim_values.split("\n").map((line) => line.trim());
  return { name: draft.sso_claim_name.trim(), values: [...new Set(values.filter((value) => value !== ""))] };
}

export interface ClaimErrors {
  name?: string;
  values?: string;
}

const CLAIM_NAME_PATTERN = /^[\x21-\x7e]+$/;
const CONTROL_CHARACTER = /\p{Cc}/u;

function nameError(name: string, hasValues: boolean): string | undefined {
  if (name === "") return hasValues ? "Enter the name of the claim these values belong to." : undefined;
  if (name.length > SSO_CLAIM_NAME_MAX) return `The name can have at most ${SSO_CLAIM_NAME_MAX} characters.`;
  return CLAIM_NAME_PATTERN.test(name) ? undefined : "The name has letters, digits and signs only, with no spaces.";
}

function valuesError(values: readonly string[], hasName: boolean): string | undefined {
  if (values.length === 0) return hasName ? "Enter at least one value, or clear the name." : undefined;
  if (values.length > SSO_CLAIM_VALUES_MAX) return `List at most ${SSO_CLAIM_VALUES_MAX} values.`;
  if (values.some((value) => value.length > SSO_CLAIM_VALUE_MAX)) return `A value can have at most ${SSO_CLAIM_VALUE_MAX} characters.`;
  return values.some((value) => CONTROL_CHARACTER.test(value)) ? "A value cannot hold a control character." : undefined;
}

/**
 * What is wrong with the restriction of the company sign-in, as the server would refuse it: the name and the values go together
 * (both or neither), within the limits. Only the company sign-in has a restriction, so any other way in has none to check.
 */
export function claimErrors(draft: AccessDraft): ClaimErrors {
  if (draft.method !== "sso") return {};
  const { name, values } = parseClaim(draft);
  const errors: ClaimErrors = {};
  const forName = nameError(name, values.length > 0);
  const forValues = valuesError(values, name !== "");
  if (forName) errors.name = forName;
  if (forValues) errors.values = forValues;
  return errors;
}

/** Whether a restriction differs from the one the form was made from: the values are the same when they are the same set. */
function claimChanged(draft: AccessDraft, base: AccessDraft): boolean {
  const now = parseClaim(draft);
  const before = parseClaim(base);
  return now.name !== before.name || !sameKeys(now.values, before.values);
}

/** Whether two lists name the same consents. Their order means nothing: the form lists the consents in the order of the texts. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  const members = new Set(a);
  return members.size === new Set(b).size && b.every((key) => members.has(key));
}

/**
 * The restriction of the company sign-in, when it changed: the name and the values together, `null` and an empty list to take it away.
 * A way in other than the company sign-in has no restriction: the server clears it when the way in changes, so none is sent then.
 */
function claimPatch(draft: AccessDraft, base: AccessDraft): Pick<SaveRegistrationSettingsBody, "sso_claim_name" | "sso_claim_values"> {
  if (draft.method !== "sso" || !claimChanged(draft, base)) return {};
  const { name, values } = parseClaim(draft);
  return { sso_claim_name: name === "" ? null : name, sso_claim_values: values };
}

/**
 * What a save sends: the settings that differ between the form and the settings it was made from (`base`), and no others. A
 * setting the person did not touch is not sent, so a save never writes back what somebody else changed in the meantime.
 */
export function settingsPatch(draft: AccessDraft, base: AccessDraft): SaveRegistrationSettingsBody {
  const patch: SaveRegistrationSettingsBody = {};
  if (draft.mode !== base.mode) patch.mode = draft.mode;
  if (draft.method !== base.method) patch.access_methods = draft.method === null ? [] : [draft.method];
  if (draft.waitlist_enabled !== base.waitlist_enabled) patch.waitlist_enabled = draft.waitlist_enabled;
  if (draft.verify_email !== base.verify_email) patch.verify_email = draft.verify_email;
  if (draft.ask_company !== base.ask_company) patch.ask_company = draft.ask_company;
  if (draft.ask_department !== base.ask_department) patch.ask_department = draft.ask_department;
  if (draft.companion !== base.companion) patch.max_companions = draft.companion ? 1 : 0;
  if (!sameKeys(draft.consent_keys, base.consent_keys)) patch.consent_keys = draft.consent_keys;
  if (draft.styled_form_controls !== base.styled_form_controls) patch.styled_form_controls = draft.styled_form_controls;
  return { ...patch, ...claimPatch(draft, base) };
}

/** The keys of the checks that are not met. */
export function missingChecks(readiness: readonly RegistrationReadinessCheckDto[]): string[] {
  return readiness.filter((check) => !check.ok).map((check) => check.key);
}

/** The label of a consent the event has chosen but has not published (any more): it stays in the list so that it can be taken off. */
const UNPUBLISHED_SUFFIX = " (not published)";

/**
 * The consents an organiser can choose from: the published extra consents of the event. A consent that is chosen and is not
 * published stays in the list, marked, because the form cannot be saved with it and the person must be able to take it off.
 */
export function consentOptions(items: readonly LegalDocumentDto[], chosen: readonly string[]): SearchableSelectOption[] {
  const consents = items.flatMap((item) => (item.kind === "consent" && item.key !== null ? [{ key: item.key, title: item.title, published: item.published }] : []));
  const options: SearchableSelectOption[] = consents.filter((consent) => consent.published).map((consent) => ({ id: consent.key, label: consent.title }));
  for (const key of chosen) {
    if (options.some((option) => option.id === key)) continue;
    const text = consents.find((consent) => consent.key === key);
    options.push({ id: key, label: `${text?.title ?? key}${UNPUBLISHED_SUFFIX}` });
  }
  return options;
}
