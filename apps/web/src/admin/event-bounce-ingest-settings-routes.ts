/**
 * Event-scoped bounce / NDR IMAP ingest settings (ADR 0039).
 * Superadmin-only — same gate as event mail transport credentials.
 */
import type { Context } from "hono";
import { encryptToString } from "@admitto/crypto";
import type { PrismaClient, BounceIngestSettings, Prisma } from "@admitto/db";
import { describeMailConfig } from "@admitto/mailer-config";
import { isBlockedMailHost } from "@admitto/mailer";
import {
  DEFAULT_BOUNCE_FOLDERS,
  imapTestErrorForAdmin,
  parseFolders,
  testBounceImapConnection,
} from "@admitto/mail-delivery";
import { writeAdminAuditLog } from "@admitto/tickets";
import { z } from "zod";
import {
  adminAuditFromContext,
  requireEventId,
  requireSuperadmin,
} from "./admin-helpers.js";

const putBodySchema = z
  .object({
    imap_host: z
      .union([
        z
          .string()
          .trim()
          .min(1)
          .max(253)
          .refine((h) => !isBlockedMailHost(h), {
            error: "host must not be a private, loopback, or link-local address",
          }),
        z.literal(""),
      ])
      .optional(),
    imap_port: z.union([z.number().int().min(1).max(65535), z.null()]).optional(),
    imap_username: z.union([z.string().trim().min(1).max(254), z.literal("")]).optional(),
    imap_password: z.string().max(512).optional(),
    clear_imap_password: z.boolean().optional(),
    reuse_smtp_credentials: z.boolean().optional(),
    folders: z.union([z.array(z.string().trim().min(1).max(200)).max(20), z.string().max(2000)]).optional(),
    poll_interval_minutes: z.union([z.number().int().min(1).max(1440), z.null()]).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

type PutBody = z.infer<typeof putBodySchema>;

type PutData = {
  imap_host?: string | null;
  imap_port?: number | null;
  imap_username?: string | null;
  imap_password_enc?: string | null;
  reuse_smtp_credentials?: boolean;
  folders?: Prisma.InputJsonValue;
  poll_interval_minutes?: number | null;
  enabled?: boolean;
};

async function loadEventOrg(
  db: PrismaClient,
  eventId: string,
): Promise<{ organizationId: string } | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { organization_id: true },
  });
  return event ? { organizationId: event.organization_id } : null;
}

async function effectiveProviderIsSmtp(db: PrismaClient, eventId: string): Promise<boolean> {
  try {
    const desc = await describeMailConfig(eventId, db);
    return desc.provider.value === "smtp";
  } catch {
    return false;
  }
}

function foldersToJson(folders: string[] | string | undefined): string[] {
  if (folders === undefined) return [...DEFAULT_BOUNCE_FOLDERS];
  return parseFolders(folders);
}

function serializeSettings(
  row: BounceIngestSettings | null,
  opts: {
    smtpReuseAvailable: boolean;
    smtpPasswordSet: boolean;
  },
) {
  const reuse = row?.reuse_smtp_credentials ?? false;
  const imapPasswordSet = reuse
    ? opts.smtpPasswordSet
    : Boolean(row?.imap_password_enc);

  return {
    configured: Boolean(row?.imap_host),
    enabled: row?.enabled ?? false,
    imap_host: row?.imap_host ?? null,
    imap_port: row?.imap_port ?? 993,
    imap_username: reuse ? null : (row?.imap_username ?? null),
    imap_password: {
      set: imapPasswordSet,
      masked: imapPasswordSet ? "••••" : null,
      from_smtp: reuse && opts.smtpReuseAvailable,
    },
    reuse_smtp_credentials: reuse,
    smtp_reuse_available: opts.smtpReuseAvailable,
    folders: row ? parseFolders(row.folders) : [...DEFAULT_BOUNCE_FOLDERS],
    poll_interval_minutes: row?.poll_interval_minutes ?? 5,
  };
}

async function smtpPasswordPresence(db: PrismaClient, eventId: string): Promise<boolean> {
  try {
    const desc = await describeMailConfig(eventId, db);
    return desc.provider.value === "smtp" && desc.smtpPassword.value !== null;
  } catch {
    return false;
  }
}

