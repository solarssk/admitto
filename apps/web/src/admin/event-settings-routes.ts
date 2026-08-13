/**
 * Event settings: read/update basic fields and superadmin PII export (prompt 54).
 */
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@admitto/db";
import { canManageInstance } from "@admitto/auth";
import {
  ADMITTABLE_STATUS_LIST,
  REVOCABLE_ITEM_STATES,
  writeAdminAuditLog,
  parseWalletFieldMapping,
  reissueOneWalletPass,
} from "@admitto/tickets";
import {
  InvalidHttpUrlError,
  logoCropFromDb,
  parseLogoCrop,
  resolveBrandingFromEvent,
  validateBrandingUrl,
  enforceLogoPersistenceForDisplayChange,
  type BrandingUpdateData,
  type EventSettingsDto,
  type LogoCropMeta,
} from "@admitto/mail-templates";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";
import { normalizeTimeZone } from "@admitto/shared/timezones";
import { decryptFromString, encryptToString } from "@admitto/crypto";
import {
  PassCreatorClient,
  WalletProviderError,
  WALLET_MAPPING_PLACEHOLDERS,
  resolveWalletProvider,
  type PassCreatorWebhookEventType,
  type WalletPassProvider,
} from "@admitto/wallet";
import { z } from "zod";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  eventHoursField,
  isValidCalendarDate,
  parseEventDateInput,
  requireEventId,
  resolveActorEmailForLog,
} from "./admin-helpers.js";
import { resolvePassCreatorBaseUrl } from "../config.js";
import { resolveInstanceBaseUrl } from "../instance-base-url.js";
import { quoteCsvCell, sanitizeCsvCell } from "./csv-sanitize.js";
import { timezoneField } from "./timezone.js";
import {
  countEventActivitySignals,
  isEventDeletable,
  listEventDeletionBlockers,
  type EventDeletionBlocker,
} from "./event-deletion.js";
import { attachmentContentDisposition } from "./content-disposition.js";
import { bestEffortDeleteReplacedUploadUrls } from "./branding-upload.js";
import { isManagedUploadUrlReferenced } from "./branding-upload-refs.js";

const dateOnlyField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => isValidCalendarDate(value), "Invalid date");

const PG_INT_MAX = 2_147_483_647;

/** Shape-only gate; bounds/zoom rules live in `parseLogoCrop` (called after this parses). */
const logoCropSchema = z
  .object({
    unit: z.literal("%"),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
    zoom: z.number().finite(),
  })
  .nullish();

/**
 * Strict schema: unknown keys (including `slug`) return 400 - slug is immutable and
 * clients must omit it; we do not silently strip extra fields.
 */
const patchEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    date: z.union([z.string().datetime(), dateOnlyField]).optional(),
    capacity: z.number().int().positive().max(PG_INT_MAX).nullish(),
    timezone: timezoneField.optional(),
    event_hours_start: eventHoursField,
    event_hours_end: eventHoursField,
    wallet_enabled: z.boolean().optional(),
    wallet_template_id: z.string().trim().max(200).nullish(),
    wallet_api_key: z.string().trim().max(512).nullish(),
    wallet_apple_enabled: z.boolean().optional(),
    wallet_google_enabled: z.boolean().optional(),
    wallet_field_mapping: z
      .record(
        z.string().trim().min(1).max(60).regex(/^[A-Za-z]\w*$/),
        z.enum(WALLET_MAPPING_PLACEHOLDERS),
      )
      .nullish(),
    logo_url: z.string().trim().max(2000).nullish(),
    logo_original_url: z.string().trim().max(2000).nullish(),
    logo_crop: logoCropSchema,
    header_image_url: z.string().trim().max(2000).nullish(),
  })
  .strict();

export type { EventSettingsDto };

type EventSettingsRow = {
  id: string;
  title: string;
  slug: string;
  date: Date;
  timezone: string;
  event_hours_start: string | null;
  event_hours_end: string | null;
  wallet_enabled: boolean;
  wallet_template_id: string | null;
  wallet_api_key_enc: string | null;
  wallet_apple_enabled: boolean;
  wallet_google_enabled: boolean;
  wallet_field_mapping: unknown;
  capacity: number | null;
  archived_at: Date | null;
  archived_by_timezone: string | null;
  created_at: Date;
  created_by_timezone: string | null;
  logo_url: string | null;
  logo_original_url: string | null;
  logo_crop: unknown;
  header_image_url: string | null;
  pinned_note: string | null;
  organization: { name: string; logo_url: string | null; header_image_url: string | null };
  event_items: Array<{ id: string; label: string; enabled: boolean }>;
};

