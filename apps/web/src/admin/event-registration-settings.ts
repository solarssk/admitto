/**
 * The registration settings of one event, as the organiser reads and saves them (PR 99a): the mode, the way in, the
 * switches of the form, the consents and whether a password is set. Reading them also says whether the event is ready to
 * have registration on (registration/readiness.ts), and saving them refuses to turn it on, or to change the way in or the
 * consents of an event that has it on, while it is not.
 *
 * What the answers hold: the settings, whether a password is set (a yes or a no: the hash is not read into this process
 * at all, so it cannot leave in an answer, a log line or an audit entry, and neither can its length), the address of the
 * form, the readiness checks (fixed keys) and the questions the guest will see. No guest and no secret.
 *
 * Saving is one transaction. It takes the locks of the event's questions and then of its texts, so that two saves cannot
 * interleave (each reads the settings, judges the change and writes), and neither a question nor a text can change between
 * the check and the commit (docs/dev/attendee-erasure.md, "Taking locks: one order"). It takes no seat and changes no
 * registration, so it takes neither the capacity lock nor the registration queue. Turning registration off is never
 * refused, and it never waits for a guest who is sending the form: that guest finds it closed once they hold their locks.
 */
import {
  Prisma,
  REGISTRATION_ACCESS_METHOD,
  REGISTRATION_MODE,
  type PrismaClient,
  type RegistrationAccessMethod,
  type RegistrationMode,
} from "@admitto/db";
import { loadRegistrantFormFields, writeAdminAuditLog, type RegistrantFormField, type StaffActor } from "@admitto/tickets";
import { lockAndLoadLegalGateRows, loadLegalGateRows, publishedConsentKeys } from "../legal/registration-gate.js";
import type { SelectableAccessMethod } from "../registration/access-methods.js";
import { isOver } from "../registration/form-model.js";
import {
  evaluateRegistrationReadiness,
  loadReadinessEnvironment,
  publicFieldsOf,
  readinessBlockers,
  type PublicFieldDto,
  type ReadinessEnvironment,
  type RegistrationReadinessCheck,
  type RegistrationReadinessKey,
} from "../registration/readiness.js";
import { acquireEventCustomFieldsLock } from "./event-custom-fields-routes.js";

type Client = PrismaClient | Prisma.TransactionClient;

/** The columns of the settings that a person chooses. The password hash is not one of them. */
export type SettingsValues = {
  /** `null`: registration is off. */
  mode: RegistrationMode | null;
  access_methods: RegistrationAccessMethod[];
  waitlist_enabled: boolean;
  verify_email: boolean;
  max_companions: number;
  ask_company: boolean;
  ask_department: boolean;
  consent_keys: string[];
};

/** What an event without a settings row has: registration off, and everything else as the columns default. A test keeps the
 * two together, so a guest's form and this answer cannot disagree about a new event. */
export function defaultSettings(): SettingsValues {
  return {
    mode: null,
    access_methods: [],
    waitlist_enabled: true,
    verify_email: true,
    max_companions: 0,
    ask_company: false,
    ask_department: false,
    consent_keys: [],
  };
}

export type RegistrationSettingsDto = SettingsValues & {
  /** Whether a password is stored for the event. Only that: never the hash, never its length. */
  password_set: boolean;
  /** The address guests use: the instance's address and `/r/<slug>`. Null while the instance has no address. */
  guest_url: string | null;
  readiness: RegistrationReadinessCheck[];
  /** The questions the form asks, in the order it asks them. */
  public_fields: PublicFieldDto[];
};

/** A change to the settings: only what is there is changed. */
export type RegistrationSettingsPatch = Partial<Omit<SettingsValues, "access_methods">> & {
  access_methods?: SelectableAccessMethod[];
};

/**
 * - `saved`: the settings are as the answer says (also when nothing changed: nothing is written then, and nothing audited);
 * - `not_found`: no such event;
 * - `archived`: the event is archived, and an archived event is read only;
 * - `consent_not_published`: a consent key is not one of the event's published extra consents;
 * - `not_ready`: the change needs the event to be ready, and these checks are not met.
 */
export type SettingsUpdate =
  | { kind: "saved"; settings: RegistrationSettingsDto }
  | { kind: "not_found" | "archived" | "consent_not_published" }
  | { kind: "not_ready"; blockers: RegistrationReadinessKey[] };

export interface SettingsOptions {
  /** The moment the end of the event is judged at; tests set it. The save reads the clock itself once it holds its locks. */
  now?: Date;
  /** The environment the mail provider and the address of the instance are read from. Default: the process's. */
  env?: NodeJS.ProcessEnv;
}

const EVENT_SELECT = {
  slug: true,
  title: true,
  organization_id: true,
  archived_at: true,
  date: true,
  event_hours_start: true,
  event_hours_end: true,
  timezone: true,
} as const satisfies Prisma.EventSelect;

