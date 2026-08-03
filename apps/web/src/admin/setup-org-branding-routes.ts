import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { canManageInstance } from "@admitto/auth";
import {
  setBranding,
  InvalidHttpUrlError,
  logoCropFromDb,
  parseLogoCrop,
  type LogoCropMeta,
  type LogoPersistenceDto,
} from "@admitto/mail-templates";
import { emitSystemLog } from "@admitto/shared/system-log";
import { resolveActorEmailForLog } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import { bestEffortDeleteReplacedUploadUrls } from "./branding-upload.js";

export type SetupOrgBrandingDto = {
  org_name: string | null;
} & LogoPersistenceDto;

type OrgBrandingPatch = {
  org_name?: string;
  logo_url?: string | null;
  logo_original_url?: string | null;
  logo_crop?: LogoCropMeta | null;
};

/** Read an optional string|null field; returns null on type mismatch. */
function readOptionalStringField(
  record: Record<string, unknown>,
  key: string,
): { ok: true; value: string | null | undefined } | { ok: false } {
  if (!(key in record)) return { ok: true, value: undefined };
  const raw = record[key];
  if (raw !== null && typeof raw !== "string") return { ok: false };
  return { ok: true, value: raw };
}

function parsePatchBody(body: unknown): OrgBrandingPatch | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const out: OrgBrandingPatch = {};

  const orgName = readOptionalStringField(record, "org_name");
  if (!orgName.ok) return null;
  if (orgName.value !== undefined) {
    out.org_name = orgName.value === null ? "" : orgName.value.trim();
  }

  const logoUrl = readOptionalStringField(record, "logo_url");
  if (!logoUrl.ok) return null;
  if (logoUrl.value !== undefined) out.logo_url = logoUrl.value;

  const logoOriginal = readOptionalStringField(record, "logo_original_url");
  if (!logoOriginal.ok) return null;
  if (logoOriginal.value !== undefined) out.logo_original_url = logoOriginal.value;

  if ("logo_crop" in record) {
    try {
      out.logo_crop = parseLogoCrop(record.logo_crop);
    } catch {
      return null;
    }
  }

  if (Object.keys(out).length === 0) return null;
  return out;
}

/** GET /api/admin/setup/org-branding — instance org name and logo URL. */
export async function handleGetSetupOrgBranding(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const org = await db.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { name: true, logo_url: true, logo_original_url: true, logo_crop: true },
  });

  const payload: SetupOrgBrandingDto = {
    org_name: org.name,
    logo_url: org.logo_url,
    logo_original_url: org.logo_original_url,
    logo_crop: logoCropFromDb(org.logo_crop),
  };
  return c.json(payload, 200);
}

/** PATCH /api/admin/setup/org-branding — update org display name and HTTPS logo URL. */
export async function handlePatchSetupOrgBranding(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const patch = parsePatchBody(body);
  if (!patch) {
    return c.json({ error: "invalid body" }, 400);
  }

  const orgId = await resolveInstanceOrganizationId(db, process.env);

  const name = patch.org_name?.trim();
  if (patch.org_name !== undefined && !name) {
    return c.json({ error: "org_name required" }, 400);
  }

  const previous = await db.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { logo_url: true, logo_original_url: true },
  });

  try {
    await db.$transaction(async (tx) => {
      if (name !== undefined) {
        await tx.organization.update({
          where: { id: orgId },
          data: { name },
        });
      }

      if (
        patch.logo_url !== undefined ||
        patch.logo_original_url !== undefined ||
        patch.logo_crop !== undefined
      ) {
        await setBranding(
          { scopeType: "organization", scopeId: orgId },
          {
            logoUrl: patch.logo_url,
            logoOriginalUrl: patch.logo_original_url,
            logoCrop: patch.logo_crop,
          },
          tx,
        );
      }
    });
  } catch (err) {
    if (err instanceof InvalidHttpUrlError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }

  const next = await db.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { logo_url: true, logo_original_url: true },
  });
  // Interim orphan cleanup (ADR 0008): drop replaced/cleared managed upload files.
  await bestEffortDeleteReplacedUploadUrls(
    [previous.logo_url, previous.logo_original_url],
    [next.logo_url, next.logo_original_url],
  );

  emitSystemLog("admin", "info", "org_branding_updated", {
    orgId,
    fields: Object.keys(patch),
    actorUserId: auth.userId,
    actorEmail: await resolveActorEmailForLog(db, auth.userId),
  });

  return handleGetSetupOrgBranding(c, db);
}
