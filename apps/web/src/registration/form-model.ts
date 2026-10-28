/**
 * What the public registration page (`GET /r/:slug`) needs to know, and the rules that decide whether
 * it may be shown at all.
 *
 * The page has three outcomes. Almost every reason not to show the form is the same one: `not_found`,
 * answered with the one 404 of the registration routes, so a stranger cannot tell an unknown slug from
 * an event that has registration off, is archived, offers another way in, or is not ready. The
 * exception is an event that is over: its form says "Registration is closed".
 *
 * Two ways in are built: the public link and the shared password of the event (D-C1, D-C3). An event whose way in is the
 * password is open only while it has a password: without one it is as good as off, the same 404. The hash of the
 * password is read with the event for the submit route and stays out of the model of the page.
 *
 * Checks run from the cheapest, and the ones that can only fail for an event that does not exist or has
 * no registration come first, so a guess at a slug costs one lookup of the event.
 */
import type { PrismaClient } from "@admitto/db";
import { resolveEventContactVars } from "@admitto/mail-templates";
import {
  eventCustomFieldRulesMaxLength,
  eventEndsAtUtc,
  type EventCustomFieldRules,
  type GuestFormIcon,
  type ShowWhen,
} from "@admitto/shared";
import {
  allowedCompanions,
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
import { canBeMet, canDrawQuestion, controllersByKey, type FormQuestionType } from "./form-fields.js";
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
   * none, and for a question without any). The page shows them as hints only: the server decides. Only
   * the four format keys: the icon, the condition and the suggestions are the fields below. */
  rules: EventCustomFieldRules | null;
  /** The symbol drawn with the question (`rules.icon`), or null. */
  icon: GuestFormIcon | null;
  /** The condition under which the question is asked (`rules.show_when`): the answer to another question of the
   * form that shows it. Null: always asked. A question with one waits, hidden and not required, in the panel of the
   * question it names (see `renderQuestions`). */
  showWhen: ShowWhen | null;
  /** What the page offers while a guest types (`rules.suggestions`), for a `text` question only. They suggest and
   * nothing more: any text is sent as it was typed. */
  suggestions: readonly string[];
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

/** The part of the form for a guest's companion (D-E5): the choice "I am bringing a guest", the companion's name and the
 * event's questions about a companion. Only an event that takes companions has it. */
export interface CompanionSection {
  /** How many companions a guest may bring: `allowedCompanions(max_companions)`, 1 or more. The page asks for one. */
  max: number;
  /** The questions about the companion that are on the form (`applies_to = "companion"`, `show_on_form`), by the same rules as
   * the guest's own: their conditions refer to each other and never to a question about the guest. */
  questions: FormQuestion[];
}

export interface RegistrationFormModel {
  event: FormEvent;
  mode: "approval" | "automatic";
  /** Whether a guest confirms the address by a link first (D-C5). */
  verifyEmail: boolean;
  askCompany: boolean;
  askDepartment: boolean;
  questions: FormQuestion[];
  /** Null: the event takes no companion, and the page and the route behave as they did before companions existed. */
  companion: CompanionSection | null;
  privacyPath: string;
  termsPath: string;
  consents: FormConsent[];
  contact: FormContact | null;
  /** The public Turnstile key; the page has no widget without one, and then it is not served. */
  turnstileSiteKey: string;
  /** Whether the way in is the event's password: the page then asks for it first and keeps the form behind it. Only that:
   * the hash of the password is never part of what the page is built from. */
  needsPassword: boolean;
}

export interface ClosedFormModel {
  event: FormEvent;
  contact: FormContact | null;
}

export type RegistrationPageState =
  | { kind: "not_found" }
  | { kind: "closed"; page: ClosedFormModel }
  | { kind: "open"; form: RegistrationFormModel };

/** How a guest gets to the form (D-C1). An event whose way in is the password is open only while it has one, so a hash is
 * part of the type of that way and cannot be missing. */
export type GuestAccess = { method: "link" } | { method: "password"; passwordHash: string };

/** {@link RegistrationPageState} with what the submit route (`POST /r/:slug`) needs besides the form: the id of the
 * event, the questions as they are stored and the way in with the hash of the password. The submit route and the page
 * decide from the same read, so a form that is not shown cannot be submitted. */
export type ResolvedRegistration =
  | { kind: "not_found" }
  | { kind: "closed"; page: ClosedFormModel }
  | { kind: "open"; form: RegistrationFormModel; eventId: string; fields: readonly RegistrantFormField[]; access: GuestAccess };

const NOT_FOUND: ResolvedRegistration = { kind: "not_found" };

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
    select: {
      mode: true,
      access_methods: true,
      password_hash: true,
      verify_email: true,
      ask_company: true,
      ask_department: true,
      consent_keys: true,
      max_companions: true,
    },
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
 * ignores a rule stored on another type, so the page must not announce it), and only the four that shape an
 * answer. The icon, the condition and the suggestions are read into their own fields of the question. */