function serializeEventSettings(
  event: EventSettingsRow,
  deletability: { isDeletable: boolean; deletionBlockers: EventDeletionBlocker[] },
  revokeCounts: { admittedCount: number; issuedItemsCount: number },
): EventSettingsDto {
  const normalizeNullableTimeZone = (value: string | null) =>
    value === null ? null : normalizeTimeZone(value) ?? value;
  const resolved = resolveBrandingFromEvent(event);
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    date: event.date.toISOString(),
    timezone: normalizeTimeZone(event.timezone) ?? event.timezone,
    event_hours_start: event.event_hours_start,
    event_hours_end: event.event_hours_end,
    wallet_enabled: event.wallet_enabled,
    wallet_template_id: event.wallet_template_id,
    wallet_api_key: { configured: event.wallet_api_key_enc != null },
    wallet_apple_enabled: event.wallet_apple_enabled,
    wallet_google_enabled: event.wallet_google_enabled,
    wallet_field_mapping: parseWalletFieldMapping(event.wallet_field_mapping),
    capacity: event.capacity,
    status: event.archived_at ? "archived" : "active",
    archived_at: event.archived_at ? event.archived_at.toISOString() : null,
    archived_by_timezone: normalizeNullableTimeZone(event.archived_by_timezone),
    created_at: event.created_at.toISOString(),
    created_by_timezone: normalizeNullableTimeZone(event.created_by_timezone),
    is_deletable: deletability.isDeletable,
    deletion_blockers: deletability.deletionBlockers,
    admitted_count: revokeCounts.admittedCount,
    issued_items_count: revokeCounts.issuedItemsCount,
    organization_name: event.organization.name,
    active_items: event.event_items.map((item) => ({
      id: item.id,
      name: item.label,
      enabled: item.enabled,
    })),
    logo_url: event.logo_url,
    logo_original_url: event.logo_original_url,
    logo_crop: logoCropFromDb(event.logo_crop),
    header_image_url: event.header_image_url,
    resolved_logo_url: resolved.logo_url || null,
    resolved_header_image_url: resolved.header_image_url || null,
  };
}

const EVENT_SETTINGS_SELECT = {
  id: true,
  title: true,
  slug: true,
  date: true,
  timezone: true,
  event_hours_start: true,
  event_hours_end: true,
  wallet_enabled: true,
  wallet_template_id: true,
  wallet_api_key_enc: true,
  wallet_apple_enabled: true,
  wallet_google_enabled: true,
  wallet_field_mapping: true,
  capacity: true,
  archived_at: true,
  archived_by_timezone: true,
  created_at: true,
  created_by_timezone: true,
  pinned_note: true,
  organization_id: true,
  logo_url: true,
  logo_original_url: true,
  logo_crop: true,
  header_image_url: true,
  organization: { select: { name: true, logo_url: true, header_image_url: true } },
  event_items: {
    select: { id: true, label: true, enabled: true },
    orderBy: { label: "asc" as const },
  },
} as const;

/** Load content signals for an event and evaluate the shared delete guard against them. */
async function loadDeletability(
  db: PrismaClient,
  eventId: string,
  event: { archived_at: Date | null; pinned_note: string | null },
): Promise<{ isDeletable: boolean; deletionBlockers: EventDeletionBlocker[] }> {
  const signals = await countEventActivitySignals(db, eventId);
  const deletionBlockers = listEventDeletionBlockers(event, signals);
  return { isDeletable: isEventDeletable(event, signals), deletionBlockers };
}

/** Live counts backing the Danger Zone's "Revoke all check-ins" / "Revoke all items issued" rows.
 * Both are scoped to attendees whose pass is still admittable: revokeAllCheckInsForEvent's
 * resetItems:true cascade and revokeAllItemsForEvent both skip a blocked (revoked/cancelled)
 * attendee via the same isAdmittable guard the single-item actions enforce (bot review) - an
 * admitted-but-blocked attendee's check-in revoke rolls back entirely rather than clearing, so
 * counting them here would show/enable a Danger Zone row for attendees/items the bulk action can
 * never actually revoke. */
