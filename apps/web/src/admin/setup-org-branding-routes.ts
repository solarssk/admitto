import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { setBranding, InvalidHttpUrlError } from "@admitto/mail-templates";
import { emitSystemLog } from "@admitto/shared/system-log";
import { resolveActorEmailForLog } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

export type SetupOrgBrandingDto = {
  org_name: string | null;
  logo_url: string | null;
};

function parsePatchBody(body: unknown): { org_name?: string; logo_url?: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const out: { org_name?: string; logo_url?: string | null } = {};
  if ("org_name" in record) {
    if (record.org_name !== null && typeof record.org_name !== "string") return null;
    out.org_name = record.org_name === null ? "" : record.org_name.trim();
  }
  if ("logo_url" in record) {
    if (record.logo_url !== null && typeof record.logo_url !== "string") return null;
    out.logo_url = record.logo_url;
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
    select: { name: true, logo_url: true },
  });

  const payload: SetupOrgBrandingDto = {
    org_name: org.name,
    logo_url: org.logo_url,
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

  try {
    await db.$transaction(async (tx) => {
      if (name !== undefined) {
        await tx.organization.update({
          where: { id: orgId },
          data: { name },
        });
      }

      if (patch.logo_url !== undefined) {
        await setBranding(
          { scopeType: "organization", scopeId: orgId },
          { logoUrl: patch.logo_url },
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

  emitSystemLog("admin", "info", "org_branding_updated", {
    orgId,
    fields: Object.keys(patch),
    actorUserId: auth.userId,
    actorEmail: await resolveActorEmailForLog(db, auth.userId),
  });

  return handleGetSetupOrgBranding(c, db);
}
