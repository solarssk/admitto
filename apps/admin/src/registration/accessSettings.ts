import type { RegistrationMode } from "@admitto/db/status";
import type { LegalDocumentDto, RegistrationReadinessCheckDto, RegistrationSettingsDto, SaveRegistrationSettingsBody } from "../api/types.js";
import type { SearchableSelectOption } from "../components/SearchableSelect.js";

/** The ways in this screen offers. The company sign-in is not one of them yet. */
export type AccessMethod = "link" | "password";

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
}

/** The way in an event has chosen, when it is exactly one that this screen offers. Any other state is no choice, as it is to the server. */
export function chosenMethod(methods: readonly string[]): AccessMethod | null {
  const only = methods.length === 1 ? methods[0] : undefined;
  return only === "link" || only === "password" ? only : null;
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
  };
}

/** Whether two lists name the same consents. Their order means nothing: the form lists the consents in the order of the texts. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  const members = new Set(a);
  return members.size === new Set(b).size && b.every((key) => members.has(key));
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
  return patch;
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