/** Shared GET/PUT/POST gate: event id, superadmin, event exists. */
async function gateBounceIngestSettings(
  c: Context,
  db: PrismaClient,
): Promise<{ eventId: string; organizationId: string } | Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const org = await loadEventOrg(db, eventId);
  if (!org) return c.json({ error: "event_not_found" }, 404);

  return { eventId, organizationId: org.organizationId };
}

function applyReuseCredentials(
  body: PutBody,
  existing: BounceIngestSettings | null,
  data: PutData,
  fieldsChanged: string[],
): boolean {
  if (body.reuse_smtp_credentials === undefined) return false;
  data.reuse_smtp_credentials = body.reuse_smtp_credentials;
  fieldsChanged.push("reuse_smtp_credentials");
  if (!body.reuse_smtp_credentials) return false;
  data.imap_password_enc = null;
  data.imap_username = null;
  fieldsChanged.push("imap_username", "imap_password");
  return Boolean(existing?.imap_password_enc);
}

function applyDedicatedCredentials(
  body: PutBody,
  data: PutData,
  fieldsChanged: string[],
): { secretsRotated: boolean; secretsCleared: boolean } {
  let secretsRotated = false;
  let secretsCleared = false;
  if (body.imap_username !== undefined) {
    data.imap_username = body.imap_username === "" ? null : body.imap_username;
    fieldsChanged.push("imap_username");
  }
  if (body.clear_imap_password) {
    data.imap_password_enc = null;
    secretsCleared = true;
    fieldsChanged.push("imap_password");
  } else if (body.imap_password !== undefined && body.imap_password.length > 0) {
    data.imap_password_enc = encryptToString(body.imap_password);
    secretsRotated = true;
    fieldsChanged.push("imap_password");
  }
  return { secretsRotated, secretsCleared };
}

function applyPutBodyFields(
  body: PutBody,
  existing: BounceIngestSettings | null,
  nextReuse: boolean,
): {
  data: PutData;
  fieldsChanged: string[];
  secretsRotated: boolean;
  secretsCleared: boolean;
} {
  const data: PutData = {};
  const fieldsChanged: string[] = [];
  let secretsRotated = false;
  let secretsCleared = false;

  if (body.imap_host !== undefined) {
    data.imap_host = body.imap_host === "" ? null : body.imap_host;
    fieldsChanged.push("imap_host");
  }
  if (body.imap_port !== undefined) {
    data.imap_port = body.imap_port;
    fieldsChanged.push("imap_port");
  }

  const clearedByReuse = applyReuseCredentials(body, existing, data, fieldsChanged);
  if (clearedByReuse) secretsCleared = true;

  if (!nextReuse) {
    const cred = applyDedicatedCredentials(body, data, fieldsChanged);
    secretsRotated = cred.secretsRotated;
    secretsCleared = secretsCleared || cred.secretsCleared;
  }

  if (body.folders !== undefined) {
    data.folders = foldersToJson(body.folders);
    fieldsChanged.push("folders");
  }
  if (body.poll_interval_minutes !== undefined) {
    data.poll_interval_minutes = body.poll_interval_minutes;
    fieldsChanged.push("poll_interval_minutes");
  }
  if (body.enabled !== undefined) {
    data.enabled = body.enabled;
    fieldsChanged.push("enabled");
  }

  return { data, fieldsChanged, secretsRotated, secretsCleared };
}

function validateEnableCredentials(
  body: PutBody,
  existing: BounceIngestSettings | null,
  data: PutData,
  nextReuse: boolean,
): { error: string; detail: string } | null {
  const willEnable = body.enabled ?? existing?.enabled ?? false;
  if (!willEnable) return null;

  const host = data.imap_host !== undefined ? data.imap_host : existing?.imap_host;
  if (!host) {
    return { error: "validation_failed", detail: "IMAP host is required when enabled" };
  }
  if (nextReuse) return null;

  const user = data.imap_username !== undefined ? data.imap_username : existing?.imap_username;
  const passEnc =
    data.imap_password_enc !== undefined ? data.imap_password_enc : existing?.imap_password_enc;
  if (!user || !passEnc) {
    return {
      error: "validation_failed",
      detail: "IMAP username and password are required when not reusing SMTP credentials",
    };
  }
  return null;
}

