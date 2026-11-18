import type { RegistrationMode } from "@admitto/db/status";
import type { RegistrationOwnAddressDto, RegistrationReadinessKey } from "../api/types.js";
import { hasStopped } from "./ownAddress.js";

/** Where a missing check is put right when it is not on this tab: another tab of the page, or the settings of the event. */
export type ReadinessLink =
  | "legal"
  | "fields"
  | "event_settings"
  | "registration_settings"
  | "organisation_general"
  | "organisation_mail"
  | "organisation_external";

export interface ReadinessCopy {
  /** What the check is about: the heading of its row. */
  title: string;
  /** The sentence of a check that is met. */
  met: string;
  /** The sentence of a check that is not met. */
  missing: string;
  /** What to do about it, when the sentence of a missing check does not say it already (it does for a check that is put right on this tab). */
  remedy?: { text: string; link?: ReadinessLink };
  /** What a superadmin is told instead, when the check is put right in a place that only a superadmin can open. */
  superadminRemedy?: { text: string; link?: ReadinessLink };
  /** Only a superadmin can put it right: for everybody else the step waits for a superadmin (the checklist's "Waiting for a superadmin"). */
  superadminOnly?: boolean;
  /** The row is information, not a task: it is shown grey, with a dash instead of a tick, and is not counted in "x of y done". */
  info?: boolean;
}

/** How guests open the form is set in Event settings, Registration, by a superadmin: the others are told to ask, a superadmin is sent there. */
const ASK_TO_CHOOSE = { text: "Ask a superadmin to choose it in Event settings, Registration." } as const;
const CHOOSE_IN_SETTINGS = { text: "Choose it in Event settings, Registration.", link: "registration_settings" } as const;

const ASK_A_SUPERADMIN = { text: "Ask a superadmin to set it up." } as const;

/**
 * The words of every check the server reports (`READINESS_KEYS` in `apps/web/src/registration/readiness.ts`; a test holds the two
 * lists together). The server sends keys and never sentences, so a check that this table does not know yet still reads (see
 * `readinessCopy`). The register is the organiser's: no codes and no names of services.
 */
export const READINESS_COPY: Readonly<Record<RegistrationReadinessKey, ReadinessCopy>> = {
  access_method: {
    title: "Access method",
    met: "An access method is chosen.",
    missing: "No access method is chosen yet. Guests cannot open the form.",
    remedy: ASK_TO_CHOOSE,
    superadminRemedy: CHOOSE_IN_SETTINGS,
    superadminOnly: true,
  },
  bot_protection: {
    title: "Bot protection",
    met: "Bot protection is set up.",
    missing: "Bot protection is not set up, so the form stays closed.",
    remedy: ASK_A_SUPERADMIN,
    superadminRemedy: { text: "Set it up in Organisation settings, External services.", link: "organisation_external" },
    superadminOnly: true,
  },
  bot_protection_not_used: {
    title: "Bot protection",
    met: "Off. The link and password forms have no bot check.",
    missing: "Bot protection is off.",
    info: true,
  },
  identity_provider: {
    title: "Identity provider",
    met: "An identity provider is chosen and turned on.",
    missing: "Choose an identity provider for Company SSO. If the list is empty, ask a superadmin to set one up under Identity.",
    remedy: ASK_TO_CHOOSE,
    superadminRemedy: CHOOSE_IN_SETTINGS,
    superadminOnly: true,
  },
  password: {
    title: "Event password",
    met: "A password is set.",
    missing: "Set the password that guests will enter.",
    remedy: { text: "Ask a superadmin to set it in Event settings, Registration." },
    superadminRemedy: { text: "Set it in Event settings, Registration.", link: "registration_settings" },
    superadminOnly: true,
  },
  legal_documents: {
    title: "Legal texts",
    met: "The privacy notice, the terms and the consents you chose are published.",
    missing: "Publish the privacy notice, the terms and every consent you chose.",
    remedy: { text: "Open the Legal tab.", link: "legal" },
  },
  form_questions: {
    title: "Form questions",
    met: "Guests can answer every required question.",
    missing: "A required question cannot be shown on the form.",
    remedy: { text: "Open the Fields tab.", link: "fields" },
  },
  required_fields: {
    title: "Required questions",
    met: "Every required question is on the form.",
    missing: "A required question is not on the form, so guests could not answer it.",
    remedy: { text: "Open the Fields tab.", link: "fields" },
  },
  mail_provider: {
    title: "Email sending",
    met: "Email sending is set up for this event.",
    missing: "Email sending is not set up for this event, so guests would get no email.",
    remedy: ASK_A_SUPERADMIN,
    superadminRemedy: { text: "Set it up in Organisation settings, Mail.", link: "organisation_mail" },
    superadminOnly: true,
  },
  instance_url: {
    title: "Instance address",
    met: "The address of this instance is set.",
    missing: "The address of this instance is not set, so the links in emails would not work.",
    remedy: ASK_A_SUPERADMIN,
    superadminRemedy: { text: "Set it in Organisation settings, General.", link: "organisation_general" },
    superadminOnly: true,
  },
  event_not_archived: {
    title: "Event status",
    met: "The event is not archived.",
    missing: "The event is archived, so it cannot take registrations.",
    remedy: { text: "Ask a superadmin to restore it." },
    superadminOnly: true,
  },
  event_not_ended: {
    title: "Event dates",
    met: "The event has not ended.",
    missing: "The event has ended, so guests can no longer register.",
    remedy: { text: "Check the date and hours in Event settings.", link: "event_settings" },
  },
};

