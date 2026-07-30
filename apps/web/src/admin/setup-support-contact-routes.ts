import { z } from "zod";
import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance } from "@admitto/auth";
import { emitSystemLog } from "@admitto/shared/system-log";
import { resolveActorEmailForLog } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

export type SetupSupportContactDto = {
  support_contact_name: string | null;
  support_contact_email: string | null;
};

// "" clears the stored value, matching putMailSettingsBodySchema's convention
// (mail-settings-shared.ts) for optional identity-style fields.
const optionalName = z.union([z.string().trim().max(200), z.literal("")]).optional();
const optionalEmail = z.union([z.string().trim().email().max(254), z.literal("")]).optional();

const patchSupportContactBodySchema = z
  .object({
    support_contact_name: optionalName,
    support_contact_email: optionalEmail,
  })
  .strict();

/** GET /api/admin/setup/support-contact — reserved-for-future-use contact identity
 * (e.g. to identify this instance if it ever calls external services). */
export async function handleGetSetupSupportContact(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const org = await db.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { support_contact_name: true, support_contact_email: true },
  });

  const payload: SetupSupportContactDto = {
    support_contact_name: org.support_contact_name,
    support_contact_email: org.support_contact_email,
  };
  return c.json(payload, 200);
}

/** PATCH /api/admin/setup/support-contact */
export async function handlePatchSetupSupportContact(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const parsed = patchSupportContactBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
  }
  const body = parsed.data;

  const orgId = await resolveInstanceOrganizationId(db, process.env);

  const data: { support_contact_name?: string | null; support_contact_email?: string | null } = {};
  if (body.support_contact_name !== undefined) {
    data.support_contact_name = body.support_contact_name === "" ? null : body.support_contact_name;
  }
  if (body.support_contact_email !== undefined) {
    data.support_contact_email = body.support_contact_email === "" ? null : body.support_contact_email;
  }

  if (Object.keys(data).length > 0) {
    await db.organization.update({ where: { id: orgId }, data });
  }

  emitSystemLog("admin", "info", "support_contact_updated", {
    orgId,
    fields: Object.keys(data),
    actorUserId: auth.userId,
    actorEmail: await resolveActorEmailForLog(db, auth.userId),
  });

  return handleGetSetupSupportContact(c, db);
}
