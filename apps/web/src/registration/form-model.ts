/**
 * What the public registration page (`GET /r/:slug`) needs to know, and the rules that decide whether
 * it may be shown at all.
 *
 * The page has three outcomes. Almost every reason not to show the form is the same one: `not_found`,
 * answered with the one 404 of the registration routes, so a stranger cannot tell an unknown slug from
 * an event that has registration off, is archived, offers another way in, or is not ready. The
 * exception is an event that is over: its form says "Registration is closed".
 *
 * Checks run from the cheapest, and the ones that can only fail for an event that does not exist or has
 * no registration come first, so a guess at a slug costs one lookup of the event.
 */
import type { PrismaClient } from "@admitto/db";
import { resolveEventContactVars } from "@admitto/mail-templates";
import { eventCustomFieldRulesMaxLength, eventEndsAtUtc, type EventCustomFieldRules } from "@admitto/shared";
import {
  formatDate,
  formatEventHoursRange,
  loadRegistrantFormFields,
  parseTicketAddressComponents,
  pickRegistrantFormFields,
  resolveTicketLogoUrl,
  type RegistrantFormField,
} from "@admitto/tickets";
import { legalDocumentPath } from "../legal/legal-documents.js";
import { loadRequiredLegalDocuments, type RequiredLegalDocuments } from "../legal/registration-gate.js";
import { resolveAccessMethodAvailability } from "./access-methods.js";
import { canDrawQuestion, type FormQuestionType } from "./form-fields.js";
import { resolveTurnstileKeys } from "./turnstile-settings.js";

/** An event slug as the create-event form allows it (lowercase letters, digits, `_` and `-`, up to 80).
 * Anything else cannot be an event of this system, and is not a value for the widget's `data-cdata`. */
const EVENT_SLUG = /^[a-z0-9_-]{1,80}$/;

/** A question of the organiser that the page draws. */
export interface FormQuestion {
  /** The `source_field`: the key of the answer in `custom_data`. */
  key: string;
  label: string;
  /** The organiser's note under the question. */
  description: string | null;
  required: boolean;
  type: FormQuestionType;
  /** The choices of a `select`; empty for the other types. */
  options: readonly string[];
  /** The format rules of a `text`, `long_text` or `phone` question (null for the others, which take
   * none, and for a question without any). The page shows them as hints only: the server decides. */
  rules: EventCustomFieldRules | null;
}

/** An extra consent the event asks for: its own checkbox, labelled with its title. */
export interface FormConsent {
  key: string;
  title: string;
  path: string;
}

export interface FormContact {
  name: string;
  email: string;
}

/** The event as the page shows it. Every string is organiser text and is escaped where it is printed. */
export interface FormEvent {
  slug: string;
  title: string;
  /** The date, with the hours when the event has them. */
  when: string;
  /** The venue's name, else its address. */
  venue: string | null;
  /** The event's logo, else the organisation's. */
  logoUrl: string | null;
  /** The IANA time zone the event's clock times are in (UTC when none is saved): a guest's date and
   * time answer is read in it. */
  timezone: string;
}

export interface RegistrationFormModel {
  event: FormEvent;
  mode: "approval" | "automatic";
  /** Whether a guest confirms the address by a link first (D-C5). */
  verifyEmail: boolean;
  askCompany: boolean;
  askDepartment: boolean;
  questions: FormQuestion[];
  privacyPath: string;
  termsPath: string;
  consents: FormConsent[];
  contact: FormContact | null;
  /** The public Turnstile key; the page has no widget without one, and then it is not served. */
  turnstileSiteKey: string;
}

export interface ClosedFormModel {
  event: FormEvent;
  contact: FormContact | null;
}

export type RegistrationPageState =
  | { kind: "not_found" }
  | { kind: "closed"; page: ClosedFormModel }
  | { kind: "open"; form: RegistrationFormModel };

const NOT_FOUND: RegistrationPageState = { kind: "not_found" };

const EVENT_SELECT = {
  id: true,
  slug: true,
  title: true,
  date: true,
  timezone: true,
  event_hours_start: true,
  event_hours_end: true,
  archived_at: true,
  logo_url: true,
  header_image_url: true,
  organization: { select: { logo_url: true, header_image_url: true } },
  location_details: { select: { venue_name: true, formatted_address: true, address_components: true } },
  registration_settings: {
    select: { mode: true, access_methods: true, verify_email: true, ask_company: true, ask_department: true, consent_keys: true },
  },
} as const;

type EventRow = NonNullable<Awaited<ReturnType<typeof findEvent>>>;
type SettingsRow = NonNullable<EventRow["registration_settings"]>;

function findEvent(db: PrismaClient, slug: string) {
  return db.event.findUnique({ where: { slug }, select: EVENT_SELECT });
}

function whenOf(row: EventRow): string {
  const country = parseTicketAddressComponents(row.location_details?.address_components)?.country;
  const date = formatDate(row.date, country);
  const hours = formatEventHoursRange(row.event_hours_start, row.event_hours_end, country, row.timezone || "UTC", row.date);
  if (!hours) return date;
  const zone = hours.tzAbbr ? " " + hours.tzAbbr : "";
  return `${date}, ${hours.hours}${zone}`;
}