/** The sentence of the row "Access method" that tells what is set, in plain words, and nothing to press: only a superadmin changes it. */
export const ACCESS_METHOD_SET_BY = "Set by a superadmin in Event settings, Registration.";

export function accessMethodDetail(method: "link" | "password" | "sso" | null, provider: { display_name: string | null; state: string } | null): string {
  if (method === "link") return "Link. Anyone who has the link can ask to join.";
  if (method === "password") return "Password. Guests need the link and the event password to open the form.";
  if (method === "sso") {
    const name = provider?.display_name ?? null;
    if (name === null) return "Company SSO. No identity provider is chosen yet.";
    return `Company SSO. Guests sign in with ${name}${provider?.state === "disabled" ? " (turned off)" : ""}.`;
  }
  return READINESS_COPY.access_method.missing;
}

/**
 * The sentence of the information row about the bot check, which is off for the organisation or for this event: the organisation's
 * switch is told apart from the event's, so a reader knows who turned it off.
 */
export function botProtectionOffText(organisation: "required" | "not_used"): string {
  return organisation === "not_used"
    ? "Off for this organisation. The link and password forms have no bot check."
    : "Off for this event. The link and password forms of this event have no bot check.";
}

/** The sentence of the row "Form questions" when it is met: how many questions of the organiser are on the form (the ones the form always asks are not counted). */
export function formQuestionsText(count: number): string {
  if (count === 0) return "No question of yours is on the form. Guests give their name and email address, and what the switches on the Access tab add.";
  return count === 1 ? "1 question of yours is on the form." : `${count} questions of yours are on the form.`;
}

/** What to do about a missing check, for this person: a superadmin may have another place to go to. */
export function remedyFor(copy: ReadinessCopy, superadmin: boolean): ReadinessCopy["remedy"] {
  return superadmin ? (copy.superadminRemedy ?? copy.remedy) : copy.remedy;
}

/** What a check that this table does not know says: the server may be newer than the screen. */
const UNKNOWN_COPY: ReadinessCopy = {
  title: "Other",
  met: "This check is met.",
  missing: "Something else that registration needs is missing.",
};

/** The check the screen adds to the server's: the event's own address for guests, from the settings answer. Not in `READINESS_COPY`, which is the server's list. */
export const OWN_ADDRESS_KEY = "own_address";
const OWN_ADDRESS_COPY: ReadinessCopy = {
  title: "Address for guests",
  met: "The address of this event for guests works.",
  missing: "The address of this event for guests stopped working, so guests may not be able to open their links.",
  remedy: { text: "Ask a superadmin to check the address." },
  superadminRemedy: { text: "Check the address in Event settings, Registration.", link: "registration_settings" },
  superadminOnly: true,
};

const COPY_BY_KEY: ReadonlyMap<string, ReadinessCopy> = new Map([...Object.entries(READINESS_COPY), [OWN_ADDRESS_KEY, OWN_ADDRESS_COPY]]);

/** One row of the checklist: a check of the server, or the one the screen adds. */
export interface ChecklistCheck {
  key: string;
  ok: boolean;
}

/**
 * The checks of the checklist: the server's, and the event's own address for guests when a check once found it working (an address
 * that was never verified is not used for links, so it is not a step). It is open while the last check fails.
 */
