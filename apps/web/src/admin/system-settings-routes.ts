import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import {
  canManageInstance,
  setSetting,
  isSettingEnvLocked,
  getSessionTtlAdminMs,
  getSessionTtlOperatorMs,
  getSessionIdleTimeoutAdminMs,
  getSessionIdleTimeoutOperatorMs,
  getTrustedDeviceDays,
  getMfaRequiredRoles,
  getInstanceUrl,
  SETTING_SESSION_TTL,
  SETTING_OPERATOR_SESSION_TTL,
  SETTING_SESSION_IDLE_TIMEOUT,
  SETTING_OPERATOR_SESSION_IDLE_TIMEOUT,
  SETTING_TRUSTED_DEVICE_DAYS,
  SETTING_MFA_REQUIRED_ROLES,
  SETTING_INSTANCE_URL,
} from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { emitSystemLog } from "@admitto/shared/system-log";
import { adminAuditFromContext, resolveActorEmailForLog } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import { normalizePersistedInstanceUrl } from "../instance-base-url.js";

async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) return c.json({ error: "forbidden" }, 403);
  return null;
}

async function getSettingSource(
  db: PrismaClient,
  key: string,
): Promise<"env" | "db" | "default"> {
  if (isSettingEnvLocked(key)) return "env";
  const row = await db.systemSettings.findUnique({ where: { key }, select: { key: true } });
  return row ? "db" : "default";
}

async function buildSystemSettingsDto(db: PrismaClient) {
  const [
    adminTtl,
    opTtl,
    adminIdle,
    opIdle,
    trustedDays,
    mfaRoles,
    instanceUrl,
    adminTtlSrc,
    opTtlSrc,
    adminIdleSrc,
    opIdleSrc,
    trustedDaysSrc,
    mfaRolesSrc,
    instanceUrlSrc,
  ] = await Promise.all([
    getSessionTtlAdminMs(db),
    getSessionTtlOperatorMs(db),
    getSessionIdleTimeoutAdminMs(db),
    getSessionIdleTimeoutOperatorMs(db),
    getTrustedDeviceDays(db),
    getMfaRequiredRoles(db),
    getInstanceUrl(db),
    getSettingSource(db, SETTING_SESSION_TTL),
    getSettingSource(db, SETTING_OPERATOR_SESSION_TTL),
    getSettingSource(db, SETTING_SESSION_IDLE_TIMEOUT),
    getSettingSource(db, SETTING_OPERATOR_SESSION_IDLE_TIMEOUT),
    getSettingSource(db, SETTING_TRUSTED_DEVICE_DAYS),
    getSettingSource(db, SETTING_MFA_REQUIRED_ROLES),
    getSettingSource(db, SETTING_INSTANCE_URL),
  ]);

  return {
    session_ttl_ms: { value: adminTtl, source: adminTtlSrc },
    operator_session_ttl_ms: { value: opTtl, source: opTtlSrc },
    session_idle_timeout_ms: { value: adminIdle, source: adminIdleSrc },
    operator_session_idle_timeout_ms: { value: opIdle, source: opIdleSrc },
    trusted_device_days: { value: trustedDays, source: trustedDaysSrc },
    mfa_required_roles: { value: mfaRoles, source: mfaRolesSrc },
    instance_url: { value: instanceUrl, source: instanceUrlSrc },
  };
}

const instanceUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((value, ctx) => {
    if (value.trim().endsWith("/")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Instance URL must not end with a trailing slash",
      });
      return;
    }
    try {
      normalizePersistedInstanceUrl(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid instance URL";
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });

const patchSchema = z
  .object({
    session_ttl_ms: z.number().int().min(3_600_000).max(2_592_000_000).nullable().optional(),
    operator_session_ttl_ms: z
      .number()
      .int()
      .min(3_600_000)
      .max(604_800_000)
      .nullable()
      .optional(),
    session_idle_timeout_ms: z
      .number()
      .int()
      .min(300_000)
      .max(14_400_000)
      .nullable()
      .optional(),
    operator_session_idle_timeout_ms: z
      .number()
      .int()
      .min(300_000)
      .max(28_800_000)
      .nullable()
      .optional(),
    trusted_device_days: z.number().int().min(0).max(90).nullable().optional(),
    mfa_required_roles: z
      .array(z.enum(["superadmin", "admin", "operator"]))
      .nullable()
      .optional(),
    instance_url: instanceUrlSchema.nullable().optional(),
  })
  .strict();

