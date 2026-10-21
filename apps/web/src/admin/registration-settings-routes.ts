/**
 * Instance settings of guest registration: the Cloudflare Turnstile keys and the access methods
 * (public link, event password, SSO) the organisation makes available (D-C1, D-C2, D-A6).
 *
 * Superadmin only, checked on the server for every route. The secret key is write-only: it goes
 * in, encrypted, and never comes back in an answer, an audit row or a log line. Per event choices
 * (which method, which mode) belong to the event's own Registration settings, not here.
 */

import type { Context } from "hono";
import { z } from "zod";
import { Prisma, REGISTRATION_ACCESS_METHOD, type PrismaClient } from "@admitto/db";
import { writeAdminAuditLog } from "@admitto/tickets";
import { requireAuditActor, requireSuperadmin } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import {
  resolveAccessMethodAvailability,
  setEnabledAccessMethods,
  type AccessMethodAvailability,
} from "../registration/access-methods.js";
import {
  clearTurnstileSettings,
  describeTurnstileSettings,
  isValidTurnstileSecretKey,
  isValidTurnstileSiteKey,
  patchTurnstileSettings,
  type TurnstileSettingsPublic,
} from "../registration/turnstile-settings.js";

/** `null` clears the key, a string sets it, leaving it out keeps it. At least one must be present. */
const turnstilePutSchema = z
  .object({
    site_key: z.string().trim().refine(isValidTurnstileSiteKey).nullable().optional(),
    secret_key: z.string().trim().refine(isValidTurnstileSecretKey).nullable().optional(),
  })
  .strict()
  .refine((body) => body.site_key !== undefined || body.secret_key !== undefined);

const accessMethodsPutSchema = z
  .object({ methods: z.array(z.enum(REGISTRATION_ACCESS_METHOD)).max(REGISTRATION_ACCESS_METHOD.length) })
  .strict();

function serializeTurnstile(settings: TurnstileSettingsPublic) {
  return { site_key: settings.siteKey, secret_set: settings.secretSet, status: settings.state };
}

function serializeAvailability(list: AccessMethodAvailability[]) {
  return {
    methods: list.map((entry) => ({
      method: entry.method,
      enabled: entry.enabled,
      available: entry.available,
      blocked_by: entry.blockedBy,
    })),
  };
}

/** Names of the fields that failed, never their values: a rejected secret must not be echoed. */
function failingFields(error: z.ZodError): string[] {
  const names = error.issues.map((issue) => issue.path[0]).filter((name): name is string => typeof name === "string");
  return [...new Set(names)];
}

async function parseBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<{ data: z.infer<S>; response?: never } | { data?: never; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { response: c.json({ error: "invalid_json" }, 400) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { response: c.json({ error: "validation_failed", fields: failingFields(parsed.error) }, 400) };
  }
  return { data: parsed.data };
}

/** One writer of the Turnstile keys at a time. A save reads the stored keys and writes them back, so
 * two saves at once (one changing the site key, one the secret) could put back each other's old value. */
async function lockTurnstileSettings(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${"registration:turnstile-settings"}))`);
}

type KeyChange = "set" | "cleared" | "unchanged";

function keyChange(value: string | null | undefined): KeyChange {
  if (value === undefined) return "unchanged";
  return value === null ? "cleared" : "set";
}

/** GET /api/admin/registration/turnstile */
export async function handleGetRegistrationTurnstile(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  return c.json(serializeTurnstile(await describeTurnstileSettings(db)));
}

/** PUT /api/admin/registration/turnstile - site key and/or secret key. The answer never carries the secret. */
export async function handlePutRegistrationTurnstile(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  const parsed = await parseBody(c, turnstilePutSchema);
  if (parsed.response) return parsed.response;
  const { site_key: siteKey, secret_key: secretKey } = parsed.data;
  const organizationId = await resolveInstanceOrganizationId(db, process.env);

  // The write and its audit row commit together, so a changed secret never goes unrecorded.
  const settings = await db.$transaction(async (tx) => {
    await lockTurnstileSettings(tx);
    const result = await patchTurnstileSettings(tx, { siteKey, secretKey });
    await writeAdminAuditLog(tx, {
      organizationId,
      actorUserId: actor.operator,
      sessionId: actor.sessionId,
      ip: actor.ip,
      timezone: actor.timezone,
      actionType: "registration_turnstile_updated",
      // Field names and what happened to each, never a value.
      metadata: { site_key: keyChange(siteKey), secret_key: keyChange(secretKey) },
    });
    return result;
  });
  return c.json(serializeTurnstile(settings));
}

/** DELETE /api/admin/registration/turnstile - removes both keys, which closes the form. */
export async function handleDeleteRegistrationTurnstile(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  const organizationId = await resolveInstanceOrganizationId(db, process.env);
  const settings = await db.$transaction(async (tx) => {
    await lockTurnstileSettings(tx);
    await clearTurnstileSettings(tx);
    await writeAdminAuditLog(tx, {
      organizationId,
      actorUserId: actor.operator,
      sessionId: actor.sessionId,
      ip: actor.ip,
      timezone: actor.timezone,
      actionType: "registration_turnstile_cleared",
    });
    return describeTurnstileSettings(tx);
  });
  return c.json(serializeTurnstile(settings));
}

/** GET /api/admin/registration/access-methods */
export async function handleGetRegistrationAccessMethods(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  return c.json(serializeAvailability(await resolveAccessMethodAvailability(db)));
}

/** PUT /api/admin/registration/access-methods - replaces the list of enabled methods. */
export async function handlePutRegistrationAccessMethods(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  const parsed = await parseBody(c, accessMethodsPutSchema);
  if (parsed.response) return parsed.response;

  const organizationId = await resolveInstanceOrganizationId(db, process.env);
  // The answer is read in the same transaction, so a 500 always means that nothing was saved.
  const availability = await db.$transaction(async (tx) => {
    const methods = await setEnabledAccessMethods(tx, parsed.data.methods);
    await writeAdminAuditLog(tx, {
      organizationId,
      actorUserId: actor.operator,
      sessionId: actor.sessionId,
      ip: actor.ip,
      timezone: actor.timezone,
      actionType: "registration_access_methods_updated",
      metadata: { methods },
    });
    return resolveAccessMethodAvailability(tx);
  });
  return c.json(serializeAvailability(availability));
}
