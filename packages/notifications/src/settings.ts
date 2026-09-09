import type { Prisma, PrismaClient } from "@admitto/db";
import { encryptToString } from "@admitto/crypto";
import type { WebhookKind } from "./channels/webhook.js";
import type { NotificationChannelKey } from "./types.js";

// Never Prisma.TransactionClient - see the Db comment in ./dispatcher.ts.
type Db = PrismaClient;

export interface NotificationEmailRecipient {
  email: string;
  description: string;
  /** Server-resolved, never client-supplied - see patchNotificationSettings's diff logic. null
   * only for legacy/corrupt data that predates these fields. */
  added_at: string | null;
  added_by_email: string | null;
  added_by_display_name: string | null;
  /** Acting admin's IANA timezone at the moment this recipient was added, when known - same
   * best-effort X-Client-Timezone capture as Event.created_by_timezone. null for legacy data or
   * when the header was missing/invalid. */
  added_by_timezone: string | null;
}

export interface NotificationSettingsPublic {
  webhook: {
    /** Never the decrypted URL itself - see WebhookChannel, which is the only thing that ever
     * decrypts it. Same "configured, not the secret" convention as weather/maps' own org
     * settings (apps/web/src/weather/weather-org-settings.ts). */
    set: boolean;
    kind: WebhookKind;
  };
  extra_email_recipients: NotificationEmailRecipient[];
  /** notification_type -> channels this organization has turned off for that type. Omitted type
   * or empty array = fully enabled on every channel (opt-out default). */
  disabled_channels: Record<string, NotificationChannelKey[]>;
}

export interface NotificationSettingsPatch {
  /** Omit to keep the stored URL unchanged; empty string clears it; any other value replaces it
   * (encrypted before storage). Never round-tripped back out via describeNotificationSettings. */
  webhookUrl?: string;
  webhookKind?: WebhookKind;
  /** Omit to keep the stored list unchanged; provide the full replacement list (including []) to
   * change it - this is a whole-list replace, not a per-address patch. Only email+description
   * come from the caller; added_at/added_by are always server-resolved (see
   * patchNotificationSettings) - an entry whose email already exists keeps its original stamp
   * (description may still change), a new email gets a fresh one. */
  extraEmailRecipients?: Array<{ email: string; description?: string }>;
  /** Omit to keep the stored map unchanged; provide the full replacement map (including {}) to
   * change it - this is a whole-map replace, not a per-type patch. */
  disabledChannels?: Record<string, string[]>;
}

/** Same string-only filter dispatcher.ts's own readOrgSettings() already applies when reading
 * this column - kept consistent rather than also re-validating against the current registry here,
 * since a type that becomes non-orgDisableable (or is removed) in a later registry change should
 * not make an organization's already-stored preference silently vanish from what this reports. */
function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

function normalizeNullableString(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

/** Shape-only validation of what's already stored - drops an entry with no usable email, dedupes
 * by email (last one wins), and defaults a missing description to "". Corrupt/legacy shapes
 * (e.g. the pre-recipient-object plain string[]) normalize to an empty list rather than crash. */
function normalizeEmailRecipients(raw: unknown): NotificationEmailRecipient[] {
  if (!Array.isArray(raw)) return [];
  const byEmail = new Map<string, NotificationEmailRecipient>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const email = typeof record.email === "string" ? record.email.trim() : "";
    if (!email) continue;
    byEmail.set(email, {
      email,
      description: typeof record.description === "string" ? record.description.trim() : "",
      added_at: normalizeNullableString(record.added_at),
      added_by_email: normalizeNullableString(record.added_by_email),
      added_by_display_name: normalizeNullableString(record.added_by_display_name),
      added_by_timezone: normalizeNullableString(record.added_by_timezone),
    });
  }
  return [...byEmail.values()];
}

/** Shape-only validation (a JSON object mapping type keys to string arrays) - same separation as
 * normalizeStringArray's own doc comment: which type ids and channel names are actually real is
 * the route layer's job, not this package's. Drops entries whose channel list normalizes to
 * empty, since an empty array is equivalent to the type being absent entirely (opt-out default). */
function normalizeDisabledChannels(raw: unknown): Record<string, NotificationChannelKey[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, NotificationChannelKey[]> = {};
  for (const [type, channels] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeStringArray(channels) as NotificationChannelKey[];
    if (normalized.length > 0) result[type] = normalized;
  }
  return result;
}

export async function describeNotificationSettings(
  db: Db,
  organizationId: string,
): Promise<NotificationSettingsPublic> {
  const settings = await db.notificationSettings.findUnique({
    where: { scope_type_scope_id: { scope_type: "organization", scope_id: organizationId } },
    select: {
      webhook_url_enc: true,
      webhook_kind: true,
      extra_email_recipients: true,
      disabled_channels: true,
    },
  });
  return {
    webhook: {
      set: Boolean(settings?.webhook_url_enc),
      kind: (settings?.webhook_kind as WebhookKind | null) ?? "generic",
    },
    extra_email_recipients: normalizeEmailRecipients(settings?.extra_email_recipients),
    disabled_channels: normalizeDisabledChannels(settings?.disabled_channels),
  };
}