const KEY_MAP = {
  session_ttl_ms: SETTING_SESSION_TTL,
  operator_session_ttl_ms: SETTING_OPERATOR_SESSION_TTL,
  session_idle_timeout_ms: SETTING_SESSION_IDLE_TIMEOUT,
  operator_session_idle_timeout_ms: SETTING_OPERATOR_SESSION_IDLE_TIMEOUT,
  trusted_device_days: SETTING_TRUSTED_DEVICE_DAYS,
  mfa_required_roles: SETTING_MFA_REQUIRED_ROLES,
  instance_url: SETTING_INSTANCE_URL,
} as const satisfies Record<string, string>;

/** Idle-timeout field paired with the absolute-lifetime field it must not exceed. */
const IDLE_VS_ABSOLUTE_PAIRS = [
  {
    idleField: "session_idle_timeout_ms",
    getIdle: getSessionIdleTimeoutAdminMs,
    getAbsolute: getSessionTtlAdminMs,
  },
  {
    idleField: "operator_session_idle_timeout_ms",
    getIdle: getSessionIdleTimeoutOperatorMs,
    getAbsolute: getSessionTtlOperatorMs,
  },
] as const;

/** Rolled back the PATCH transaction because an idle timeout would exceed its paired absolute lifetime. */
class IdleExceedsAbsoluteError extends Error {
  constructor(public readonly field: string) {
    super("idle_timeout_exceeds_absolute_lifetime");
  }
}

/** GET /api/admin/system-settings — returns system settings with value and source (env|db|default). Superadmin only. */
export async function handleGetSystemSettings(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  return c.json(await buildSystemSettingsDto(db));
}

/** PATCH /api/admin/system-settings — update system settings atomically; null clears DB override. Superadmin only. */
export async function handlePatchSystemSettings(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
  }

  const data = parsed.data;
  const presentKeys = Object.keys(data) as (keyof typeof data)[];

  if (presentKeys.length === 0) {
    return c.json(await buildSystemSettingsDto(db));
  }

  for (const bodyKey of presentKeys) {
    const settingKey = KEY_MAP[bodyKey];
    if (isSettingEnvLocked(settingKey)) {
      return c.json({ error: "managed by environment", field: bodyKey }, 400);
    }
  }

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  const actorUserId = c.get("auth").userId;

  try {
    await db.$transaction(async (tx) => {
      for (const bodyKey of presentKeys) {
        const settingKey = KEY_MAP[bodyKey];
        let value = data[bodyKey];
        if (bodyKey === "instance_url" && typeof value === "string") {
          value = normalizePersistedInstanceUrl(value);
        }
        if (value === null || value === undefined) {
          await tx.systemSettings.deleteMany({ where: { key: settingKey } });
        } else {
          await setSetting(tx, settingKey, value);
        }
      }

      // An idle timeout longer than its paired absolute lifetime could never trigger —
      // reject the whole PATCH (atomic) rather than silently accepting a no-op value.
      for (const pair of IDLE_VS_ABSOLUTE_PAIRS) {
        const idleMs = await pair.getIdle(tx);
        const absoluteMs = await pair.getAbsolute(tx);
        if (idleMs > absoluteMs) {
          throw new IdleExceedsAbsoluteError(pair.idleField);
        }
      }

      await writeAdminAuditLog(tx, {
        organizationId: orgId,
        actorUserId,
        sessionId: audit.sessionId,
        ip: audit.ip,
        timezone: audit.timezone,
        actionType: "system_settings_updated",
        metadata: { fields: presentKeys },
      });
    });
  } catch (err) {
    if (err instanceof IdleExceedsAbsoluteError) {
      return c.json(
        { error: "idle_timeout_exceeds_absolute_lifetime", field: err.field },
        400,
      );
    }
    throw err;
  }

  emitSystemLog("security", "info", "system_settings_updated", {
    fields: presentKeys,
    actorUserId,
    actorEmail: await resolveActorEmailForLog(db, actorUserId),
  });

  return c.json(await buildSystemSettingsDto(db));
}
