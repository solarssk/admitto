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
  type EventType,
  type LogoCropMeta,
} from "@admitto/mail-templates";
import { WALLET_RELEVANT_EVENT_FIELDS } from "@admitto/shared";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";
import { normalizeTimeZone } from "@admitto/shared/timezones";
import { decryptFromString, encryptToString } from "@admitto/crypto";
import {
  PassCreatorClient,
  WalletProviderError,
  WALLET_MAPPING_PLACEHOLDERS,
  EVENT_FIELD_PLACEHOLDERS,
  isWalletFieldMappingRelevant,
  isRelevantDateAffected,
  type PassCreatorWebhookEventType,
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
import { enqueueEventWideWalletPushJob } from "./wallet-push-routes.js";

const dateOnlyField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => isValidCalendarDate(value), "Invalid date");

const PG_INT_MAX = 2_147_483_647;

/** Apple PKEventType vocabulary this event can be categorized as (packages/tickets/src/
 * wallet-pass-input.ts's EVENT_TYPE_TO_APPLE translates the DB key to the literal Apple string). */
const EVENT_TYPES = [
  "generic",
  "live_performance",
  "movie",
  "sports",
  "conference",
  "convention",
  "workshop",
  "social_gathering",
] as const satisfies readonly EventType[];

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
    event_type: z.enum(EVENT_TYPES).nullish(),
    wallet_enabled: z.boolean().optional(),
    wallet_template_id: z.string().trim().max(200).nullish(),
    wallet_api_key: z.string().trim().max(512).nullish(),
    wallet_apple_enabled: z.boolean().optional(),
    wallet_google_enabled: z.boolean().optional(),
    wallet_samsung_enabled: z.boolean().optional(),
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
  event_type: string | null;
  wallet_enabled: boolean;
  wallet_template_id: string | null;
  wallet_api_key_enc: string | null;
  wallet_apple_enabled: boolean;
  wallet_google_enabled: boolean;
  wallet_samsung_enabled: boolean;
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
  installedWalletPassCount: number,
  issuedWalletPassCount: number,
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
    event_type: event.event_type as EventType | null,
    wallet_enabled: event.wallet_enabled,
    wallet_template_id: event.wallet_template_id,
    wallet_api_key: { configured: event.wallet_api_key_enc != null },
    wallet_apple_enabled: event.wallet_apple_enabled,
    wallet_google_enabled: event.wallet_google_enabled,
    wallet_samsung_enabled: event.wallet_samsung_enabled,
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
    installed_wallet_pass_count: installedWalletPassCount,
    issued_wallet_pass_count: issuedWalletPassCount,
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
  event_type: true,
  wallet_enabled: true,
  wallet_template_id: true,
  wallet_api_key_enc: true,
  wallet_apple_enabled: true,
  wallet_google_enabled: true,
  wallet_samsung_enabled: true,
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

/** Live count backing the "this will push to N installed wallet passes" confirm dialog shown
 * before a save that touches a WALLET_RELEVANT_EVENT_FIELDS field - deliberately narrower than
 * the event-wide push job's own target query (drain-wallet-push-jobs.ts's loadEventWideTargets,
 * every *active* pass with a provider_pass_id, regardless of confirmed install), since the point
 * here is warning about real people who'd actually notice the update on their phone, not how many
 * PassCreator API calls will fire - an issued-but-never-installed pass doesn't bother anyone. */
async function loadInstalledWalletPassCount(db: PrismaClient, eventId: string): Promise<number> {
  return db.walletPass.count({
    where: {
      status: "active",
      attendee: { event_id: eventId },
      OR: [
        { apple_active_registrations: { gt: 0 } },
        { google_active_registrations: { gt: 0 } },
        { samsung_active_registrations: { gt: 0 } },
      ],
    },
  });
}

/** Every WalletPass ever issued for this event, regardless of status/install - see
 * EventSettingsDto.issued_wallet_pass_count's own doc comment for why this (not the narrower
 * loadInstalledWalletPassCount above) is the right population for the Template ID lock: a pass
 * PassCreator has created is already bound to the current template even if nobody's device has
 * confirmed it yet. */