function hintRules(type: FormQuestionType, field: RegistrantFormField): EventCustomFieldRules | null {
  const rules = field.rules;
  if (!rules || eventCustomFieldRulesMaxLength(type) === null) return null;
  const hints: EventCustomFieldRules = {};
  if (rules.min_length !== undefined) hints.min_length = rules.min_length;
  if (rules.max_length !== undefined) hints.max_length = rules.max_length;
  if (rules.digits_only !== undefined) hints.digits_only = rules.digits_only;
  if (rules.example !== undefined) hints.example = rules.example;
  return Object.keys(hints).length > 0 ? hints : null;
}

/** The type the page draws a field as, or null when it cannot: a type it does not know (a row written by a later
 * version) or a choice with no choices, which nobody could answer. */
function drawableType(field: RegistrantFormField): FormQuestionType | null {
  const type = field.type ?? "text";
  const hasChoices = type !== "select" || (field.options ?? []).length > 0;
  return canDrawQuestion(type) && hasChoices ? type : null;
}

/** The question for a field the page can draw. The rules were read by `readStoredFieldRules` when the field was
 * loaded, so an unreadable rules object is already no rules: the question is asked always, with no icon. */
function toQuestion(field: RegistrantFormField, type: FormQuestionType): FormQuestion {
  const rules = field.rules;
  return {
    key: field.source_field,
    label: field.label,
    description: field.description ?? null,
    required: field.required === true,
    type,
    options: type === "select" ? (field.options ?? []) : [],
    rules: hintRules(type, field),
    icon: rules?.icon ?? null,
    showWhen: rules?.show_when ?? null,
    suggestions: type === "text" ? (rules?.suggestions ?? []) : [],
  };
}

/** The questions to draw for `appliesTo` (the guest's own, or the companion's), in the organiser's order, or null when a
 * required one cannot be drawn. A form nobody can submit is worse than a closed one: a required question of a type the page
 * does not know or a choice with no choices fails every submission on the server.
 *
 * A question with a condition (`rules.show_when`) is asked only when the question it names has that answer, so
 * the page can ask it only when that question is on the form, is a Yes/No or a choice, and is itself always
 * asked. The server guarantees that, and the page does not rely on it. A question with a condition that
 * nothing can meet (a question that is not there, or an answer it cannot have, such as an option that was
 * removed) is left out: it is never asked, so it is never required and never closes the form. A required
 * question the page cannot draw closes the form only when a guest could meet its condition and then be stuck.
 *
 * Exported for the readiness of an event (./readiness.ts), which must judge the questions as the page does. */