/** Deliberately without `password_hash`: whether there is one is asked of the database apart (see `readStoredSettings`). */
const SETTINGS_SELECT = {
  mode: true,
  access_methods: true,
  waitlist_enabled: true,
  verify_email: true,
  max_companions: true,
  ask_company: true,
  ask_department: true,
  consent_keys: true,
} as const satisfies Prisma.EventRegistrationSettingsSelect;

type StoredRow = Prisma.EventRegistrationSettingsGetPayload<{ select: typeof SETTINGS_SELECT }>;

function valuesOf(row: StoredRow): SettingsValues {
  return {
    // The database refuses any other value (the CHECK constraints of the table); this keeps the type honest.
    mode: REGISTRATION_MODE.find((mode) => mode === row.mode) ?? null,
    access_methods: REGISTRATION_ACCESS_METHOD.filter((method) => row.access_methods.includes(method)),
    waitlist_enabled: row.waitlist_enabled,
    verify_email: row.verify_email,
    max_companions: row.max_companions,
    ask_company: row.ask_company,
    ask_department: row.ask_department,
    consent_keys: [...row.consent_keys],
  };
}

type StoredSettings = { values: SettingsValues; passwordSet: boolean };

async function readStoredSettings(db: Client, eventId: string): Promise<StoredSettings> {
  const row = await db.eventRegistrationSettings.findUnique({ where: { event_id: eventId }, select: SETTINGS_SELECT });
  // A count, not a read: the hash is never loaded.
  const withPassword = await db.eventRegistrationSettings.count({ where: { event_id: eventId, password_hash: { not: null } } });
  return { values: row ? valuesOf(row) : defaultSettings(), passwordSet: withPassword > 0 };
}

/** The settings with the patch laid over them. A list given twice is kept once. */
function mergeSettings(current: SettingsValues, patch: RegistrationSettingsPatch): SettingsValues {
  return {
    mode: patch.mode === undefined ? current.mode : patch.mode,
    access_methods: patch.access_methods ?? current.access_methods,
    waitlist_enabled: patch.waitlist_enabled ?? current.waitlist_enabled,
    verify_email: patch.verify_email ?? current.verify_email,
    max_companions: patch.max_companions ?? current.max_companions,
    ask_company: patch.ask_company ?? current.ask_company,
    ask_department: patch.ask_department ?? current.ask_department,
    consent_keys: patch.consent_keys === undefined ? current.consent_keys : [...new Set(patch.consent_keys)],
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => b.at(index) === item);
  return a === b;
}

/** The settings that differ, by name and new value, in the order of the columns. */
function changedValues(before: SettingsValues, after: SettingsValues): [string, unknown][] {
  const earlier = new Map<string, unknown>(Object.entries(before));
  return Object.entries(after).filter(([name, value]) => !sameValue(earlier.get(name), value));
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const members = new Set(a);
  return members.size === new Set(b).size && b.every((item) => members.has(item));
}

/**
 * Whether a save has to find the event ready: when it turns registration on, and when it changes the way in or the
 * consents of an event that has it on. Turning registration off is never judged, and neither is a switch that does not
 * touch what the form needs (the waiting list, the check of the address, the companion, the company and department).
 */
function needsReadiness(before: SettingsValues, after: SettingsValues): boolean {
  if (after.mode === null) return false;
  if (before.mode === null) return true;
  return !sameMembers(before.access_methods, after.access_methods) || !sameMembers(before.consent_keys, after.consent_keys);
}

/** A password that waits for the way in must not come back by itself: it is cleared with the move away from it. */
function leavesPassword(before: SettingsValues, after: SettingsValues): boolean {
  return before.access_methods.includes("password") && !after.access_methods.includes("password");
}

type EventForSave = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

/**
 * The entry of the central audit log: the event, the names of what changed with the new values of the switches and the
 * mode (`off` when registration was turned off), the consent keys and the ways in, and whether the move away from the
 * password cleared it. A password, a hash and an address are none of it.
 */
async function writeSettingsAudit(
  tx: Prisma.TransactionClient,
  { eventId, event, actor, changed, passwordCleared }: {
    eventId: string;
    event: EventForSave;
    actor: StaffActor;
    changed: [string, unknown][];
    passwordCleared: boolean;
  },
): Promise<void> {
  await writeAdminAuditLog(tx, {
    organizationId: event.organization_id,
    actorUserId: actor.operator,
    sessionId: actor.sessionId,
    ip: actor.ip,
    timezone: actor.timezone,
    actionType: "registration_settings_changed",
    metadata: {
      event_id: eventId,
      event_title: event.title,
      fields_changed: changed.map(([name]) => name),
      ...Object.fromEntries(changed.map(([name, value]) => [name, name === "mode" ? (value ?? "off") : value])),
      ...(passwordCleared ? { password_cleared: true } : {}),
    },
  });
}