/** GET /api/admin/events/:eventId/bounce-ingest-settings */
export async function handleGetEventBounceIngestSettings(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const gated = await gateBounceIngestSettings(c, db);
  if (gated instanceof Response) return gated;
  const { eventId, organizationId } = gated;

  const row = await db.bounceIngestSettings.findUnique({ where: { event_id: eventId } });
  const smtpReuseAvailable = await effectiveProviderIsSmtp(db, eventId);
  const smtpPasswordSet = await smtpPasswordPresence(db, eventId);

  return c.json({
    eventId,
    organizationId,
    ...serializeSettings(row, { smtpReuseAvailable, smtpPasswordSet }),
  });
}

/** PUT /api/admin/events/:eventId/bounce-ingest-settings */
export async function handlePutEventBounceIngestSettings(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const gated = await gateBounceIngestSettings(c, db);
  if (gated instanceof Response) return gated;
  const { eventId, organizationId } = gated;

  let body: PutBody;
  try {
    body = putBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const existing = await db.bounceIngestSettings.findUnique({ where: { event_id: eventId } });
  const smtpReuseAvailable = await effectiveProviderIsSmtp(db, eventId);
  const nextReuse = body.reuse_smtp_credentials ?? existing?.reuse_smtp_credentials ?? false;

  if (nextReuse && !smtpReuseAvailable) {
    return c.json(
      {
        error: "reuse_smtp_unavailable",
        detail: "Use SMTP username & password requires this event's mail transport to be SMTP",
      },
      400,
    );
  }

  const applied = applyPutBodyFields(body, existing, nextReuse);
  const enableErr = validateEnableCredentials(body, existing, applied.data, nextReuse);
  if (enableErr) return c.json(enableErr, 400);

  const row = await db.bounceIngestSettings.upsert({
    where: { event_id: eventId },
    create: {
      event_id: eventId,
      imap_host: applied.data.imap_host ?? null,
      imap_port: applied.data.imap_port ?? 993,
      imap_username: applied.data.imap_username ?? null,
      imap_password_enc: applied.data.imap_password_enc ?? null,
      reuse_smtp_credentials: applied.data.reuse_smtp_credentials ?? false,
      folders: applied.data.folders ?? [...DEFAULT_BOUNCE_FOLDERS],
      poll_interval_minutes: applied.data.poll_interval_minutes ?? 5,
      enabled: applied.data.enabled ?? false,
    },
    update: applied.data,
  });

  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "bounce_ingest_settings_updated",
    metadata: {
      eventId,
      fields_changed: [...new Set(applied.fieldsChanged)],
      secrets_rotated: applied.secretsRotated,
      secrets_cleared: applied.secretsCleared,
      reuse_smtp_credentials: row.reuse_smtp_credentials,
    },
  });

  const smtpPasswordSet = await smtpPasswordPresence(db, eventId);
  return c.json({
    eventId,
    organizationId,
    ...serializeSettings(row, { smtpReuseAvailable, smtpPasswordSet }),
  });
}

/** POST /api/admin/events/:eventId/bounce-ingest-settings/test */
export async function handlePostEventBounceIngestSettingsTest(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const gated = await gateBounceIngestSettings(c, db);
  if (gated instanceof Response) return gated;
  const { eventId, organizationId } = gated;

  const row = await db.bounceIngestSettings.findUnique({ where: { event_id: eventId } });
  if (!row?.imap_host) {
    return c.json({ ok: false, error: "Save your bounce detection settings first." }, 400);
  }

  const result = await testBounceImapConnection(db, row);

  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "bounce_ingest_settings_tested",
    metadata: {
      eventId,
      ok: result.ok,
    },
  });

  if (!result.ok) {
    return c.json({ ok: false, error: imapTestErrorForAdmin(result.error) });
  }

  return c.json({
    ok: true,
    message: `Connected. Checked ${result.foldersChecked} folder${result.foldersChecked === 1 ? "" : "s"}.`,
  });
}
