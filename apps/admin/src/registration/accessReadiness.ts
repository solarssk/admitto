import type { RegistrationReadinessKey } from "../api/types.js";

/** Where a missing check is put right when it is not on this tab: another tab of the page, or the settings of the event. */
export type ReadinessLink = "legal" | "fields" | "event_settings";

export interface ReadinessCopy {
  /** What the check is about: the heading of its row. */
  title: string;
  /** The sentence of a check that is met. */
  met: string;
  /** The sentence of a check that is not met. */
  missing: string;
  /** What to do about it, when the sentence of a missing check does not say it already (it does for a check that is put right on this tab). */
  remedy?: { text: string; link?: ReadinessLink };
}

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
    title: "Way in",
    met: "A way in is chosen.",
    missing: "Choose how guests get in: with a link or with a password.",
  },
  access_method_enabled: {
    title: "Way in allowed",
    met: "This way in is allowed on this instance.",
    missing: "This way in is not allowed on this instance.",
    remedy: ASK_FOR_THE_WAY_IN,
  },
  bot_protection: {
    title: "Bot protection",
    met: "Bot protection is set up.",
    missing: "Bot protection is not set up, so the form stays closed.",
    remedy: ASK_A_SUPERADMIN,
  },
  password: {
    title: "Event password",
    met: "A password is set.",
    missing: "Set the password that guests will enter.",
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