async function loadRevokeCounts(
  db: PrismaClient,
  eventId: string,
): Promise<{ admittedCount: number; issuedItemsCount: number }> {
  const [admittedCount, issuedItemsCount] = await Promise.all([
    db.attendee.count({
      where: {
        event_id: eventId,
        admitted_at: { not: null },
        status: { in: ADMITTABLE_STATUS_LIST },
      },
    }),
    db.attendeeItemState.count({
      where: {
        state: { in: REVOCABLE_ITEM_STATES },
        event_item: { event_id: eventId },
        attendee: { status: { in: ADMITTABLE_STATUS_LIST } },
      },
    }),
  ]);
  return { admittedCount, issuedItemsCount };
}

async function loadEventSettingsRow(
  db: PrismaClient,
  eventId: string,
): Promise<(EventSettingsRow & { organization_id: string }) | null> {
  return db.event.findUnique({
    where: { id: eventId },
    select: EVENT_SETTINGS_SELECT,
  });
}

/** GET /api/admin/events/:eventId/settings */
export async function handleGetEventSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await loadEventSettingsRow(db, eventId);
  if (!event) return c.json({ error: "not_found" }, 404);

  const [deletability, revokeCounts] = await Promise.all([
    loadDeletability(db, eventId, event),
    loadRevokeCounts(db, eventId),
  ]);
  return c.json(serializeEventSettings(event, deletability, revokeCounts));
}

const walletTestSchema = z.object({
  apiKey: z.string().trim().max(512).optional(),
  templateId: z.string().trim().min(1).max(200),
});

function walletTestErrorMessage(code: WalletProviderError["code"]): string {
  switch (code) {
    case "wallet_provider_unauthorized":
      return "PassCreator rejected the API key.";
    case "wallet_provider_not_found":
      return "Template ID not found on this PassCreator account.";
    case "wallet_provider_rate_limited":
      return "PassCreator is rate-limiting this instance - try again shortly.";
    case "wallet_provider_timeout":
      return "Could not reach PassCreator.";
    default:
      return "PassCreator rejected the request.";
  }
}

/**
 * POST /api/admin/events/:eventId/wallet/test
 * Probe the API key + template ID from a draft body (no persist). Empty/omitted apiKey falls
 * back to the event's already-saved key.
 */