export function checklistFromSettings(settings: { readiness: readonly ChecklistCheck[]; own_address: RegistrationOwnAddressDto | null }): ChecklistCheck[] {
  const address = settings.own_address;
  const extra = address?.verified ? [{ key: OWN_ADDRESS_KEY, ok: !hasStopped(address) }] : [];
  return [...settings.readiness, ...extra];
}

/** The label of the button that leads to where a step is put right. */
export function actionLabel(link: ReadinessLink): string {
  if (link === "legal") return "Open Legal";
  if (link === "fields") return "Open Fields";
  if (link === "organisation_general" || link === "organisation_mail" || link === "organisation_external") return "Open Organisation settings";
  return "Open Event settings";
}

/** The banner above the steps: what state registration is in, in one sentence. */
export interface ChecklistBanner {
  variant: "success" | "warning" | "info" | "error";
  text: string;
  /** The banner offers the Access tab, where registration is turned on. */
  goToAccess: boolean;
}

const steps = (count: number) => (count === 1 ? "1 step" : `${count} steps`);

/** The sentence for the state: archived, all done (on or off), something broke while on, or what is left and who does it. */
export function checklistBanner({
  mode,
  archived,
  forYou,
  waiting,
  addressStopped,
}: {
  mode: RegistrationMode | null;
  archived: boolean;
  forYou: number;
  waiting: number;
  addressStopped: boolean;
}): ChecklistBanner {
  if (archived) return { variant: "info", text: "This event is archived. Registration is closed and nothing here can be changed.", goToAccess: false };
  if (forYou + waiting === 0) {
    if (mode !== null) return { variant: "success", text: "Registration is on and every step is done.", goToAccess: false };
    return { variant: "success", text: "Ready. Registration can be turned on.", goToAccess: true };
  }
  if (mode !== null) {
    const what = addressStopped ? "the address of this event stopped working" : "something it needs is missing";
    return { variant: "error", text: `Registration is on, but ${what}. Guests may not be able to register.`, goToAccess: false };
  }
  if (forYou === 0) return { variant: "info", text: `${steps(waiting)} ${waiting === 1 ? "waits" : "wait"} for a superadmin. Your steps are done.`, goToAccess: false };
  if (waiting === 0) return { variant: "warning", text: `${steps(forYou)} ${forYou === 1 ? "is" : "are"} open. Registration can be turned on when ${forYou === 1 ? "it is" : "they are"} done.`, goToAccess: false };
  return { variant: "warning", text: `${forYou} for you, ${waiting} waiting for a superadmin. Registration can be turned on when all are done.`, goToAccess: false };
}

/** The words of a check, by the key the server sent. */
export function readinessCopy(key: string): ReadinessCopy {
  return COPY_BY_KEY.get(key) ?? UNKNOWN_COPY;
}

/** The steps of the checklist, by who does them. Information rows (bot protection that is off) and steps that are done go last. */
export interface ChecklistSections<T extends { key: string; ok: boolean }> {
  /** Open steps this person can put right. */
  forYou: T[];
  /** Open steps only a superadmin can put right, for somebody who is not one. Empty for a superadmin. */
  waiting: T[];
  /** Steps that are met, then the information rows. */
  done: T[];
  /** How many steps there are: information rows are not steps. */
  total: number;
}

/** The checks without the one about the event being archived: the page says so itself, and the checklist does not say it again. */
export function checklistChecks<T extends { key: string }>(checks: readonly T[]): T[] {
  return checks.filter((check) => check.key !== "event_not_archived");
}

/** Splits the checks by who does them. A superadmin does every open step, anybody else waits for a superadmin on some. */
export function splitChecklist<T extends { key: string; ok: boolean }>(checks: readonly T[], superadmin: boolean): ChecklistSections<T> {
  const shown = checklistChecks(checks);
  const tasks = shown.filter((check) => !readinessCopy(check.key).info);
  const open = tasks.filter((check) => !check.ok);
  const waits = (check: T) => !superadmin && readinessCopy(check.key).superadminOnly === true;
  return {
    forYou: open.filter((check) => !waits(check)),
    waiting: open.filter(waits),
    done: [...tasks.filter((check) => check.ok), ...shown.filter((check) => readinessCopy(check.key).info)],
    total: tasks.length,
  };
}

/** How many steps are open: the number on the tab. The same for everybody, whoever does the step. */
export function openStepCount(checks: readonly { key: string; ok: boolean }[]): number {
  return splitChecklist(checks, true).forYou.length;
}
