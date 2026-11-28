import type { RegistrationMode } from "@admitto/db/status";
import {
  SSO_CLAIM_NAME_MAX,
  SSO_CLAIM_VALUE_MAX,
  SSO_CLAIM_VALUES_MAX,
  ssoClaimNameProblem,
  ssoClaimValueProblem,
  type SsoClaimNameProblem,
  type SsoClaimValueProblem,
} from "@admitto/shared";
import type { RegistrationReadinessCheckDto, RegistrationSettingsDto, SaveRegistrationSettingsBody } from "../api/types.js";

/** The ways in this screen offers. */
export type AccessMethod = "link" | "password" | "sso";

/**
 * What Event settings, Registration edits: the settings as a form holds them. The way in is one choice or none, and the person a guest may
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
  /** A new request keeps where it came from: the guest's time zone, the approximate place of the address and the address. */
  keep_origin: boolean;
  /** The bot check of the link and password forms of the event. Only a superadmin changes it. */
  bot_protection_enabled: boolean;
  /** The company SSO only: the claim a guest's token must hold, as typed. Empty for no restriction. */
  sso_claim_name: string;
  /** The values of that claim that may register, as typed: one on each line. Empty for no restriction. */
  sso_claim_values: string;
  /** The company SSO only: the id of the identity provider guests of the event sign in with, or null while none is chosen. */
  sso_provider_id: string | null;
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
    keep_origin: settings.keep_origin,
    bot_protection_enabled: settings.bot_protection_enabled,
    sso_claim_name: settings.sso_claim_name ?? "",
    sso_claim_values: settings.sso_claim_values.join("\n"),
    sso_provider_id: settings.sso_provider_id,
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

/** What the person reads for each thing the shared rules (`@admitto/shared`, ssoClaim.ts) can find wrong. */
const NAME_PROBLEMS: Record<SsoClaimNameProblem, string> = {
  too_long: `The name can have at most ${SSO_CLAIM_NAME_MAX} characters.`,
  bad_characters: "The name has letters, digits and signs only, with no spaces.",
};
const VALUE_PROBLEMS: Record<SsoClaimValueProblem, string> = {
  too_long: `A value can have at most ${SSO_CLAIM_VALUE_MAX} characters.`,
  control_character: "A value cannot hold a control character.",
};

function nameError(name: string, hasValues: boolean): string | undefined {
  if (name === "") return hasValues ? "Enter the name of the claim these values belong to." : undefined;
  const problem = ssoClaimNameProblem(name);
  return problem === null ? undefined : NAME_PROBLEMS[problem];
}

function valuesError(values: readonly string[], hasName: boolean): string | undefined {
  if (values.length === 0) return hasName ? "Enter at least one value, or clear the name." : undefined;
  if (values.length > SSO_CLAIM_VALUES_MAX) return `List at most ${SSO_CLAIM_VALUES_MAX} values.`;
  const problems = values.map((value) => ssoClaimValueProblem(value));
  const found = problems.includes("too_long") ? "too_long" : problems.find((problem) => problem !== null);
  return found === undefined || found === null ? undefined : VALUE_PROBLEMS[found];
}

/**
 * What is wrong with the restriction of the company SSO, as the server would refuse it: the name and the values go together
 * (both or neither), within the limits. Only the company SSO has a restriction, so any other way in has none to check.
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

/** Whether two lists name the same values. Their order means nothing. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  const members = new Set(a);
  return members.size === new Set(b).size && b.every((key) => members.has(key));
}

/**
 * The restriction of the company SSO, when it changed: the name and the values together, `null` and an empty list to take it away.
 * A way in other than the company SSO has no restriction: the server clears it when the way in changes, so none is sent then.
 * Turning registration off must always be possible, so a restriction that is not complete is left out of that save.
 */
function claimPatch(draft: AccessDraft, base: AccessDraft): Pick<SaveRegistrationSettingsBody, "sso_claim_name" | "sso_claim_values"> {
  if (draft.method !== "sso" || !claimChanged(draft, base)) return {};
  if (draft.mode === null && base.mode !== null && Object.keys(claimErrors(draft)).length > 0) return {};
  const { name, values } = parseClaim(draft);
  return { sso_claim_name: name === "" ? null : name, sso_claim_values: values };
}

/**
 * The identity provider of the company SSO, when it changed. Only the company SSO has one: the server clears it when the way in
 * changes to another, so none is sent then.
 */
function providerPatch(draft: AccessDraft, base: AccessDraft): Pick<SaveRegistrationSettingsBody, "sso_provider_id"> {
  return draft.method === "sso" && draft.sso_provider_id !== base.sso_provider_id ? { sso_provider_id: draft.sso_provider_id } : {};
}

/**
 * What a save sends of the form: the settings that differ between the form and the settings it was made from (`base`), and no
 * others. A setting the person did not touch is not sent, so a save never writes back what somebody else changed in the meantime.
 * How guests open the form is a superadmin's (`technicalPatch`) and is never sent from here.
 */
export function settingsPatch(draft: AccessDraft, base: AccessDraft): SaveRegistrationSettingsBody {
  const patch: SaveRegistrationSettingsBody = {};
  if (draft.mode !== base.mode) patch.mode = draft.mode;
  if (draft.waitlist_enabled !== base.waitlist_enabled) patch.waitlist_enabled = draft.waitlist_enabled;
  if (draft.verify_email !== base.verify_email) patch.verify_email = draft.verify_email;
  if (draft.ask_company !== base.ask_company) patch.ask_company = draft.ask_company;
  if (draft.ask_department !== base.ask_department) patch.ask_department = draft.ask_department;
  if (draft.companion !== base.companion) patch.max_companions = draft.companion ? 1 : 0;
  if (draft.keep_origin !== base.keep_origin) patch.keep_origin = draft.keep_origin;
  return patch;
}

/**
 * What a superadmin's save adds: the access method, the bot check, the identity provider and the restriction, when they differ
 * from the settings the form was made from. Only a superadmin sends them (the server refuses others).
 */
export function technicalPatch(draft: AccessDraft, base: AccessDraft): SaveRegistrationSettingsBody {
  const patch: SaveRegistrationSettingsBody = {};
  if (draft.method !== base.method) patch.access_methods = draft.method === null ? [] : [draft.method];
  if (draft.bot_protection_enabled !== base.bot_protection_enabled) patch.bot_protection_enabled = draft.bot_protection_enabled;
  return { ...patch, ...claimPatch(draft, base), ...providerPatch(draft, base) };
}

/** What a save of a superadmin adds to the form: how guests open the form, with the identity provider and the restriction of Company SSO. */
export type Technical = Pick<AccessDraft, "method" | "bot_protection_enabled" | "sso_provider_id" | "sso_claim_name" | "sso_claim_values">;

export function technicalOf(draft: AccessDraft): Technical {
  return { method: draft.method, bot_protection_enabled: draft.bot_protection_enabled, sso_provider_id: draft.sso_provider_id, sso_claim_name: draft.sso_claim_name, sso_claim_values: draft.sso_claim_values };
}

/** The keys of the checks that are not met. */
export function missingChecks(readiness: readonly RegistrationReadinessCheckDto[]): string[] {
  return readiness.filter((check) => !check.ok).map((check) => check.key);
}
