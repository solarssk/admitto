import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  canManageInstance,
  getSetting,
  setSetting,
  isSettingEnvLocked,
  getSessionTtlAdminMs,
  getSessionTtlOperatorMs,
  getTrustedDeviceDays,
  getMfaRequiredRoles,
  SETTING_SESSION_TTL,
  SETTING_OPERATOR_SESSION_TTL,
  SETTING_TRUSTED_DEVICE_DAYS,
  SETTING_MFA_REQUIRED_ROLES,
} from "@admitto/auth";
import { writeAdminAuditLog } from "@admitto/tickets";
import { adminAuditFromContext } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

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

async function buildSecuritySettingsDto(db: PrismaClient) {
  const [adminTtl, opTtl, trustedDays, mfaRoles, adminTtlSrc, opTtlSrc, trustedDaysSrc, mfaRolesSrc] =
    await Promise.all([
      getSessionTtlAdminMs(db),
      getSessionTtlOperatorMs(db),
      getTrustedDeviceDays(db),
      getMfaRequiredRoles(db),
      getSettingSource(db, SETTING_SESSION_TTL),
      getSettingSource(db, SETTING_OPERATOR_SESSION_TTL),
      getSettingSource(db, SETTING_TRUSTED_DEVICE_DAYS),
      getSettingSource(db, SETTING_MFA_REQUIRED_ROLES),
    ]);

  return {
    session_ttl_ms: { value: adminTtl, source: adminTtlSrc },
    operator_session_ttl_ms: { value: opTtl, source: opTtlSrc },
    trusted_device_days: { value: trustedDays, source: trustedDaysSrc },
    mfa_required_roles: { value: mfaRoles, source: mfaRolesSrc },
  };
}

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
    trusted_device_days: z.number().int().min(0).max(90).nullable().optional(),
    mfa_required_roles: z
      .array(z.enum(["superadmin", "admin", "operator"]))
      .nullable()
      .optional(),
  })
  .strict();

const KEY_MAP = {
  session_ttl_ms: SETTING_SESSION_TTL,
  operator_session_ttl_ms: SETTING_OPERATOR_SESSION_TTL,
  trusted_device_days: SETTING_TRUSTED_DEVICE_DAYS,
  mfa_required_roles: SETTING_MFA_REQUIRED_ROLES,
} as const satisfies Record<string, string>;

export async function handleGetSystemSettings(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;

  return c.json(await buildSecuritySettingsDto(db));
}

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
    return c.json(await buildSecuritySettingsDto(db));
  }

  for (const bodyKey of presentKeys) {
    const settingKey = KEY_MAP[bodyKey];
    if (isSettingEnvLocked(settingKey)) {
      return c.json({ error: "managed by environment", field: bodyKey }, 400);
    }
  }

  const changedFields: string[] = [];

  for (const bodyKey of presentKeys) {
    const settingKey = KEY_MAP[bodyKey];
    const value = data[bodyKey];
    if (value === null || value === undefined) {
      await db.systemSettings.deleteMany({ where: { key: settingKey } });
    } else {
      await setSetting(db, settingKey, value);
    }
    changedFields.push(bodyKey);
  }

  if (changedFields.length > 0) {
    const orgId = await resolveInstanceOrganizationId(db);
    const audit = adminAuditFromContext(c);
    await writeAdminAuditLog(db, {
      organizationId: orgId,
      actorUserId: audit.operator ?? c.get("auth").userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      actionType: "system_settings_updated",
      metadata: { fields: changedFields },
    });
  }

  return c.json(await buildSecuritySettingsDto(db));
}