export async function handlePostEventWalletTest(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  if (!(await canManageInstance(db, c.get("auth").userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = walletTestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }

  let apiKey = parsed.data.apiKey;
  if (!apiKey) {
    const event = await db.event.findUnique({
      where: { id: eventId },
      select: { wallet_api_key_enc: true },
    });
    if (!event?.wallet_api_key_enc) {
      return c.json({ ok: false, error: "An API key is required to test the connection." });
    }
    try {
      apiKey = decryptFromString(event.wallet_api_key_enc);
    } catch {
      return c.json({ ok: false, error: "The saved API key could not be decrypted." });
    }
  }

  const client = new PassCreatorClient({
    apiKey,
    templateId: parsed.data.templateId,
    baseUrl: resolvePassCreatorBaseUrl(),
  });
  try {
    const result = await client.describeTemplate();
    return c.json({
      ok: true,
      message: result.name ? `Connected - template "${result.name}".` : "Connected to PassCreator.",
    });
  } catch (err) {
    const message =
      err instanceof WalletProviderError
        ? walletTestErrorMessage(err.code)
        : "Could not reach PassCreator.";
    return c.json({ ok: false, error: message });
  }
}

type PatchEventBody = z.infer<typeof patchEventSchema>;

type WalletFieldsPatch = {
  wallet_enabled?: boolean;
  wallet_template_id?: string | null;
  wallet_api_key_enc?: string | null;
  wallet_apple_enabled?: boolean;
  wallet_google_enabled?: boolean;
  wallet_field_mapping?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
};

/** Wallet-only slice of buildBasicFieldsPatch, extracted to keep the main function's cognitive
 * complexity under the SonarCloud threshold (S3776). */
function buildWalletFieldsPatch(patch: PatchEventBody): WalletFieldsPatch {
  const data: WalletFieldsPatch = {};
  if (patch.wallet_enabled !== undefined) data.wallet_enabled = patch.wallet_enabled;
  if (patch.wallet_template_id !== undefined) data.wallet_template_id = patch.wallet_template_id;
  // Empty string clears the key; omit to keep the previous one.
  if (patch.wallet_api_key !== undefined) {
    data.wallet_api_key_enc = patch.wallet_api_key ? encryptToString(patch.wallet_api_key) : null;
  }
  if (patch.wallet_apple_enabled !== undefined) {
    data.wallet_apple_enabled = patch.wallet_apple_enabled;
  }
  if (patch.wallet_google_enabled !== undefined) {
    data.wallet_google_enabled = patch.wallet_google_enabled;
  }
  if (patch.wallet_field_mapping !== undefined) {
    const mapping = patch.wallet_field_mapping;
    data.wallet_field_mapping = mapping && Object.keys(mapping).length > 0 ? mapping : Prisma.JsonNull;
  }
  return data;
}

/** Maps the schema's basic (non-branding) fields onto Prisma update data. */
function buildBasicFieldsPatch(patch: PatchEventBody): WalletFieldsPatch & {
  title?: string;
  date?: Date;
  timezone?: string;
  event_hours_start?: string | null;
  event_hours_end?: string | null;
  capacity?: number | null;
} {
  const data: ReturnType<typeof buildBasicFieldsPatch> = buildWalletFieldsPatch(patch);
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.date !== undefined) data.date = parseEventDateInput(patch.date);
  if (patch.timezone !== undefined) data.timezone = patch.timezone;
  if (patch.event_hours_start !== undefined) data.event_hours_start = patch.event_hours_start;
  if (patch.event_hours_end !== undefined) data.event_hours_end = patch.event_hours_end;
  if (patch.capacity !== undefined) data.capacity = patch.capacity;
  return data;
}

type BrandingPatchData = BrandingUpdateData;

function patchOptionalBrandingUrl(
  field: "logo_url" | "logo_original_url" | "header_image_url",
  raw: string | null | undefined,
  data: BrandingPatchData,
): void {
  const trimmed = raw?.trim() ?? "";
  data[field] = trimmed ? validateBrandingUrl(field, trimmed) : null;
}

/** External or cleared display logo cannot keep an upload original / crop. */
function clearOriginalWhenDisplayIsNotUpload(
  data: BrandingPatchData,
  patch: PatchEventBody,
): void {
  enforceLogoPersistenceForDisplayChange(data, {
    logoUrl: patch.logo_url,
    logoOriginalUrl: patch.logo_original_url,
    logoCrop: patch.logo_crop,
  });
}

function brandingPatchErrorResponse(c: Context, err: unknown): Response | null {
  if (err instanceof InvalidHttpUrlError) {
    return c.json({ error: err.message }, 400);
  }
  if (err instanceof Error && err.message.startsWith("logo_crop")) {
    return c.json({ error: err.message }, 400);
  }
  return null;
}

/** Validates and writes branding URL / crop fields into `data`; returns an error Response, or null. */
function applyBrandingPatch(
  c: Context,
  data: BrandingPatchData,
  patch: PatchEventBody,
): Response | null {
  try {
    if (patch.logo_url !== undefined) {
      patchOptionalBrandingUrl("logo_url", patch.logo_url, data);
    }
    if (patch.logo_original_url !== undefined) {
      patchOptionalBrandingUrl("logo_original_url", patch.logo_original_url, data);
    }
    if (patch.logo_crop !== undefined) {
      const crop = parseLogoCrop(patch.logo_crop ?? null);
      data.logo_crop = crop === null ? Prisma.JsonNull : crop;
    }
    if (patch.header_image_url !== undefined) {
      patchOptionalBrandingUrl("header_image_url", patch.header_image_url, data);
    }
    clearOriginalWhenDisplayIsNotUpload(data, patch);
    return null;
  } catch (err) {
    const response = brandingPatchErrorResponse(c, err);
    if (response) return response;
    throw err;
  }
}

const WALLET_WEBHOOK_EVENT_TYPES: readonly PassCreatorWebhookEventType[] = [
  "first_pushnotification_registered",
  "pushnotification_registered",
  "pushnotification_unregistered",
  "pass_voided",
];

/** Best-effort: (re-)registers this event's webhook target URL with PassCreator for every event
 * type the receiving endpoint handles (wallet-webhook.ts), whenever a save leaves the wallet
 * fully enabled and configured. A PassCreator outage, unreachable instance URL, or bad key here
 * must never fail the settings save - registration/void updates simply keep flowing through the
 * existing periodic sync (registration-sync.ts) until a later save retries this. */
async function subscribeWalletWebhooksBestEffort(
  db: PrismaClient,
  eventId: string,
  updated: {
    wallet_enabled: boolean;
    wallet_template_id: string | null;
    wallet_api_key_enc: string | null;
  },
): Promise<void> {
  if (!updated.wallet_enabled || !updated.wallet_template_id || !updated.wallet_api_key_enc) return;

  let apiKey: string;
  try {
    apiKey = decryptFromString(updated.wallet_api_key_enc);
  } catch (err) {
    console.error("wallet webhook subscribe: API key decrypt failed:", err);
    return;
  }
  let baseUrl: string;
  try {
    baseUrl = await resolveInstanceBaseUrl(db);
  } catch (err) {
    console.error("wallet webhook subscribe: instance base URL unresolved:", err);
    return;
  }

  const client = new PassCreatorClient({
    apiKey,
    templateId: updated.wallet_template_id,
    baseUrl: resolvePassCreatorBaseUrl(),
  });
  const targetUrl = `${baseUrl}/api/wallet/webhook/passcreator/${eventId}`;

  // subscribeWebhook creates a fresh subscription entry every call, even for an identical
  // (template, targetUrl, event) triple - re-checking on every wallet-relevant save (which this
  // function runs on) would otherwise accumulate a duplicate subscription per save, each
  // delivering its own redundant webhook call forever after. Listing is itself best-effort: if it
  // fails, fall back to the old blind-subscribe behavior rather than skipping subscription
  // entirely - a few duplicate subscriptions are a lesser problem than none at all.
  let alreadySubscribed: Set<string>;
  try {
    const existing = await client.listWebhooks();
    alreadySubscribed = new Set(
      existing
        .filter((hook) => hook.passTemplate === updated.wallet_template_id && hook.targetUrl === targetUrl)
        .map((hook) => hook.event),
    );
  } catch (err) {
    console.error("wallet webhook subscribe: listWebhooks failed, subscribing unconditionally:", err);
    alreadySubscribed = new Set();
  }
  const eventTypesToSubscribe = WALLET_WEBHOOK_EVENT_TYPES.filter((event) => !alreadySubscribed.has(event));

  const settled = await Promise.allSettled(
    eventTypesToSubscribe.map((event) => client.subscribeWebhook(targetUrl, event)),
  );
  settled.forEach((outcome, index) => {
    if (outcome.status !== "rejected") return;
    const event = eventTypesToSubscribe[index];
    console.error(`wallet webhook subscribe (${event}) failed:`, outcome.reason);
    recordSystemLog({
      level: "error",
      source: "admin",
      message: "wallet_webhook_subscribe_failed",
      fields: { eventId, event },
    });
  });
}

/** Event fields that can appear in a wallet pass via WALLET_MAPPING_PLACEHOLDERS (event name,
 * hours, date, location) - only these are worth an automatic push to every already-issued pass.
 * A patch that touches only, say, capacity or branding never reaches pushWalletUpdatesBestEffort
 * below. */
const WALLET_RELEVANT_EVENT_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "date",
  "timezone",
  "event_hours_start",
  "event_hours_end",
]);

