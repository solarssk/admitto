import type { Context } from "hono";
import { CUSTOM_FIELD_APPLIES_TO, Prisma } from "@admitto/db";
import type { CustomFieldAppliesTo, PrismaClient } from "@admitto/db";
import { z } from "zod";
import {
  CUSTOM_FIELD_NOT_ANSWERED_KEY,
  EVENT_CUSTOM_FIELD_TYPES,
  planSuggestedFields,
  SUGGESTED_EVENT_FIELDS,
  type EventCustomFieldRules,
  type EventCustomFieldType,
  type SuggestedEventField,
} from "@admitto/shared";
import {
  MAX_CUSTOM_FIELDS_PER_EVENT,
  controlsOtherFields,
  eventCustomFieldOrderBy,
  eventCustomFieldRulesFitType,
  eventCustomFieldRulesSchema,
  findShowWhenProblem,
  hasNoRules,
  invalidateEventExports,
  isReservedCustomDataSourceField,
  lockOpenAttendeeJobs,
  stopOpenAttendeeJobs,
  STOPPED_BY_FIELD_DELETION,
  readStoredFieldRules,
  removeFieldAnswers,
  writeBulkActionLog,
  type ConditionField,
  type OpsAuditContext,
  type ShowWhenProblem,
} from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  countAttendeesByCustomFieldValue,
  requireEventId,
} from "./admin-helpers.js";
import { isRequiredFieldOffForm } from "../registration/field-on-form.js";

/** Thrown when the per-event cap is still exceeded on the transaction-scoped recheck (two
 * concurrent creates could otherwise both pass the earlier, non-transactional count check before
 * either insert committed - same failure shape already fixed for event image assets). Caught
 * below and mapped to the same 422 response. */
class FieldLimitReachedError extends Error {}

/** Thrown when a delete's in-use recheck (inside the lock) finds an item reference that appeared
 * after the initial check. Caught below and mapped to the same 409 response. */
class FieldInUseError extends Error {}

/** Thrown when a save would leave a field Required while the registration form does not ask it,
 * in an event that takes registrations. Mapped to 422 `required_field_not_on_form`. */
class RequiredFieldNotOnFormError extends Error {}

/** Thrown when a PATCH finds its field gone once it holds the lock (a delete committed after the
 * first read). Answered like any field the event does not have: 403. */
class FieldGoneError extends Error {}

/** Thrown when a save would leave a field with format rules that its type does not take (or a length
 * longer than the type can hold). Mapped to 422 `invalid_field_rules`. */
class InvalidFieldRulesError extends Error {}

/** Thrown when a save would break a condition between two fields of the event, or a delete would leave a field
 * whose condition depends on the deleted one (see findShowWhenProblem). Mapped to 422 or 409 by showWhenProblemResponse. */
class ShowWhenError extends Error {
  constructor(readonly problem: ShowWhenProblem) {
    super(problem);
  }
}

/** Thrown when a reorder lists other ids than the event's fields have now: one was added or
 * deleted since the client loaded the list, or never belonged to this event. Mapped to 409
 * `stale_write`: reload and try again. */
class FieldSetChangedError extends Error {}

/** Thrown when the suggested questions that would be added do not fit in what is left of the per-event cap: the action is all or
 * nothing, so none is created. Carries the room left and the room needed, in fields. Mapped to 422 `field_limit_reached`. */
class SuggestedFieldsLimitError extends Error {
  constructor(
    readonly free: number,
    readonly needed: number,
  ) {
    super("suggested questions do not fit in the field limit");
  }
}

/** Serializes the writes to one event's custom-field registry (create, update, delete, reorder)
 * against each other, and against event-items-api-routes.ts's content_fields validation - without
 * this, a concurrent "attach field X to an item" and "delete field X" could interleave so the
 * delete's in-use scan runs before the item's write commits, leaving content_fields pointing at a
 * source_field that no longer exists (same pattern as acquireEventImageAssetsLock in
 * event-image-assets-routes.ts). */