function toDto(args: {
  values: SettingsValues;
  passwordSet: boolean;
  slug: string;
  environment: ReadinessEnvironment;
  checks: RegistrationReadinessCheck[];
  fields: readonly RegistrantFormField[];
}): RegistrationSettingsDto {
  const { values, passwordSet, slug, environment, checks, fields } = args;
  return {
    ...values,
    password_set: passwordSet,
    guest_url: environment.instanceBaseUrl === null ? null : `${environment.instanceBaseUrl}/r/${slug}`,
    readiness: checks,
    public_fields: publicFieldsOf(fields),
  };
}

/** The settings of an event with their readiness, or null when there is no such event. Reads only, takes no lock. */
export async function getEventRegistrationSettings(
  db: PrismaClient,
  eventId: string,
  options: SettingsOptions = {},
): Promise<RegistrationSettingsDto | null> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: EVENT_SELECT });
  if (!event) return null;
  const now = options.now ?? new Date();
  const [environment, stored, legalRows, fields] = await Promise.all([
    loadReadinessEnvironment(db, eventId, options.env),
    readStoredSettings(db, eventId),
    loadLegalGateRows(db, eventId),
    loadRegistrantFormFields(db, eventId),
  ]);
  const checks = evaluateRegistrationReadiness({
    settings: { ...stored.values, password_set: stored.passwordSet },
    environment,
    event: { archived: event.archived_at !== null, ended: isOver(event, now), legalRows, fields },
  });
  return toDto({ values: stored.values, passwordSet: stored.passwordSet, slug: event.slug, environment, checks, fields });
}

type SaveRequest = {
  eventId: string;
  patch: RegistrationSettingsPatch;
  actor: StaffActor;
  environment: ReadinessEnvironment;
  now: Date | undefined;
};

async function saveSettings(tx: Prisma.TransactionClient, request: SaveRequest): Promise<SettingsUpdate> {
  const { eventId, patch, actor, environment } = request;
  // The locks first, in the one order: the event's questions, then its texts. A question that is saved meanwhile waits for
  // this transaction and finds the mode it leaves, and a text that is withdrawn meanwhile finds the consents it keeps.
  await acquireEventCustomFieldsLock(tx, eventId);
  const legalRows = await lockAndLoadLegalGateRows(tx, eventId);
  const event = await tx.event.findUnique({ where: { id: eventId }, select: EVENT_SELECT });
  if (!event) return { kind: "not_found" };
  if (event.archived_at !== null) return { kind: "archived" };

  const stored = await readStoredSettings(tx, eventId);
  const after = mergeSettings(stored.values, patch);
  const published = publishedConsentKeys(legalRows);
  if (patch.consent_keys?.some((key) => !published.includes(key))) return { kind: "consent_not_published" };

  const fields = await loadRegistrantFormFields(tx, eventId);
  // The clock is read here, with the locks held, and not when the request came in.
  const checks = evaluateRegistrationReadiness({
    settings: { ...after, password_set: stored.passwordSet },
    environment,
    event: { archived: false, ended: isOver(event, request.now ?? new Date()), legalRows, fields },
  });
  const blockers = readinessBlockers(checks);
  if (blockers.length > 0 && needsReadiness(stored.values, after)) return { kind: "not_ready", blockers };

  const changed = changedValues(stored.values, after);
  const passwordCleared = stored.passwordSet && leavesPassword(stored.values, after);
  if (changed.length > 0) {
    const data = { ...after, ...(passwordCleared ? { password_hash: null } : {}) };
    await tx.eventRegistrationSettings.upsert({
      where: { event_id: eventId },
      create: { event_id: eventId, ...data },
      update: data,
    });
    await writeSettingsAudit(tx, { eventId, event, actor, changed, passwordCleared });
  }
  return {
    kind: "saved",
    settings: toDto({ values: after, passwordSet: stored.passwordSet && !passwordCleared, slug: event.slug, environment, checks, fields }),
  };
}

/**
 * Saves a change to the settings of an event. See the head of this file for what it takes and what it refuses; the
 * answer says which. The environment (the Turnstile keys, the ways in the system enabled, the mail provider, the address
 * of the instance) is read before the transaction, because none of it is the event's to lock and none of it can be read
 * with the transaction's own client; a change to it between the read and the commit shuts the form on the next request,
 * as the page judges all of it again on every request.
 */
export async function updateEventRegistrationSettings(
  db: PrismaClient,
  { eventId, patch, actor, ...options }: { eventId: string; patch: RegistrationSettingsPatch; actor: StaffActor } & SettingsOptions,
): Promise<SettingsUpdate> {
  const environment = await loadReadinessEnvironment(db, eventId, options.env);
  try {
    return await db.$transaction((tx) => saveSettings(tx, { eventId, patch, actor, environment, now: options.now }));
  } catch (err) {
    // The event was deleted after the transaction found it, and the settings row has no event to belong to.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return { kind: "not_found" };
    throw err;
  }
}