/** Same six-liner as attendees-api-routes.ts's own local chunk - duplicated rather than shared
 * across these two files for the same reason noted there (trivial, dependency-free). */
function chunkWalletTargets<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const WALLET_PUSH_CONCURRENCY = 10;

/** Best-effort: pushes every already-issued active wallet pass's name/ticket type/event details
 * fresh whenever a save changes one of WALLET_RELEVANT_EVENT_FIELDS above (PO report, 2026-08-13:
 * "the system already knows the wallet is on, so when hours/name change in Event Settings it
 * should quietly update the wallets too" - previously nothing pushed to already-issued passes
 * until an admin manually reissued each one). Reuses reissueOneWalletPass, the exact same
 * per-attendee logic the bulk-wallet-reissue endpoint already uses - a genuine data push, not
 * the webhook (re-)subscription subscribeWalletWebhooksBestEffort above handles. Runs after the
 * settings transaction has committed; a PassCreator outage or bad key here never fails the save,
 * and an attendee whose ticket can't be resolved is simply left with a stale pass until a manual
 * reissue or the next relevant settings change retries this. */
async function pushWalletUpdatesBestEffort(
  db: PrismaClient,
  eventId: string,
  changedFields: readonly string[],
  updated: {
    wallet_enabled: boolean;
    wallet_template_id: string | null;
    wallet_api_key_enc: string | null;
    wallet_field_mapping: unknown;
  },
  audit: ReturnType<typeof adminAuditFromContext>,
): Promise<void> {
  if (!changedFields.some((field) => WALLET_RELEVANT_EVENT_FIELDS.has(field))) return;
  if (!updated.wallet_enabled || !updated.wallet_template_id || !updated.wallet_api_key_enc) return;

  const provider: WalletPassProvider | null = resolveWalletProvider({
    walletEnabled: updated.wallet_enabled,
    walletTemplateId: updated.wallet_template_id,
    walletApiKeyEnc: updated.wallet_api_key_enc,
    walletFieldMapping: parseWalletFieldMapping(updated.wallet_field_mapping),
  });
  if (!provider) return;

  const targets = await db.walletPass.findMany({
    where: { status: "active", provider_pass_id: { not: null }, attendee: { event_id: eventId } },
    select: { attendee_id: true, provider_pass_id: true },
  });
  if (targets.length === 0) return;

  for (const batch of chunkWalletTargets(targets, WALLET_PUSH_CONCURRENCY)) {
    const settled = await Promise.allSettled(
      batch.map((row) =>
        reissueOneWalletPass(
          db,
          eventId,
          { attendeeId: row.attendee_id, providerPassId: row.provider_pass_id! },
          provider,
          audit,
        ),
      ),
    );
    settled.forEach((outcome, index) => {
      if (outcome.status !== "rejected") return;
      console.error("wallet event-change push failed:", outcome.reason);
      recordSystemLog({
        level: "error",
        source: "admin",
        message: "wallet_event_change_push_failed",
        fields: { eventId, attendeeId: batch[index]!.attendee_id },
      });
    });
  }
}