export async function acquireEventCustomFieldsLock(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  const lockKey = `event-custom-fields:${eventId}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

const slugField = z.string().trim().regex(/^[a-z0-9_]+$/, "invalid slug");

/** A single `select` option value - rejects the exact sentinel the Custom fields report uses for
 * its "not answered" bucket (reports-routes.ts), so an admin naming an option that literally
 * (never realistically, but not impossible) collides with it can't make a real answer and the
 * unanswered bucket share one key/color in that report. */
const optionValueField = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((value) => value !== CUSTOM_FIELD_NOT_ANSWERED_KEY, { message: "reserved option value" });

const fieldTypeSchema = z.enum(EVENT_CUSTOM_FIELD_TYPES);

/** Whose answer the question asks for: the guest's own, or the guest's companion's (`EventCustomField.applies_to`). */
const appliesToSchema = z.enum(CUSTOM_FIELD_APPLIES_TO);

const createFieldSchema = z
  .object({
    source_field: slugField.min(1).max(60),
    label: z.string().trim().min(1).max(60),
    description: z.string().trim().max(500).optional(),
    type: fieldTypeSchema.optional(),
    required: z.boolean().optional(),
    // Whether the registration form asks guests this question. Left out = off, as for every field
    // that existed before the form; the Registration page sends true for a field it creates.
    show_on_form: z.boolean().optional(),
    // Left out = the guest's own question, as every field that existed before the companion.
    applies_to: appliesToSchema.optional(),
    // Left out = not sensitive. A sensitive question keeps its answers out of the attendee and request pages, lists, filters, exports,
    // reports and the import preview (D-E6); the wallet pass, operator card, items and mail are covered by a later pull request.
    sensitive: z.boolean().optional(),
    options: z.array(optionValueField).max(20).optional(),
    // The rules of the field (see eventCustomFieldRulesSchema): a shape that is not one is a 400, rules the
    // type does not take are a 422 (eventCustomFieldRulesFitType), and a condition between fields that cannot
    // be kept (`show_when`) is a 422 or a 409 (findShowWhenProblem).
    rules: eventCustomFieldRulesSchema.nullable().optional(),
  })
  .strict()
  .refine((row) => row.type !== "select" || (row.options != null && row.options.length > 0), {
    message: "select type requires options",
  })
  .refine((row) => !isReservedCustomDataSourceField(row.source_field), {
    message: "reserved source_field",
  });

/** `source_field` is immutable after create (same precedent as EventItem.key) - renaming a live
 * JSON key across every attendee's custom_data and every item's content_fields references is
 * exactly the migration-shaped problem worth avoiding rather than half-solving. */
const patchFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    // null clears a previously set description; omitting the key leaves it untouched (same
    // omit-vs-null convention as options below).
    description: z.union([z.string().trim().max(500), z.null()]).optional(),
    type: fieldTypeSchema.optional(),
    required: z.boolean().optional(),
    show_on_form: z.boolean().optional(),
    // Changing whose answer a question asks for is judged like any other change to the conditions between fields: a question
    // that others wait for cannot move to the other recipient, and nor can one that waits for a question of the first.
    applies_to: appliesToSchema.optional(),
    // Left out = unchanged.
    sensitive: z.boolean().optional(),
    // null (not just omitted) is how the client asks to clear a previous select's options when
    // switching to text/boolean - omitting the key means "leave options untouched" for PATCH.
    options: z.union([z.array(optionValueField).max(20), z.null()]).optional(),
    // Same convention: null clears the rules (needed when the field becomes a type that takes none),
    // omitting the key leaves them untouched, an object replaces them.
    rules: eventCustomFieldRulesSchema.nullable().optional(),
  })
  .strict()
  .refine((row) => row.type !== "select" || (row.options != null && row.options.length > 0), {
    message: "select type requires options",
  });

/** `ids` are the event's field ids in the order they should appear, all of them and each once.
 * The cap is a bound on the work, not a rule: the exact-set check in the handler decides. */
const reorderFieldsSchema = z
  .object({ ids: z.array(z.string().min(1).max(128)).max(100) })
  .strict();

/** What "add the suggested questions" takes: nothing. The set is the server's own (SUGGESTED_EVENT_FIELDS), so a body that names
 * anything is refused instead of being read as a question of the client's. */
const suggestedFieldsBodySchema = z.object({}).strict();

/** Admin API shape for a single event custom field. */
export type EventCustomFieldDto = {
  id: string;
  source_field: string;
  label: string;
  description: string | null;
  type: EventCustomFieldType;
  required: boolean;
  show_on_form: boolean;
  /** Whose answer the question asks for: the guest's own, or the guest's companion's. */
  applies_to: CustomFieldAppliesTo;
  /** True for a sensitive question: its answers do not appear in the attendee and request pages, lists, filters, exports,
   * reports or the import preview (D-E6). The wallet pass, operator card, items and mail are not covered yet (117d). */
  sensitive: boolean;
  display_order: number | null;
  options: string[] | null;
  /** Format rules (text, long text and phone fields), and the icon, condition and suggestions of the
   * registration form; null = none. */
  rules: EventCustomFieldRules | null;
  created_at: string;
};

/** What POST /api/admin/events/:eventId/custom-fields/suggested answers: the keys of the questions it created, in the order it
 * created them, and the ones it left out. `exists`: the event has a field under that key, and it stays as it is. `condition`: the
 * question depends on a field of the event that cannot be what it depends on, so it was not added. */
export type AddSuggestedFieldsDto = {
  added: string[];
  skipped: { source_field: string; reason: "exists" | "condition" }[];
};

type CustomFieldRow = {
  id: string;
  source_field: string;
  label: string;
  description: string | null;
  type: string;
  required: boolean;
  show_on_form: boolean;
  display_order: number | null;
  options: Prisma.JsonValue;
  rules: Prisma.JsonValue;
  /** Whose answer the question asks for (`guest` or `companion`). */
  applies_to: string;
  sensitive: boolean;
  created_at: Date;
};

/** The recipient of a stored `applies_to`; anything but `companion` reads as the guest's, as the checks of conditions read it. */
function recipientOf(appliesTo: string): CustomFieldAppliesTo {
  return appliesTo === "companion" ? "companion" : "guest";
}

function serializeCustomField(row: CustomFieldRow): EventCustomFieldDto {
  const options = Array.isArray(row.options)
    ? row.options.filter((o): o is string => typeof o === "string")
    : null;
  return {
    id: row.id,
    source_field: row.source_field,
    label: row.label,
    description: row.description,
    type: row.type as EventCustomFieldDto["type"],
    required: row.required,
    show_on_form: row.show_on_form,
    applies_to: recipientOf(row.applies_to),
    sensitive: row.sensitive,
    display_order: row.display_order,
    options: options && options.length > 0 ? options : null,
    rules: readStoredFieldRules(row.rules) ?? null,
    created_at: row.created_at.toISOString(),
  };
}

type FieldDb = PrismaClient | Prisma.TransactionClient;
type FormFlags = { required: boolean; show_on_form: boolean };

/** True when the event takes registrations through the public form: it has a registration mode.
 * Without one (no settings row, or a row with mode null) the form does not exist, and the field
 * API keeps behaving as it did before the form. */
async function eventAcceptsRegistrations(db: FieldDb, eventId: string): Promise<boolean> {
  const settings = await db.eventRegistrationSettings.findUnique({
    where: { event_id: eventId },
    select: { mode: true },
  });
  return settings?.mode != null;
}

/** Refuses to save a Required field that the registration form does not ask: a guest could never
 * answer it, and every later edit of that attendee would be refused for the missing value. Only
 * for an event that takes registrations, and only when the save itself changes `required` or
 * `show_on_form` (`previous` null = a new field): a field that already was in that state, e.g. one
 * the import made Required before the form existed, can still be renamed or retyped. The
 * readiness of the event, which the save of its registration settings asks before registration is
 * turned on, checks those (registration/readiness.ts, `required_fields`). */
async function assertRequiredFieldStaysOnForm(
  db: FieldDb,
  eventId: string,
  next: FormFlags,
  previous: FormFlags | null,
): Promise<void> {
  if (!isRequiredFieldOffForm(next)) return;
  if (previous?.required === next.required && previous.show_on_form === next.show_on_form) return;
  if (await eventAcceptsRegistrations(db, eventId)) throw new RequiredFieldNotOnFormError();
}

function requiredFieldNotOnFormResponse(c: Context): Response {
  return c.json({ error: "required_field_not_on_form" }, 422);
}

function invalidFieldRulesResponse(c: Context): Response {
  return c.json({ error: "invalid_field_rules" }, 422);
}

/** The answer to a save or a delete that a condition between fields refuses: 409 when other fields are shown by
 * the field being changed or deleted, 422 when the condition cannot be kept. */
function showWhenProblemResponse(c: Context, problem: ShowWhenProblem): Response {
  if (problem === "field_controls_others") return c.json({ error: "field_controls_others" }, 409);
  if (problem === "show_when_not_on_form") return c.json({ error: "show_when_not_on_form" }, 422);
  return c.json({ error: "invalid_show_when" }, 422);
}

/** The columns of a field row that the checks of conditions between fields read. */
const CONDITION_COLUMNS = { source_field: true, type: true, show_on_form: true, options: true, rules: true, applies_to: true } as const;

type ConditionRow = {
  source_field: string;
  type: string;
  show_on_form: boolean;
  options: Prisma.JsonValue;
  rules: Prisma.JsonValue;
  applies_to: string;
};

function toConditionField(row: ConditionRow): ConditionField {
  return {
    source_field: row.source_field,
    type: row.type,
    show_on_form: row.show_on_form,
    options: Array.isArray(row.options) ? row.options.filter((o): o is string => typeof o === "string") : null,
    rules: readStoredFieldRules(row.rules) ?? null,
    applies_to: recipientOf(row.applies_to),
  };
}

/** The event's fields as the checks of conditions read them. Read under the custom-fields lock, so no other
 * save changes them before this one commits. */
async function loadConditionFields(tx: Prisma.TransactionClient, eventId: string): Promise<ConditionField[]> {
  const rows = await tx.eventCustomField.findMany({ where: { event_id: eventId }, select: CONDITION_COLUMNS });
  return rows.map((row) => toConditionField(row));
}

/** Refuses a save that would break a condition between fields. `next` is the field as it will be saved. */
async function assertConditionsHold(tx: Prisma.TransactionClient, eventId: string, next: ConditionField): Promise<void> {
  const problem = findShowWhenProblem(next, await loadConditionFields(tx, eventId));
  if (problem) throw new ShowWhenError(problem);
}

/** A new field as the checks of conditions read it. */
function newConditionField(input: z.infer<typeof createFieldSchema>): ConditionField {
  return {
    source_field: input.source_field,
    type: input.type ?? "text",
    show_on_form: input.show_on_form ?? false,
    options: input.options ?? null,
    rules: input.rules ?? null,
    applies_to: input.applies_to ?? "guest",
  };
}

/** What goes in the `rules` column: the rules, or SQL NULL for none. Never a JSON null: the column's
 * CHECK refuses it, so "no rules" has one form. */
function rulesColumn(rules: EventCustomFieldRules | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return rules && !hasNoRules(rules) ? rules : Prisma.DbNull;
}

/** GET /api/admin/events/:eventId/custom-fields */
export async function handleListEventCustomFields(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const rows = await db.eventCustomField.findMany({
    where: { event_id: eventId },
    // The one order every reader of the registry uses (loadEventCustomDataFields, the exports and
    // the reports), so a reorder shows the same everywhere.
    orderBy: eventCustomFieldOrderBy(),
  });

  return c.json({ items: rows.map(serializeCustomField) });
}

/** The row a POST writes: the validated body with its defaults filled in. */
function newFieldData(
  eventId: string,
  input: z.infer<typeof createFieldSchema>,
): Prisma.EventCustomFieldUncheckedCreateInput & FormFlags {
  return {
    event_id: eventId,
    source_field: input.source_field,
    label: input.label,
    description: input.description ?? null,
    type: input.type ?? "text",
    required: input.required ?? false,
    show_on_form: input.show_on_form ?? false,
    applies_to: input.applies_to ?? "guest",
    sensitive: input.sensitive ?? false,
    options: input.options ?? Prisma.JsonNull,
    rules: rulesColumn(input.rules),
  };
}

function fieldLimitReachedResponse(c: Context): Response {
  return c.json({ error: "field_limit_reached", limit: MAX_CUSTOM_FIELDS_PER_EVENT }, 422);
}

/** The answer to a failed create when the failure is a known refusal; any other error is thrown
 * again. */
function createFieldFailure(c: Context, err: unknown): Response {
  if (err instanceof FieldLimitReachedError) return fieldLimitReachedResponse(c);
  if (err instanceof RequiredFieldNotOnFormError) return requiredFieldNotOnFormResponse(c);
  if (err instanceof ShowWhenError) return showWhenProblemResponse(c, err.problem);
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return c.json({ error: "source_field_conflict" }, 409);
  }
  throw err;
}

/** POST /api/admin/events/:eventId/custom-fields */
export async function handleCreateEventCustomField(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = createFieldSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }
  if (!eventCustomFieldRulesFitType(parsed.data.type ?? "text", parsed.data.rules)) {
    return invalidFieldRulesResponse(c);
  }

  const count = await db.eventCustomField.count({ where: { event_id: eventId } });
  if (count >= MAX_CUSTOM_FIELDS_PER_EVENT) {
    return fieldLimitReachedResponse(c);
  }

  const data = newFieldData(eventId, parsed.data);
  try {
    const created = await db.$transaction(async (tx) => {
      // A question created sensitive may meet answers that exist already (a plain question of the same key was deleted and
      // its answers stayed) and exports built with them: those files are not to be downloaded any more, as when an existing
      // field becomes sensitive. The jobs come first, in the one order of docs/dev/attendee-erasure.md ("Taking locks").
      if (parsed.data.sensitive === true) await lockOpenAttendeeJobs(tx, eventId);
      // Recheck the cap inside the transaction: the earlier count() above is a fast-path
      // rejection only and isn't race-safe on its own - two concurrent creates could both read a
      // count under the cap before either insert commits. The advisory lock serializes concurrent
      // transactions for the same event so the recount below is accurate (default Postgres
      // isolation is READ COMMITTED, not Serializable).
      await acquireEventCustomFieldsLock(tx, eventId);
      const recount = await tx.eventCustomField.count({ where: { event_id: eventId } });
      if (recount >= MAX_CUSTOM_FIELDS_PER_EVENT) {
        throw new FieldLimitReachedError();
      }
      await assertRequiredFieldStaysOnForm(tx, eventId, data, null);
      // A new field cannot be one that others depend on, so only its own condition is checked.
      if (parsed.data.rules?.show_when) await assertConditionsHold(tx, eventId, newConditionField(parsed.data));
      const row = await tx.eventCustomField.create({ data });
      if (parsed.data.sensitive === true) await invalidateEventExports(tx, eventId);
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_custom_field_created",
        audit: adminAuditFromContext(c),
        metadata: { source_field: row.source_field, ...(row.sensitive ? { sensitive: true } : {}) },
      });
      return row;
    });
    return c.json(serializeCustomField(created), 201);
  } catch (err) {
    return createFieldFailure(c, err);
  }
}

/** A suggested question as the ordinary create takes it (what POST /custom-fields is sent for a field added by hand): optional, and on
 * the form, as every suggested question is. The options and the rules are copied, so nothing done to a row can reach the shared set. */
function suggestedFieldInput(suggested: SuggestedEventField): z.infer<typeof createFieldSchema> {
  return {
    source_field: suggested.source_field,
    label: suggested.label,
    description: suggested.description,
    type: suggested.type,
    required: false,
    show_on_form: true,
    sensitive: suggested.sensitive === true ? true : undefined,
    options: suggested.options ? [...suggested.options] : undefined,
    rules: suggested.rules ? structuredClone(suggested.rules) : undefined,
  };
}

/** The answer to a request that carries a body where none is taken: 400 for anything but an empty body or `{}`, null otherwise. */
async function refuseBody(c: Context): Promise<Response | null> {
  const raw = await c.req.text();
  if (raw.trim() === "") return null;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  return suggestedFieldsBodySchema.safeParse(body).success ? null : c.json({ error: "validation_failed" }, 400);
}

/** 422 for suggested questions that do not fit in the cap: the code of a field that is added by hand at the cap, and how much room there
 * is and how much the questions need, so the caller can say how many fields to remove. */
function suggestedFieldsLimitResponse(c: Context, err: SuggestedFieldsLimitError): Response {
  return c.json({ error: "field_limit_reached", limit: MAX_CUSTOM_FIELDS_PER_EVENT, free: err.free, needed: err.needed }, 422);
}

const SENSITIVE_SUGGESTED_KEYS = SUGGESTED_EVENT_FIELDS.filter((suggested) => suggested.sensitive === true).map((suggested) => suggested.source_field);

type SuggestedPlan = ReturnType<typeof planSuggestedFields>;

/** One transaction of "add the suggested questions". Null when the plan adds a sensitive question and `lockJobs` was false, with nothing
 * written; with the jobs locked it is never null. */
function addSuggestedFields(c: Context, db: PrismaClient, eventId: string, lockJobs: true): Promise<SuggestedPlan>;
function addSuggestedFields(c: Context, db: PrismaClient, eventId: string, lockJobs: boolean): Promise<SuggestedPlan | null>;
function addSuggestedFields(c: Context, db: PrismaClient, eventId: string, lockJobs: boolean): Promise<SuggestedPlan | null> {
  return db.$transaction(async (tx) => {
    if (lockJobs) await lockOpenAttendeeJobs(tx, eventId);
    await acquireEventCustomFieldsLock(tx, eventId);
    // Read under the lock, so what the plan is made from is what the rows are written next to.
    const fields = await loadConditionFields(tx, eventId);
    const planned = planSuggestedFields(fields);
    if (planned.overLimitBy > 0) {
      throw new SuggestedFieldsLimitError(Math.max(0, MAX_CUSTOM_FIELDS_PER_EVENT - fields.length), planned.add.length);
    }
    const addsSensitive = planned.add.some((suggested) => suggested.sensitive === true);
    if (addsSensitive && !lockJobs) return null;
    for (const suggested of planned.add) {
      const row = await tx.eventCustomField.create({ data: newFieldData(eventId, suggestedFieldInput(suggested)) }); // NOSONAR - statements in one transaction run one at a time, in the order of the set
      await writeBulkActionLog(tx, { // NOSONAR - statements in one transaction run one at a time
        event_id: eventId,
        action_type: "event_custom_field_created",
        audit: adminAuditFromContext(c),
        metadata: { source_field: row.source_field },
      });
    }
    if (addsSensitive) await invalidateEventExports(tx, eventId);
    return planned;
  });
}

/** POST /api/admin/events/:eventId/custom-fields/suggested
 * Adds the suggested questions the event does not have yet (SUGGESTED_EVENT_FIELDS), each the way "Add field" adds one, in one
 * transaction under the custom-fields lock, so the cap is counted again there and no other write to the event's fields comes between.
 * An explicit action of the organiser and never part of creating an event. Idempotent by `source_field`: a key the event has stays
 * exactly as the organiser left it, and a question that depends on a field that cannot be what it depends on is left out. All or
 * nothing for the cap: when the questions to add do not fit, none is added (422 `field_limit_reached`, with `free` and `needed`).
 * They are created in the order of the set, so a question comes after the one it depends on. Takes no body. Answers 201 when it created
 * something and 200 when it created nothing, each time with the keys it added and the ones it left out (AddSuggestedFieldsDto). */
export async function handleAddSuggestedEventCustomFields(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const refused = await refuseBody(c);
  if (refused) return refused;

  try {
    // A question created sensitive meets exports and open jobs as the ordinary create does: the jobs are locked first and the
    // exports made unavailable after the write (docs/dev/attendee-erasure.md, "Taking locks"). What the batch creates is known only
    // under the custom-fields lock, which comes after the jobs in that order, so the jobs are locked up front when a sensitive
    // question is missing, and when the plan turns out to add one nobody locked for (it appeared meanwhile), the run is repeated
    // with the jobs locked first.
    const present = await db.eventCustomField.findMany({
      where: { event_id: eventId, source_field: { in: SENSITIVE_SUGGESTED_KEYS } },
      select: { source_field: true },
    });
    const plan = (await addSuggestedFields(c, db, eventId, present.length < SENSITIVE_SUGGESTED_KEYS.length)) ?? (await addSuggestedFields(c, db, eventId, true));
    const outcome: AddSuggestedFieldsDto = {
      added: plan.add.map((suggested) => suggested.source_field),
      skipped: [
        ...plan.present.map((suggested) => ({ source_field: suggested.source_field, reason: "exists" as const })),
        ...plan.blocked.map((suggested) => ({ source_field: suggested.source_field, reason: "condition" as const })),
      ],
    };
    return c.json(outcome, plan.add.length > 0 ? 201 : 200);
  } catch (err) {
    if (err instanceof SuggestedFieldsLimitError) return suggestedFieldsLimitResponse(c, err);
    return createFieldFailure(c, err);
  }
}

/** Load a custom field scoped to event; null when missing or cross-event (caller returns 403). */
async function loadCustomFieldInEvent(db: FieldDb, eventId: string, fieldId: string) {
  const row = await db.eventCustomField.findUnique({ where: { id: fieldId } });
  if (row?.event_id !== eventId) return null;
  return row;
}

/** What the patch changes on the row, key by key; a key the patch leaves out stays untouched. */
function fieldPatchData(patch: z.infer<typeof patchFieldSchema>): Prisma.EventCustomFieldUpdateInput {
  const data: Prisma.EventCustomFieldUpdateInput = {};
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.required !== undefined) data.required = patch.required;
  if (patch.show_on_form !== undefined) data.show_on_form = patch.show_on_form;
  if (patch.applies_to !== undefined) data.applies_to = patch.applies_to;
  if (patch.sensitive !== undefined) data.sensitive = patch.sensitive;
  if (patch.options !== undefined) data.options = patch.options ?? Prisma.JsonNull;
  if (patch.rules !== undefined) data.rules = rulesColumn(patch.rules);
  return data;
}

/** Refuses a save that would leave the field with rules its type does not take, judged on the type
 * and rules as they will be once `patch` is applied to `current`. A patch that names neither one
 * leaves them as they are. */
function assertRulesFitType(current: CustomFieldRow, patch: z.infer<typeof patchFieldSchema>): void {
  if (patch.type === undefined && patch.rules === undefined) return;
  const rules = patch.rules === undefined ? readStoredFieldRules(current.rules) : patch.rules;
  if (!eventCustomFieldRulesFitType(patch.type ?? current.type, rules)) throw new InvalidFieldRulesError();
}

/** True when a patch changes something that a condition between fields depends on. */
function patchTouchesConditions(patch: z.infer<typeof patchFieldSchema>): boolean {
  return (
    patch.type !== undefined ||
    patch.options !== undefined ||
    patch.rules !== undefined ||
    patch.show_on_form !== undefined ||
    patch.applies_to !== undefined
  );
}

/** The field as it will be once the patch is applied to `current`, as the checks of conditions read it. */
function patchedConditionField(current: CustomFieldRow, patch: z.infer<typeof patchFieldSchema>): ConditionField {
  const stored = toConditionField(current);
  return {
    ...stored,
    type: patch.type ?? stored.type,
    show_on_form: patch.show_on_form ?? stored.show_on_form,
    applies_to: patch.applies_to ?? stored.applies_to,
    options: patch.options === undefined ? stored.options : patch.options,
    rules: patch.rules === undefined ? stored.rules : patch.rules,
  };
}

/** The two flags as they will be once the patch is applied to `current`. */
function mergedFormFlags(current: FormFlags, patch: z.infer<typeof patchFieldSchema>): FormFlags {
  return {
    required: patch.required ?? current.required,
    show_on_form: patch.show_on_form ?? current.show_on_form,
  };
}

/** The answer to a failed PATCH when the failure is a known refusal; any other error is thrown
 * again. */
function patchFieldFailure(c: Context, err: unknown): Response {
  if (err instanceof RequiredFieldNotOnFormError) return requiredFieldNotOnFormResponse(c);
  if (err instanceof InvalidFieldRulesError) return invalidFieldRulesResponse(c);
  if (err instanceof ShowWhenError) return showWhenProblemResponse(c, err.problem);
  if (err instanceof FieldGoneError) return c.json({ error: "forbidden" }, 403);
  if (err instanceof FieldInUseError) return c.json({ error: "field_in_use" }, 409);
  throw err;
}

/** Whether an item of the event shows the question through `config.content_fields`. Read under the custom fields lock. */
async function itemsShowField(tx: Prisma.TransactionClient, eventId: string, sourceField: string): Promise<boolean> {
  const items = await tx.eventItem.findMany({ where: { event_id: eventId }, select: { config: true } });
  return items.some((item) => {
    const config = item.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) return false;
    const fields = (config as { content_fields?: unknown }).content_fields;
    return Array.isArray(fields) && fields.includes(sourceField);
  });
}

/** PATCH /api/admin/events/:eventId/custom-fields/:fieldId */
export async function handlePatchEventCustomField(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const fieldId = c.req.param("fieldId");
  if (!fieldId) return c.json({ error: "fieldId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadCustomFieldInEvent(db, eventId, fieldId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = patchFieldSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const data = fieldPatchData(parsed.data);
  if (Object.keys(data).length === 0) {
    return c.json(serializeCustomField(existing));
  }

  try {
    // A field that becomes sensitive has answers in files that were built while it was not: those files are not to be
    // downloaded any more, as after an erasure. Whenever the request asks for sensitive, the jobs come first, in the one order
    // of docs/dev/attendee-erasure.md ("Taking locks"), and whether the field changes is judged below on the row read under
    // the lock, never on the first read, which another save may have made stale.
    const updated = await db.$transaction(async (tx) => {
      if (parsed.data.sensitive === true) await lockOpenAttendeeJobs(tx, eventId);
      // Under the lock, and from a fresh read: the Required-on-form check below has to judge the
      // flags this update replaces, not those a save that committed a moment ago has changed
      // (two PATCHes that each flip one flag would otherwise both pass and leave both flipped).
      await acquireEventCustomFieldsLock(tx, eventId);
      const current = await loadCustomFieldInEvent(tx, eventId, fieldId);
      if (!current) throw new FieldGoneError();
      assertRulesFitType(current, parsed.data);
      // An item shows the answers of the guest (`content_fields` names questions about the guest): a question it shows is not moved to the companion.
      if (parsed.data.applies_to === "companion" && current.applies_to !== "companion" && (await itemsShowField(tx, eventId, current.source_field))) {
        throw new FieldInUseError();
      }
      // The operator's card shows no answer to a sensitive question (D-E6), and a new item cannot be given one. The question that an
      // item already shows is refused as well: the organiser takes it off the item first, as before deleting it.
      if (parsed.data.sensitive === true && !current.sensitive && (await itemsShowField(tx, eventId, current.source_field))) {
        throw new FieldInUseError();
      }
      if (patchTouchesConditions(parsed.data)) {
        await assertConditionsHold(tx, eventId, patchedConditionField(current, parsed.data));
      }
      await assertRequiredFieldStaysOnForm(tx, eventId, mergedFormFlags(current, parsed.data), current);
      const row = await tx.eventCustomField.update({ where: { id: fieldId }, data });
      if (parsed.data.sensitive === true && !current.sensitive) await invalidateEventExports(tx, eventId);
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_custom_field_updated",
        audit: adminAuditFromContext(c),
        // Whether a question is sensitive decides who can read its answers, so a change of it is on the record.
        metadata: { source_field: row.source_field, ...(parsed.data.sensitive === undefined ? {} : { sensitive: row.sensitive }) },
      });
      return row;
    });
    return c.json(serializeCustomField(updated));
  } catch (err) {
    return patchFieldFailure(c, err);
  }
}

/** Writes the positions 0, 1, 2... of `orderedIds` in one statement and returns how many rows it
 * changed: only a row whose position differs is touched. One statement instead of one update per
 * field, which would be a round trip each. */
async function writePositions(
  tx: Prisma.TransactionClient,
  eventId: string,
  orderedIds: readonly string[],
): Promise<number> {
  if (orderedIds.length === 0) return 0;
  const wanted = Prisma.join(orderedIds.map((id, position) => Prisma.sql`(${id}::text, ${position}::int)`));
  const changed = await tx.$executeRaw`
    UPDATE "EventCustomField" AS field
    SET "display_order" = wanted."position", "updated_at" = NOW()
    FROM (VALUES ${wanted}) AS wanted("id", "position")
    WHERE field."id" = wanted."id" AND field."event_id" = ${eventId}
      AND field."display_order" IS DISTINCT FROM wanted."position"
  `;
  return changed;
}

/** Gives the event's fields the positions 0, 1, 2... in the order of `ids`, and returns them in
 * that order. Writes the audit entry only when a position changed: asking for the order that
 * already is stored changes and records nothing. */
async function renumberCustomFields(
  tx: Prisma.TransactionClient,
  eventId: string,
  ids: readonly string[],
  audit: OpsAuditContext,
): Promise<CustomFieldRow[]> {
  const rows = await tx.eventCustomField.findMany({ where: { event_id: eventId } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: CustomFieldRow[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new FieldSetChangedError();
    ordered.push(row);
  }
  // Every listed id is a field of this event and none is listed twice, so equal sizes mean equal sets.
  if (ordered.length !== rows.length) throw new FieldSetChangedError();

  const moved = await writePositions(tx, eventId, ids);
  if (moved > 0) {
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "event_custom_fields_reordered",
      audit,
      metadata: { source_fields: ordered.map((row) => row.source_field) },
    });
  }
  return ordered.map((row, position) => ({ ...row, display_order: position }));
}

/** PUT /api/admin/events/:eventId/custom-fields/order - body `{ ids }`: the ids of all the event's
 * fields, in the order they should appear. One request, one transaction under the event's
 * custom-fields lock, so a reorder is never half applied and two at once leave the order of the
 * one that ran last. It also numbers fields that had no position yet (every field created since
 * the last reorder), so the result is always 0, 1, 2... with no gap and no repeat. A list that is
 * not exactly the fields the event has now answers 409 `stale_write`: the caller reloads. */
export async function handleReorderEventCustomFields(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = reorderFieldsSchema.safeParse(body);
  if (!parsed.success || new Set(parsed.data.ids).size !== parsed.data.ids.length) {
    return c.json({ error: "validation_failed" }, 400);
  }
  const { ids } = parsed.data;

  try {
    const items = await db.$transaction(async (tx) => {
      await acquireEventCustomFieldsLock(tx, eventId);
      return renumberCustomFields(tx, eventId, ids, adminAuditFromContext(c));
    });
    return c.json({ items: items.map(serializeCustomField) });
  } catch (err) {
    if (err instanceof FieldSetChangedError) return c.json({ error: "stale_write" }, 409);
    throw err;
  }
}

/** GET /api/admin/events/:eventId/custom-fields/:fieldId/option-usage — how many attendees
 * currently have each of a select field's option values, keyed by the option's own text (there's
 * no stable per-option id - a value's usage tracks its current text, same as the matching logic
 * in the attendee form). Fetched on demand by the edit-field modal, not folded into the list
 * response above, since that would run one raw-SQL aggregate per select field on every load of
 * the Requirements page for data an operator usually never opens. */
export async function handleGetEventCustomFieldOptionUsage(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const fieldId = c.req.param("fieldId");
  if (!fieldId) return c.json({ error: "fieldId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadCustomFieldInEvent(db, eventId, fieldId);
  if (!existing) return c.json({ error: "forbidden" }, 403);
  if (existing.type !== "select") {
    return c.json({ error: "not_a_select_field" }, 400);
  }
  // How many people gave each answer is the distribution of a sensitive question (D-E6): it is not told.
  if (existing.sensitive) return c.json({ counts: {}, hidden: true });

  const counts = await countAttendeesByCustomFieldValue(db, eventId, existing.source_field, existing.applies_to === "companion" ? "companion" : "guest");
  return c.json({ counts: Object.fromEntries(counts) });
}

/** DELETE /api/admin/events/:eventId/custom-fields/:fieldId. The answers to a sensitive question are deleted with it
 * (removeFieldAnswers); those to any other question stay, as stored. Blocked (409 field_in_use) while
 * any of the event's items still reference this field via config.content_fields, and (409
 * field_controls_others) while another field is shown only for an answer to this one. For any other question
 * it does not check or change existing Attendee.custom_data, consistent with how deleting/reshaping an item
 * today never scrubs attendee data. */
export async function handleDeleteEventCustomField(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const fieldId = c.req.param("fieldId");
  if (!fieldId) return c.json({ error: "fieldId required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadCustomFieldInEvent(db, eventId, fieldId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  try {
    await db.$transaction(async (tx) => {
      // The answers to a sensitive question go with it (D-E6), which writes attendee rows: the jobs of the event come
      // first, in the one order of docs/dev/attendee-erasure.md ("Taking locks"). The open exports and imports are stopped
      // as an erasure stops them (the job is no longer running, so an import that loaded the fields before this and has not
      // taken its job row yet writes nothing, and cannot bring the deleted answers back).
      if (existing.sensitive) await stopOpenAttendeeJobs(tx, eventId, STOPPED_BY_FIELD_DELETION);
      // The lock serializes against event-items-api-routes.ts's content_fields validation, which
      // takes the same lock before its own registry check + commit - without it, an item save
      // could commit a new content_fields reference between this scan and the delete below
      // (Postgres default isolation is READ COMMITTED, not Serializable).
      await acquireEventCustomFieldsLock(tx, eventId);
      const current = await loadCustomFieldInEvent(tx, eventId, fieldId);
      if (!current) throw new FieldGoneError();
      // Made sensitive after the first read, so the jobs were not locked: the caller tries again.
      if (current.sensitive && !existing.sensitive) throw new FieldSetChangedError();

      if (await itemsShowField(tx, eventId, existing.source_field)) {
        throw new FieldInUseError();
      }
      // A field that other fields are shown by is not deleted: their condition would name nothing.
      if (controlsOtherFields(existing.source_field, await loadConditionFields(tx, eventId))) {
        throw new ShowWhenError("field_controls_others");
      }

      await tx.eventCustomField.delete({ where: { id: fieldId } });
      const removed = current.sensitive ? await removeFieldAnswers(tx, { eventId, sourceField: current.source_field }) : null;
      await writeBulkActionLog(tx, {
        event_id: eventId,
        action_type: "event_custom_field_deleted",
        audit: adminAuditFromContext(c),
        // Counts of the rows whose answers were removed, never an answer.
        metadata: { source_field: existing.source_field, ...(removed ? { answers_removed: removed } : {}) },
      });
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof FieldInUseError) {
      return c.json({ error: "field_in_use" }, 409);
    }
    if (err instanceof FieldSetChangedError) return c.json({ error: "stale_write" }, 409);
    if (err instanceof FieldGoneError) return c.json({ error: "forbidden" }, 403);
    if (err instanceof ShowWhenError) return showWhenProblemResponse(c, err.problem);
    throw err;
  }
}
