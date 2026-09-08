import type { Prisma, PrismaClient } from "@admitto/db";
import { encryptToString } from "@admitto/crypto";
import type { WebhookKind } from "./channels/webhook.js";

// Never Prisma.TransactionClient - see the Db comment in ./dispatcher.ts.
type Db = PrismaClient;

export interface NotificationSettingsPublic {
  webhook: {
    /** Never the decrypted URL itself - see WebhookChannel, which is the only thing that ever
     * decrypts it. Same "configured, not the secret" convention as weather/maps' own org
     * settings (apps/web/src/weather/weather-org-settings.ts). */
    set: boolean;
    kind: WebhookKind;
  };
  extra_email_recipients: string[];
  disabled_types: string[];
}

export interface NotificationSettingsPatch {
  /** Omit to keep the stored URL unchanged; empty string clears it; any other value replaces it
   * (encrypted before storage). Never round-tripped back out via describeNotificationSettings. */
  webhookUrl?: string;
  webhookKind?: WebhookKind;
  /** Omit to keep the stored list unchanged; provide the full replacement list (including []) to
   * change it - this is a whole-list replace, not a per-address patch. */
  extraEmailRecipients?: string[];
  disabledTypes?: string[];
}

/** Same string-only filter dispatcher.ts's own readOrgSettings() already applies when reading
 * this column - kept consistent rather than also re-validating against the current registry here,
 * since a type that becomes non-orgDisableable (or is removed) in a later registry change should
 * not make an organization's already-stored preference silently vanish from what this reports. */
function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

function normalizeEmailList(raw: unknown): string[] {
  return normalizeStringArray(raw).filter((entry) => entry.trim().length > 0);
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
      disabled_types: true,
    },
  });
  return {
    webhook: {
      set: Boolean(settings?.webhook_url_enc),
      kind: (settings?.webhook_kind as WebhookKind | null) ?? "generic",
    },
    extra_email_recipients: normalizeEmailList(settings?.extra_email_recipients),
    disabled_types: normalizeStringArray(settings?.disabled_types),
  };
}

/**
 * Upserts NotificationSettings for an organization. Validation (webhook URL well-formedness,
 * disabledTypes only containing real orgDisableable registry keys) is the caller's responsibility
 * - same separation as setMailSettings/patchWeatherSettings, which also trust their input and
 * leave shape/domain validation to the route layer.
 */
export async function patchNotificationSettings(
  db: Db,
  organizationId: string,
  patch: NotificationSettingsPatch,
): Promise<NotificationSettingsPublic> {
  const webhookUrlEnc =
    patch.webhookUrl === undefined
      ? undefined
      : patch.webhookUrl.trim() === ""
        ? null
        : encryptToString(patch.webhookUrl.trim());

  const updateData: Prisma.NotificationSettingsUpdateInput = {};
  if (webhookUrlEnc !== undefined) updateData.webhook_url_enc = webhookUrlEnc;
  if (patch.webhookKind !== undefined) updateData.webhook_kind = patch.webhookKind;
  if (patch.extraEmailRecipients !== undefined) {
    updateData.extra_email_recipients = normalizeEmailList(
      patch.extraEmailRecipients,
    ) as Prisma.InputJsonValue;
  }
  if (patch.disabledTypes !== undefined) {
    updateData.disabled_types = normalizeStringArray(patch.disabledTypes) as Prisma.InputJsonValue;
  }

  await db.notificationSettings.upsert({
    where: { scope_type_scope_id: { scope_type: "organization", scope_id: organizationId } },
    create: {
      scope_type: "organization",
      scope_id: organizationId,
      webhook_url_enc: webhookUrlEnc ?? null,
      webhook_kind: patch.webhookKind ?? null,
      extra_email_recipients: normalizeEmailList(patch.extraEmailRecipients) as Prisma.InputJsonValue,
      disabled_types: normalizeStringArray(patch.disabledTypes) as Prisma.InputJsonValue,
    },
    update: updateData,
  });

  return describeNotificationSettings(db, organizationId);
}