/** PATCH /api/admin/events/:eventId - basic fields only (archive guard applied upstream). */
export async function handlePatchEvent(c: Context, db: PrismaClient): Promise<Response> {
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

  const parsed = patchEventSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "validation_failed";
    return c.json({ error: message }, 400);
  }

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return c.json({ error: "validation_failed" }, 400);
  }

  // Wallet fields are superadmin-only in the UI (Event settings -> Wallet tab is
  // superadmin-gated); assertEventManageAccess above also permits organisation admins, so it
  // does not by itself enforce that boundary for these fields.
  const patchesWallet =
    patch.wallet_enabled !== undefined ||
    patch.wallet_template_id !== undefined ||
    patch.wallet_api_key !== undefined ||
    patch.wallet_apple_enabled !== undefined ||
    patch.wallet_google_enabled !== undefined ||
    patch.wallet_field_mapping !== undefined;
  if (patchesWallet && !(await canManageInstance(db, c.get("auth").userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const existing = await loadEventSettingsRow(db, eventId);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const audit = adminAuditFromContext(c);
  const actorUserId = c.get("auth").userId;

  const data: {
    title?: string;
    date?: Date;
    timezone?: string;
    event_hours_start?: string | null;
    event_hours_end?: string | null;
    wallet_enabled?: boolean;
    wallet_template_id?: string | null;
    wallet_api_key_enc?: string | null;
    wallet_apple_enabled?: boolean;
    wallet_google_enabled?: boolean;
    wallet_field_mapping?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    capacity?: number | null;
    logo_url?: string | null;
    logo_original_url?: string | null;
    logo_crop?: LogoCropMeta | typeof Prisma.JsonNull;
    header_image_url?: string | null;
  } = buildBasicFieldsPatch(patch);

  const brandingError = applyBrandingPatch(c, data, patch);
  if (brandingError) return brandingError;

  const changedFields = Object.keys(data);

  try {
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.event.update({
        where: { id: eventId },
        data,
        select: EVENT_SETTINGS_SELECT,
      });

      await writeAdminAuditLog(tx, {
        organizationId: row.organization_id,
        actorUserId,
        sessionId: audit.sessionId,
        ip: audit.ip,
        timezone: audit.timezone,
        actionType: "event_updated",
        metadata: { eventId, fields: changedFields },
      });

      return row;
    });

    emitSystemLog("admin", "info", "event_updated", {
      eventId,
      fields: changedFields,
      actorUserId,
      actorEmail: await resolveActorEmailForLog(db, actorUserId),
    });

    // Interim orphan cleanup (ADR 0008): drop replaced/cleared managed upload files.
    await bestEffortDeleteReplacedUploadUrls(
      [existing.logo_url, existing.logo_original_url, existing.header_image_url],
      [updated.logo_url, updated.logo_original_url, updated.header_image_url],
      { expectedOrgId: "default", expectedKind: "event", expectedEventId: eventId },
      { isStillReferenced: (url) => isManagedUploadUrlReferenced(db, url) },
    );

    if (patchesWallet) {
      await subscribeWalletWebhooksBestEffort(db, eventId, updated);
    }
    // Deliberately NOT awaited: on an event with hundreds/thousands of already-issued passes,
    // this fans out one PassCreator call per attendee - awaiting it here would hold the response
    // open long enough to risk a client-side timeout even though the settings change above has
    // already committed. Runs in the background of this same process instead; the .catch keeps a
    // failure here from ever becoming an unhandled promise rejection. Already best-effort by
    // design (see the function's own doc comment) - a push lost to a mid-flight process restart
    // self-heals the same way a PassCreator outage already does, on the next relevant save or a
    // manual reissue.
    pushWalletUpdatesBestEffort(db, eventId, changedFields, updated, audit).catch((err) => {
      console.error("wallet event-change push failed (top-level):", err);
      recordSystemLog({
        level: "error",
        source: "admin",
        message: "wallet_event_change_push_failed",
        fields: { eventId },
      });
    });

    const deletability = await loadDeletability(db, eventId, updated);
    const revokeCounts = await loadRevokeCounts(db, eventId);
    return c.json({ event: serializeEventSettings(updated, deletability, revokeCounts) });
  } catch (err) {
    console.error("[audit] event_updated transaction failed", err);
    recordSystemLog({
      level: "error",
      source: "admin",
      message: "event_updated_failed",
      fields: { eventId, fields: changedFields, actorUserId, errorKind: "transaction" },
    });
    return c.json({ error: "audit_failed" }, 500);
  }
}