function toFormEvent(row: EventRow): FormEvent {
  const location = row.location_details;
  return {
    slug: row.slug,
    title: row.title,
    when: whenOf(row),
    venue: location?.venue_name?.trim() || location?.formatted_address?.trim() || null,
    logoUrl: resolveTicketLogoUrl(row),
    timezone: row.timezone || "UTC",
  };
}

async function loadContact(db: PrismaClient, eventId: string): Promise<FormContact | null> {
  const vars = await resolveEventContactVars(eventId, db);
  return vars.contact_email ? { name: vars.contact_name, email: vars.contact_email } : null;
}

/** The format rules the page shows for a question: only the types that take rules have any (the server
 * ignores a rule stored on another type, so the page must not announce it). */
function hintRules(type: FormQuestionType, field: RegistrantFormField): EventCustomFieldRules | null {
  return eventCustomFieldRulesMaxLength(type) === null ? null : (field.rules ?? null);
}

/** The questions to draw, or null when a required one cannot be drawn. A form nobody can submit is
 * worse than a closed one: a required question of a type the page does not know (a type that
 * `canDrawQuestion` refuses) or a choice with no choices fails every submission on the server. */
function drawQuestions(fields: readonly RegistrantFormField[]): FormQuestion[] | null {
  const questions: FormQuestion[] = [];
  for (const field of pickRegistrantFormFields(fields)) {
    const type = field.type ?? "text";
    const options = field.options ?? [];
    if (canDrawQuestion(type) && (type !== "select" || options.length > 0)) {
      questions.push({
        key: field.source_field,
        label: field.label,
        description: field.description ?? null,
        required: field.required === true,
        type,
        options: type === "select" ? options : [],
        rules: hintRules(type, field),
      });
    } else if (field.required) {
      return null;
    }
  }
  return questions;
}

function legalPaths(slug: string, legal: RequiredLegalDocuments): { privacy: string; terms: string; consents: FormConsent[] } | null {
  const privacy = legal.published.find((doc) => doc.kind === "privacy_notice");
  const terms = legal.published.find((doc) => doc.kind === "event_terms");
  if (!privacy || !terms || legal.missing.length > 0) return null;
  return {
    privacy: legalDocumentPath(slug, privacy),
    terms: legalDocumentPath(slug, terms),
    consents: legal.published
      .filter((doc) => doc.kind === "consent")
      .map((doc) => ({ key: doc.key, title: doc.title, path: legalDocumentPath(slug, doc) })),
  };
}

/** The form of an event that is not over, or `not_found` when something it needs is not in place. */
async function loadOpenForm(
  db: PrismaClient,
  row: EventRow,
  settings: SettingsRow,
  mode: RegistrationFormModel["mode"],
  event: FormEvent,
): Promise<RegistrationPageState> {
  const [availability, keys, legal, fields, contact] = await Promise.all([
    resolveAccessMethodAvailability(db),
    resolveTurnstileKeys(db),
    loadRequiredLegalDocuments(db, row.id, settings.consent_keys),
    loadRegistrantFormFields(db, row.id),
    loadContact(db, row.id),
  ]);
  const link = availability.find((method) => method.method === "link");
  const paths = legalPaths(row.slug, legal);
  const questions = drawQuestions(fields);
  if (!link?.available || keys.state !== "ready" || !paths || !questions) return NOT_FOUND;
  return {
    kind: "open",
    form: {
      event,
      mode,
      verifyEmail: settings.verify_email,
      askCompany: settings.ask_company,
      askDepartment: settings.ask_department,
      questions,
      privacyPath: paths.privacy,
      termsPath: paths.terms,
      consents: paths.consents,
      contact,
      turnstileSiteKey: keys.siteKey,
    },
  };
}

function registrationMode(settings: SettingsRow | null | undefined): RegistrationFormModel["mode"] | null {
  return settings?.mode === "approval" || settings?.mode === "automatic" ? settings.mode : null;
}

/**
 * The state of the registration page of the event named by `slug` at `now`.
 *
 * - Not an event, archived, registration off, or an access method other than the public link (the
 *   password and the company sign-in come with their own PRs): `not_found`.
 * - Over (see `eventEndsAtUtc`): `closed`, as long as it had registration on.
 * - Otherwise `open`, provided the link is available (the Turnstile keys are saved and the system
 *   administrator allowed it), every text the event's registration needs is published and every
 *   required question can be drawn; else `not_found`, as if registration were off.
 */
export async function loadRegistrationPage(db: PrismaClient, slug: string, now: Date): Promise<RegistrationPageState> {
  if (!EVENT_SLUG.test(slug)) return NOT_FOUND;
  const row = await findEvent(db, slug);
  const settings = row?.registration_settings;
  const mode = registrationMode(settings);
  // `access_methods` holds exactly one method in this release (D-C1); only the link is built here.
  if (!row || !settings || mode === null || row.archived_at !== null) return NOT_FOUND;
  if (settings.access_methods.length !== 1 || settings.access_methods[0] !== "link") return NOT_FOUND;

  const event = toFormEvent(row);
  const end = eventEndsAtUtc({
    date: row.date,
    eventHoursStart: row.event_hours_start,
    eventHoursEnd: row.event_hours_end,
    timezone: row.timezone,
  });
  if (now.getTime() >= end.getTime()) {
    return { kind: "closed", page: { event, contact: await loadContact(db, row.id) } };
  }
  return loadOpenForm(db, row, settings, mode, event);
}