export function drawQuestions(fields: readonly RegistrantFormField[], appliesTo: "guest" | "companion" = "guest"): FormQuestion[] | null {
  const drawable: FormQuestion[] = [];
  const stuck: RegistrantFormField[] = [];
  for (const field of pickRegistrantFormFields(fields, appliesTo)) {
    const type = drawableType(field);
    if (type !== null) drawable.push(toQuestion(field, type));
    else if (field.required) stuck.push(field);
  }
  const controllers = controllersByKey(drawable);
  if (stuck.some((field) => canBeMet(field.rules?.show_when, controllers))) return null;
  return drawable.filter((question) => canBeMet(question.showWhen, controllers));
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

/**
 * The section for a companion, or null when the event offers none: it takes none (`max_companions` is 0), or a question
 * about the companion that is required cannot be drawn. The second is not a reason to close the form, as it is for the
 * guest's own questions: a guest can register without a companion, so the part that nobody could complete is left out
 * and the rest stays open. The route reads the same model, so a companion that the page does not offer is a body it refuses.
 */
function drawCompanion(fields: readonly RegistrantFormField[], maxCompanions: number): CompanionSection | null {
  const max = allowedCompanions(maxCompanions);
  if (max === 0) return null;
  const questions = drawQuestions(fields, "companion");
  return questions ? { max, questions } : null;
}

/** The way in the event offers: the one method of `access_methods` (one in this release, D-C1) when it is a way built
 * here, with what it needs. Null for any other, and for the password when the event has none: as good as off. */
function accessOf(settings: SettingsRow): GuestAccess | null {
  if (settings.access_methods.length !== 1) return null;
  const method = settings.access_methods[0];
  if (method === "link") return { method };
  return method === "password" && settings.password_hash ? { method, passwordHash: settings.password_hash } : null;
}

/** The form of an event that is not over, or `not_found` when something it needs is not in place. */
async function loadOpenForm(
  db: PrismaClient,
  row: EventRow,
  settings: SettingsRow,
  mode: RegistrationFormModel["mode"],
  event: FormEvent,
  access: GuestAccess,
): Promise<ResolvedRegistration> {
  const [availability, keys, legal, fields, contact] = await Promise.all([
    resolveAccessMethodAvailability(db),
    resolveTurnstileKeys(db),
    loadRequiredLegalDocuments(db, row.id, settings.consent_keys),
    loadRegistrantFormFields(db, row.id),
    loadContact(db, row.id),
  ]);
  const way = availability.find((entry) => entry.method === access.method);
  const paths = legalPaths(row.slug, legal);
  const questions = drawQuestions(fields, "guest");
  if (!way?.available || keys.state !== "ready" || !paths || !questions) return NOT_FOUND;
  return {
    kind: "open",
    eventId: row.id,
    fields,
    access,
    form: {
      event,
      mode,
      verifyEmail: settings.verify_email,
      askCompany: settings.ask_company,
      askDepartment: settings.ask_department,
      questions,
      companion: drawCompanion(fields, settings.max_companions),
      privacyPath: paths.privacy,
      termsPath: paths.terms,
      consents: paths.consents,
      contact,
      turnstileSiteKey: keys.siteKey,
      needsPassword: access.method === "password",
    },
  };
}

function registrationMode(settings: SettingsRow | null | undefined): RegistrationFormModel["mode"] | null {
  return settings?.mode === "approval" || settings?.mode === "automatic" ? settings.mode : null;
}

/** The event of `slug` when it has registration on and is not archived, with its settings; null for every other reason,
 * which the callers answer alike. The one rule of what a registration route may find (D-B1, D-B10), for the form and
 * for the confirmation of an address. */
async function findLiveEvent(
  db: PrismaClient,
  slug: string,
): Promise<{ row: EventRow; settings: SettingsRow; mode: RegistrationFormModel["mode"] } | null> {
  if (!EVENT_SLUG.test(slug)) return null;
  const row = await findEvent(db, slug);
  const settings = row?.registration_settings;
  const mode = registrationMode(settings);
  if (!row || !settings || mode === null || row.archived_at !== null) return null;
  return { row, settings, mode };
}

/** The columns of an event that say when it ends. */
export type EventEndColumns = Pick<EventRow, "date" | "event_hours_start" | "event_hours_end" | "timezone">;

/** Whether the event is over at `now` (D-B10): its form closes with it, and so does the confirmation of an address.
 * Exported for the readiness of an event (./readiness.ts): an event that is over cannot have its form opened. */
export function isOver(row: EventEndColumns, now: Date): boolean {
  const end = eventEndsAtUtc({
    date: row.date,
    eventHoursStart: row.event_hours_start,
    eventHoursEnd: row.event_hours_end,
    timezone: row.timezone,
  });
  return now.getTime() >= end.getTime();
}

/**
 * The state of the registration page of the event named by `slug` at `now`.
 *
 * - Not an event, archived, registration off, an access method other than the public link and the password (the
 *   company sign-in comes with its own PR), or the password with none set: `not_found`.
 * - Over (see `eventEndsAtUtc`): `closed`, as long as it had registration on.
 * - Otherwise `open`, provided the event's way in is available (the Turnstile keys are saved and the system
 *   administrator allowed it), every text the event's registration needs is published and every
 *   required question can be drawn; else `not_found`, as if registration were off.
 */
export async function resolveRegistration(db: PrismaClient, slug: string, now: Date): Promise<ResolvedRegistration> {
  const live = await findLiveEvent(db, slug);
  if (!live) return NOT_FOUND;
  const { row, settings, mode } = live;
  // `access_methods` holds exactly one method in this release (D-C1); the link and the password are built here. An event
  // whose way in is the password and that has none is as good as off, over or not.
  const access = accessOf(settings);
  if (!access) return NOT_FOUND;

  const event = toFormEvent(row);
  if (isOver(row, now)) return { kind: "closed", page: { event, contact: await loadContact(db, row.id) } };
  return loadOpenForm(db, row, settings, mode, event, access);
}

/** What the pages of the link that confirms an address (`/r/:slug/confirm/:token`) need to know about the event. */
export type ResolvedConfirmation =
  | { kind: "not_found" }
  | { kind: "closed"; page: ClosedFormModel }
  | { kind: "open"; eventId: string; event: FormEvent; contact: FormContact | null };

const NOT_FOUND_CONFIRMATION: ResolvedConfirmation = { kind: "not_found" };

/**
 * The event of a confirmation link at `now`. The guest holds a registration already, so the form's own conditions do not
 * apply: the way in may be switched off, the Turnstile keys cleared or a text unpublished since, and the link still
 * works. What closes it is what closes the registration itself (see `findLiveEvent`): an event that has registration off,
 * is archived or is unknown is `not_found` (the one 404), and an event that is over is `closed`. The service that confirms
 * (`confirmRegistrationAddress`) judges the same again under its locks.
 */
export async function resolveConfirmation(db: PrismaClient, slug: string, now: Date): Promise<ResolvedConfirmation> {
  const live = await findLiveEvent(db, slug);
  if (!live) return NOT_FOUND_CONFIRMATION;
  const event = toFormEvent(live.row);
  const contact = await loadContact(db, live.row.id);
  if (isOver(live.row, now)) return { kind: "closed", page: { event, contact } };
  return { kind: "open", eventId: live.row.id, event, contact };
}

/** {@link resolveRegistration}, as far as the page needs it. */
export async function loadRegistrationPage(db: PrismaClient, slug: string, now: Date): Promise<RegistrationPageState> {
  const state = await resolveRegistration(db, slug, now);
  return state.kind === "open" ? { kind: "open", form: state.form } : state;
}