const PII_EXPORT_MAX_ROWS = 10_000;

/** GET /api/admin/events/:eventId/export-pii - superadmin CSV of attendee PII. */
export async function handleExportEventPii(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const auth = c.get("auth");

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, slug: true, organization_id: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const audit = adminAuditFromContext(c);
  if (!audit.operator) return c.json({ error: "unauthorized" }, 401);

  const totalCount = await db.attendee.count({ where: { event_id: eventId } });
  const truncated = totalCount > PII_EXPORT_MAX_ROWS;

  const attendees = await db.attendee.findMany({
    where: { event_id: eventId },
    take: PII_EXPORT_MAX_ROWS,
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      company: true,
      department: true,
      ticket_type: true,
      admitted_at: true,
      custom_data: true,
    },
  });

  const columns = [
    "id",
    "name",
    "email",
    "company",
    "department",
    "ticket_type",
    "check_in_status",
    "admitted_at",
    "custom_data",
  ] as const;

  const header = columns.map((col) => quoteCsvCell(col)).join(",");
  const rows = attendees.map((row) => {
    const checkInStatus = row.admitted_at ? "admitted" : "not_admitted";
    const customData =
      row.custom_data != null && typeof row.custom_data === "object"
        ? JSON.stringify(row.custom_data)
        : "";
    return [
      row.id,
      row.name,
      row.email,
      row.company ?? "",
      row.department ?? "",
      row.ticket_type ?? "",
      checkInStatus,
      row.admitted_at?.toISOString() ?? "",
      customData,
    ]
      .map((cell) => quoteCsvCell(sanitizeCsvCell(String(cell))))
      .join(",");
  });

  const csvBody = [header, ...rows].join("\r\n");
  const bom = "\uFEFF";
  const dateStamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const filename = `pii-export-${event.slug}-${dateStamp}.csv`;

  await writeAdminAuditLog(db, {
    organizationId: event.organization_id,
    actorUserId: audit.operator,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "event_pii_exported",
    metadata: { eventId, rowCount: attendees.length, totalCount, truncated },
  });

  return new Response(bom + csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentContentDisposition(filename),
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      ...(truncated
        ? {
            "X-Export-Truncated": "true",
            "X-Export-Total-Rows": String(totalCount),
            "X-Export-Returned-Rows": String(attendees.length),
          }
        : {}),
    },
  });
}