async function loadIssuedWalletPassCount(db: PrismaClient, eventId: string): Promise<number> {
  return db.walletPass.count({
    where: { attendee: { event_id: eventId }, issued_at: { not: null } },
  });
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

  const [deletability, revokeCounts, installedWalletPassCount, issuedWalletPassCount] = await Promise.all([
    loadDeletability(db, eventId, event),
    loadRevokeCounts(db, eventId),
    loadInstalledWalletPassCount(db, eventId),
    loadIssuedWalletPassCount(db, eventId),
  ]);
  return c.json(
    serializeEventSettings(event, deletability, revokeCounts, installedWalletPassCount, issuedWalletPassCount),
  );
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
  wallet_samsung_enabled?: boolean;
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
  if (patch.wallet_samsung_enabled !== undefined) {
    data.wallet_samsung_enabled = patch.wallet_samsung_enabled;
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
  event_type?: string | null;
  capacity?: number | null;
} {
  const data: ReturnType<typeof buildBasicFieldsPatch> = buildWalletFieldsPatch(patch);
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.date !== undefined) data.date = parseEventDateInput(patch.date);
  if (patch.timezone !== undefined) data.timezone = patch.timezone;
  if (patch.event_hours_start !== undefined) data.event_hours_start = patch.event_hours_start;
  if (patch.event_hours_end !== undefined) data.event_hours_end = patch.event_hours_end;
  if (patch.event_type !== undefined) data.event_type = patch.event_type;
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

/** Best-effort: (re-)registers this event's webhook target URL with PassCreator for every event
 * type the receiving endpoint handles (wallet-webhook.ts), whenever a save leaves the wallet
 * fully enabled and configured. A PassCreator outage, unreachable instance URL, or bad key here
 * must never fail the settings save - registration/void updates simply keep flowing through the
 * existing periodic sync (registration-sync.ts) until a later save retries this. Exported so
 * apps/web/src/scripts/backfill-wallet-first-confirmed.ts can run the same migration proactively
 * for every already wallet-enabled event, rather than waiting on each one's own next settings
 * save to pick up first_pushnotification_registered's new dedicated URL. */
export async function subscribeWalletWebhooksBestEffort(
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
  const registrationUrl = `${baseUrl}/api/wallet/webhook/passcreator/${eventId}`;
  // pass_voided and first_pushnotification_registered each get their own target URL - see
  // handlePassCreatorWebhook's doc comment (wallet-webhook.ts) for why: PassCreator's payload
  // never names which event fired, so any event this code needs to tell apart from the other two
  // (pushnotification_registered/unregistered, which stay on the shared registrationUrl - nothing
  // here acts on them any differently from each other) needs its own URL instead.
  const targetUrlFor = (event: PassCreatorWebhookEventType): string => {
    if (event === "pass_voided") return `${registrationUrl}/voided`;
    if (event === "first_pushnotification_registered") return `${registrationUrl}/first-confirmed`;
    return registrationUrl;
  };

  // subscribeWebhook creates a fresh subscription entry every call, even for an identical
  // (template, targetUrl, event) triple - re-checking on every wallet-relevant save (which this
  // function runs on) would otherwise accumulate a duplicate subscription per save, each
  // delivering its own redundant webhook call forever after. Listing is itself best-effort: if it
  // fails, skip subscribing entirely this cycle instead of guessing. Blindly resubscribing without
  // checking piles a fresh duplicate onto every existing one (the original bug this fixed).
  // Clearing target URLs first and resubscribing - tried in an earlier version of this fix - is
  // worse, not better: if a subsequent subscribeWebhook call then also fails, it deletes a
  // previously-working subscription with no guaranteed replacement, breaking wallet registration
  // or void updates for that event type until some later save happens to repair it (bot review,
  // PR #1057) - a regression the original bug never had, since the old subscription always stayed
  // in place alongside a failed duplicate attempt. Skipping is the only option that's never worse:
  // nothing here changes what's already subscribed, so the next successful save (or the periodic
  // sync, registration-sync.ts) is what reconciles it.
  let ownTemplateHooks: { targetUrl: string | null; event: string; passTemplate: string | null }[] = [];
  try {
    ownTemplateHooks = (await client.listWebhooks()).filter(
      (hook) => hook.passTemplate === updated.wallet_template_id,
    );
  } catch (err) {
    console.error("wallet webhook subscribe: listWebhooks failed, skipping this cycle:", err);
    return;
  }

  const alreadySubscribed = new Set(ownTemplateHooks.map((hook) => `${hook.targetUrl ?? ""} ${hook.event}`));
  const subscribeMissing = async (events: readonly PassCreatorWebhookEventType[]): Promise<boolean> => {
    const toSubscribe = events.filter((event) => !alreadySubscribed.has(`${targetUrlFor(event)} ${event}`));
    if (toSubscribe.length === 0) return true;
    const settled = await Promise.allSettled(toSubscribe.map((event) => client.subscribeWebhook(targetUrlFor(event), event)));
    let allOk = true;
    settled.forEach((outcome, index) => {
      if (outcome.status !== "rejected") return;
      allOk = false;
      const event = toSubscribe[index];
      console.error(`wallet webhook subscribe (${event}) failed:`, outcome.reason);
      recordSystemLog({
        level: "error",
        source: "admin",
        message: "wallet_webhook_subscribe_failed",
        fields: { eventId, event },
      });
    });
    return allOk;
  };

  // Ordered in two passes, dedicated-URL events before the shared one, not one combined batch -
  // bot review: subscribing the dedicated URLs and only *then* clearing the shared one means
  // first_pushnotification_registered/pass_voided always have a real, working subscription
  // somewhere before their legacy shared-URL entry (if any) is ever removed, closing the window
  // where a delivery for either could otherwise land nowhere at all (neither still on the old
  // shared URL, since it was just cleared, nor yet on the new dedicated one, since that
  // subscribe call hadn't been confirmed) - unlike pushnotification_registered/unregistered,
  // which keep flowing through the periodic sync (registration-sync.ts) as a fallback if this
  // whole cycle fails, first_pushnotification_registered/pass_voided have no such fallback.
  const dedicatedOk = await subscribeMissing(["first_pushnotification_registered", "pass_voided"]);

  // One-time migration: pass_voided (before 2026-08-19) and first_pushnotification_registered
  // (before 2026-09-02) both used to share registrationUrl with the two events that are still
  // meant to stay there - a subscription for either one is stale now that it has its own URL,
  // and would otherwise sit there forever, redelivering to a route that can't act on it the way
  // its own dedicated one can. PassCreator's unsubscribe API removes every event on a target URL
  // at once (not one event selectively - see PassCreatorClient.unsubscribeWebhook), so cleaning
  // up either stale entry means clearing registrationUrl entirely - gated on dedicatedOk (not
  // just hasLegacyEventOnRegistrationUrl): unsubscribing here before first_pushnotification_
  // registered/pass_voided have a *confirmed* working subscription at their own dedicated URL
  // would leave a delivery for either with nowhere to land at all until some later save repairs
  // it - unlike pushnotification_registered/unregistered below, which keep flowing through the
  // periodic sync (registration-sync.ts) as a fallback regardless, first_pushnotification_
  // registered/pass_voided have no such fallback (bot review).
  const hasLegacyEventOnRegistrationUrl = ownTemplateHooks.some(
    (hook) =>
      hook.targetUrl === registrationUrl &&
      (hook.event === "pass_voided" || hook.event === "first_pushnotification_registered"),
  );
  if (hasLegacyEventOnRegistrationUrl && dedicatedOk) {
    try {
      await client.unsubscribeWebhook(registrationUrl);
      alreadySubscribed.delete(`${registrationUrl} pushnotification_registered`);
      alreadySubscribed.delete(`${registrationUrl} pushnotification_unregistered`);
    } catch (err) {
      // Unsubscribe failed: the stale entry is still there untouched, so fall back to the normal
      // dedup (alreadySubscribed, unmodified) rather than piling a duplicate registration-event
      // subscription on top of it.
      console.error("wallet webhook subscribe: legacy event-URL migration unsubscribe failed:", err);
    }
  }

  // Always attempted, regardless of dedicatedOk above - independent of the migration-safety gate
  // (a brand new event with nothing subscribed yet needs these two subscribed the first time
  // either way, whether or not the unrelated dedicated-URL subscribe calls above happened to
  // succeed).
  await subscribeMissing(["pushnotification_registered", "pushnotification_unregistered"]);
}

/** Event fields that can appear in a wallet pass via WALLET_MAPPING_PLACEHOLDERS (event name,
 * hours, date, location, event type) - flipping any of these changes what buildWalletPassInput
 * would produce for an already-issued pass. wallet_apple_enabled is included too: PassCreator's
 * relevantDate (Lock Screen surfacing) is Apple-only, gated on it alone, so turning Apple Wallet
 * off must also refresh already-issued passes. */
type WalletRelevantEventSnapshot = {
  title: string;
  date: Date;
  timezone: string;
  event_hours_start: string | null;
  event_hours_end: string | null;
  event_type: string | null;
  wallet_apple_enabled: boolean;
};

/** True only when one of WALLET_RELEVANT_EVENT_FIELDS' *persisted* values actually differs -
 * comparing against the pre-write row, not just whether the patch touched the key, so
 * resubmitting an unchanged value (e.g. a client re-saving the same title) never counts as a
 * change (bot review: an unconditional key-presence check would let a resubmit loop repeatedly
 * enqueue pushes for no real change once each prior job finishes). Dates compare via getTime() -
 * both sides come from the same Postgres column, so this only ever differs on a genuine write.
 * Also requires the changed field to actually be capable of reaching an already-issued pass:
 * `date`/`event_hours_start`/`wallet_apple_enabled` go through isRelevantDateAffected (their only
 * channel is relevantDate, gated on live event state rather than fieldMapping - a static
 * EVENT_FIELD_PLACEHOLDERS entry can't express "only when the event actually has a start time and
 * Apple Wallet is on"); every other field goes through isWalletFieldMappingRelevant against
 * `updatedWalletFieldMapping` (the post-write mapping, so a save that both edits a field and maps
 * it in the same request still counts) - see @admitto/wallet. Editing an event field with no
 * template Additional Property pointed at it (e.g. `event_type` on a template that doesn't map it)
 * cannot change any issued pass, so it must not enqueue a no-op push. */
function walletRelevantEventFieldsChanged(
  existing: WalletRelevantEventSnapshot,
  updated: WalletRelevantEventSnapshot,
  updatedWalletFieldMapping: Record<string, string> | null,
): boolean {
  const relevantDateAffected = isRelevantDateAffected(
    { walletAppleEnabled: existing.wallet_apple_enabled, eventHoursStart: existing.event_hours_start },
    { walletAppleEnabled: updated.wallet_apple_enabled, eventHoursStart: updated.event_hours_start },
  );
  return WALLET_RELEVANT_EVENT_FIELDS.some((field) => {
    const a = existing[field];
    const b = updated[field];
    const changed = a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
    if (!changed) return false;
    if ((field === "date" || field === "event_hours_start" || field === "wallet_apple_enabled") && relevantDateAffected) {
      return true;
    }
    return isWalletFieldMappingRelevant(field, EVENT_FIELD_PLACEHOLDERS, updatedWalletFieldMapping);
  });
}

/** Best-effort: enqueues a wallet_push job to refresh every already-issued active wallet pass's
 * name/ticket type/event details whenever a save actually changes one of the wallet-relevant
 * fields (PO report, 2026-08-13: "the system already knows the wallet is on, so when hours/name
 * change in Event Settings it should quietly update the wallets too" - previously nothing pushed
 * to already-issued passes until an admin manually reissued each one). Guarded on wallet_enabled
 * here (unlike attendees-api-routes.ts's ticket-type push) so an event that never had wallet
 * turned on doesn't accumulate wallet_not_configured job-failure history on every settings save.
 * Awaited by the caller inside its own try/catch - enqueueing is now a single fast AdminJob
 * insert (not a PassCreator fan-out), so there's no client-timeout risk in waiting for it; a
 * PassCreator outage or bad key still never fails the save, since that only ever surfaces later,
 * inside the job worker. */
async function pushWalletUpdatesBestEffort(
  db: PrismaClient,
  c: Context,
  eventId: string,
  existing: WalletRelevantEventSnapshot,
  updated: WalletRelevantEventSnapshot & {
    organization_id: string;
    wallet_enabled: boolean;
    wallet_template_id: string | null;
    wallet_api_key_enc: string | null;
    wallet_field_mapping: unknown;
  },
): Promise<void> {
  if (!walletRelevantEventFieldsChanged(existing, updated, parseWalletFieldMapping(updated.wallet_field_mapping))) return;
  if (!updated.wallet_enabled || !updated.wallet_template_id || !updated.wallet_api_key_enc) return;

  await enqueueEventWideWalletPushJob(db, c, eventId, updated.organization_id, "settings");
}

/** Blocks a wallet credential change that would silently orphan already-issued passes.
 * PassCreator scopes a pass lookup to one template, permanently - there's no way to migrate an
 * already-issued pass to a different template, so once any pass has been issued under the current
 * template, changing wallet_template_id is refused outright (409) rather than warned-and-allowed:
 * every issued pass (installed or not) would otherwise become unmanageable (sync, void/restore,
 * push) the moment this saved (PO report, 2026-09-02 - "coś potrzeba z oficjalnej dokumentacji
 * passcreatora ogarnąć? albo generycznie zrobić?" - resolved generically, no PassCreator-specific
 * migration path exists to build against). wallet_api_key stays changeable - a leaked key must be
 * rotatable - but is live-verified against the *unchanged* template ID first (the same
 * describeTemplate() probe "Test connection" already uses), so a key for the wrong PassCreator
 * account can't silently take over an event with real issued passes. Returns null when nothing
 * needs blocking (no issued passes yet, or neither field is actually changing). */
async function guardWalletCredentialChange(
  c: Context,
  db: PrismaClient,
  eventId: string,
  patch: Pick<PatchEventBody, "wallet_template_id" | "wallet_api_key">,
  existing: Pick<EventSettingsRow, "wallet_template_id">,
): Promise<Response | null> {
  const templateChanging =
    patch.wallet_template_id !== undefined && patch.wallet_template_id !== existing.wallet_template_id;
  if (!templateChanging && !patch.wallet_api_key) return null;

  const issuedCount = await loadIssuedWalletPassCount(db, eventId);
  if (issuedCount === 0) return null;

  if (templateChanging) {
    return c.json({ error: "wallet_template_locked" }, 409);
  }

  // Key is changing (template isn't - the branch above already blocked that combination) -
  // nothing to verify the new key against if this event never had a template configured at all.
  if (!existing.wallet_template_id) return null;

  const client = new PassCreatorClient({
    apiKey: patch.wallet_api_key!,
    templateId: existing.wallet_template_id,
    baseUrl: resolvePassCreatorBaseUrl(),
  });
  try {
    await client.describeTemplate();
    return null;
  } catch (err) {
    const code = err instanceof WalletProviderError ? err.code : "wallet_provider_rejected";
    return c.json({ error: code }, 409);
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
    patch.wallet_samsung_enabled !== undefined ||
    patch.wallet_field_mapping !== undefined;
  if (patchesWallet && !(await canManageInstance(db, c.get("auth").userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const existing = await loadEventSettingsRow(db, eventId);
  if (!existing) return c.json({ error: "not_found" }, 404);

  if (patchesWallet) {
    const credentialGuardResponse = await guardWalletCredentialChange(c, db, eventId, patch, existing);
    if (credentialGuardResponse) return credentialGuardResponse;
  }

  const audit = adminAuditFromContext(c);
  const actorUserId = c.get("auth").userId;

  const data: {
    title?: string;
    date?: Date;
    timezone?: string;
    event_hours_start?: string | null;
    event_hours_end?: string | null;
    event_type?: string | null;
    wallet_enabled?: boolean;
    wallet_template_id?: string | null;
    wallet_api_key_enc?: string | null;
    wallet_apple_enabled?: boolean;
    wallet_google_enabled?: boolean;
    wallet_samsung_enabled?: boolean;
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
    // Awaited (unlike the pre-job-system version): enqueueing is now a single fast AdminJob
    // insert, not a fan-out of one PassCreator call per attendee, so there's no client-timeout
    // risk left to justify not waiting for it. Caught separately from the transaction above (same
    // reasoning as attendees-api-routes.ts's ticket-type push enqueue) - the settings write
    // already committed, so a transient enqueue failure here must not turn that success into a
    // 500.
    try {
      await pushWalletUpdatesBestEffort(db, c, eventId, existing, updated);
    } catch (err) {
      console.error("wallet event-change push enqueue failed:", err);
      recordSystemLog({
        level: "error",
        source: "admin",
        message: "wallet_event_change_push_failed",
        fields: { eventId },
      });
    }

    const [deletability, revokeCounts, installedWalletPassCount, issuedWalletPassCount] = await Promise.all([
      loadDeletability(db, eventId, updated),
      loadRevokeCounts(db, eventId),
      loadInstalledWalletPassCount(db, eventId),
      loadIssuedWalletPassCount(db, eventId),
    ]);
    return c.json({
      event: serializeEventSettings(
        updated,
        deletability,
        revokeCounts,
        installedWalletPassCount,
        issuedWalletPassCount,
      ),
    });
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