/** Same try/catch-wrapped db.user.findUnique shape as the write-time actor snapshots already
 * used elsewhere (packages/tickets/src/admin-audit.ts's resolveActorIdentitySnapshot,
 * packages/auth/src/audit.ts's resolveUserIdentitySnapshot) - kept local rather than shared since
 * neither of those is exported outside its own package either. */
async function resolveActorSnapshot(
  db: Db,
  userId: string,
): Promise<{ email: string; display_name: string | null } | null> {
  try {
    return await db.user.findUnique({ where: { id: userId }, select: { email: true, display_name: true } });
  } catch {
    return null;
  }
}

/**
 * Builds the next extra_email_recipients list from the caller's {email, description} pairs,
 * resolving added_at/added_by server-side: an email that already exists in `current` keeps its
 * original stamp (only its description can change), an email that's new gets one fresh actor
 * lookup (done at most once per call, not once per new recipient) stamped onto every new entry.
 * Dedupes by (lowercased) email - last occurrence in `patchEntries` wins.
 */
async function buildNextRecipients(
  db: Db,
  current: NotificationEmailRecipient[],
  patchEntries: Array<{ email: string; description?: string }>,
  actorUserId: string,
  actorTimezone: string | undefined,
): Promise<NotificationEmailRecipient[]> {
  const currentByEmail = new Map(current.map((r) => [r.email, r]));
  const byEmail = new Map<string, NotificationEmailRecipient>();
  let actorSnapshot: { email: string; display_name: string | null } | null | undefined;

  for (const entry of patchEntries) {
    const email = entry.email.trim().toLowerCase();
    if (!email) continue;
    const description = (entry.description ?? "").trim();
    const existing = currentByEmail.get(email);
    if (existing) {
      byEmail.set(email, { ...existing, description });
      continue;
    }
    if (actorSnapshot === undefined) actorSnapshot = await resolveActorSnapshot(db, actorUserId);
    byEmail.set(email, {
      email,
      description,
      added_at: new Date().toISOString(),
      added_by_email: actorSnapshot?.email ?? null,
      added_by_display_name: actorSnapshot?.display_name ?? null,
      added_by_timezone: actorTimezone ?? null,
    });
  }
  return [...byEmail.values()];
}

/**
 * Upserts NotificationSettings for an organization. Validation (webhook URL well-formedness,
 * disabledChannels keys only containing real orgDisableable registry type ids, and its values
 * only containing real channel names) is the caller's responsibility
 * - same separation as setMailSettings/patchWeatherSettings, which also trust their input and
 * leave shape/domain validation to the route layer. `actorUserId`/`actorTimezone` are only read
 * when patch.extraEmailRecipients introduces a genuinely new email - see buildNextRecipients.
 */
export async function patchNotificationSettings(
  db: Db,
  organizationId: string,
  patch: NotificationSettingsPatch,
  actorUserId: string,
  actorTimezone?: string,
): Promise<NotificationSettingsPublic> {
  let webhookUrlEnc: string | null | undefined;
  if (patch.webhookUrl === undefined) {
    webhookUrlEnc = undefined;
  } else if (patch.webhookUrl.trim() === "") {
    webhookUrlEnc = null;
  } else {
    webhookUrlEnc = encryptToString(patch.webhookUrl.trim());
  }

  let nextRecipients: NotificationEmailRecipient[] | undefined;
  if (patch.extraEmailRecipients !== undefined) {
    const current = await describeNotificationSettings(db, organizationId);
    nextRecipients = await buildNextRecipients(
      db,
      current.extra_email_recipients,
      patch.extraEmailRecipients,
      actorUserId,
      actorTimezone,
    );
  }

  const updateData: Prisma.NotificationSettingsUpdateInput = {};
  if (webhookUrlEnc !== undefined) updateData.webhook_url_enc = webhookUrlEnc;
  if (patch.webhookKind !== undefined) updateData.webhook_kind = patch.webhookKind;
  if (nextRecipients !== undefined) {
    updateData.extra_email_recipients = nextRecipients as unknown as Prisma.InputJsonValue;
  }
  if (patch.disabledChannels !== undefined) {
    updateData.disabled_channels = normalizeDisabledChannels(
      patch.disabledChannels,
    ) as Prisma.InputJsonValue;
  }

  await db.notificationSettings.upsert({
    where: { scope_type_scope_id: { scope_type: "organization", scope_id: organizationId } },
    create: {
      scope_type: "organization",
      scope_id: organizationId,
      webhook_url_enc: webhookUrlEnc ?? null,
      webhook_kind: patch.webhookKind ?? null,
      extra_email_recipients: (nextRecipients ?? []) as unknown as Prisma.InputJsonValue,
      disabled_channels: normalizeDisabledChannels(patch.disabledChannels) as Prisma.InputJsonValue,
    },
    update: updateData,
  });

  return describeNotificationSettings(db, organizationId);
}
