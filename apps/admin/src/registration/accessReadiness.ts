import type { RegistrationReadinessKey } from "../api/types.js";

/** Where a missing check is put right when it is not on this tab: another tab of the page, or the settings of the event. */
export type ReadinessLink = "legal" | "fields" | "event_settings" | "registration_settings";

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
  /** The row is information, not a task: it is shown grey, with a dash instead of a tick, and is not counted in "x of y done". */
  info?: boolean;
}

/** How guests open the form is set in Event settings, Registration, by a superadmin: the others are told to ask, a superadmin is sent there. */
const ASK_TO_CHOOSE = { text: "Ask a superadmin to choose it in Event settings, Registration." } as const;
const CHOOSE_IN_SETTINGS = { text: "Choose it in Event settings, Registration.", link: "registration_settings" } as const;

const ASK_A_SUPERADMIN = { text: "Ask a superadmin to set it up." } as const;
/** The ways in of the whole instance are turned on by a superadmin, on a card of their own. */
const ASK_FOR_THE_WAY_IN = { text: "Ask a superadmin to turn it on in Organisation settings, External services, Ways in." } as const;

/**
 * The words of every check the server reports (`READINESS_KEYS` in `apps/web/src/registration/readiness.ts`; a test holds the two
 * lists together). The server sends keys and never sentences, so a check that this table does not know yet still reads (see
 * `readinessCopy`). The register is the organiser's: no codes and no names of services.
 */
export const READINESS_COPY: Readonly<Record<RegistrationReadinessKey, ReadinessCopy>> = {
  access_method: {
    title: "Access method",
    met: "An access method is chosen.",
    missing: "Choose an access method: link, password or Company SSO.",
    remedy: ASK_TO_CHOOSE,
    superadminRemedy: CHOOSE_IN_SETTINGS,
  },
  access_method_enabled: {
    title: "The chosen way is turned on",
    met: "This way is turned on for the organisation.",
    missing: "This way is not turned on for the organisation.",
    remedy: ASK_FOR_THE_WAY_IN,
  },
  bot_protection: {
    title: "Bot protection",
    met: "Bot protection is set up.",
    missing: "Bot protection is not set up, so the form stays closed.",
    remedy: ASK_A_SUPERADMIN,
  },
  bot_protection_not_used: {
    title: "Bot protection",
    met: "Off for this organisation. The link and password forms have no bot check.",
    missing: "Bot protection is off for this organisation.",
    info: true,
  },
  identity_provider: {
    title: "Identity provider",
    met: "An identity provider is chosen and turned on.",
    missing: "Choose an identity provider for Company SSO. If the list is empty, ask a superadmin to set one up under Identity.",
    remedy: ASK_TO_CHOOSE,
    superadminRemedy: CHOOSE_IN_SETTINGS,
  },
  password: {
    title: "Event password",
    met: "A password is set.",
    missing: "Set the password that guests will enter.",
    remedy: { text: "Ask a superadmin to set it in Event settings, Registration." },
    superadminRemedy: { text: "Set it in Event settings, Registration.", link: "registration_settings" },
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
  },
  instance_url: {
    title: "Instance address",
    met: "The address of this instance is set.",
    missing: "The address of this instance is not set, so the links in emails would not work.",
    remedy: ASK_A_SUPERADMIN,
  },
  event_not_archived: {
    title: "Event status",
    met: "The event is not archived.",
    missing: "The event is archived, so it cannot take registrations.",
    remedy: { text: "Ask a superadmin to restore it." },
  },
  event_not_ended: {
    title: "Event dates",
    met: "The event has not ended.",
    missing: "The event has ended, so guests can no longer register.",
    remedy: { text: "Check the date and hours in Event settings.", link: "event_settings" },
  },
};

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

const COPY_BY_KEY: ReadonlyMap<string, ReadinessCopy> = new Map(Object.entries(READINESS_COPY));

/** The words of a check, by the key the server sent. */
export function readinessCopy(key: string): ReadinessCopy {
  return COPY_BY_KEY.get(key) ?? UNKNOWN_COPY;
}
