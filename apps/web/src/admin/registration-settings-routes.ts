/**
 * Instance settings of guest registration: the Cloudflare Turnstile keys, whether the form has a bot check at all, the access methods
 * (public link, event password, SSO) the organisation makes available (D-C1, D-C2, D-A6) and the identity provider guests
 * sign in with when an event uses the company sign-in (D-C4).
 *
 * Superadmin only, checked on the server for every route. The secret key is write-only: it goes
 * in, encrypted, and never comes back in an answer, an audit row or a log line. Per event choices
 * (which method, which mode) belong to the event's own Registration settings, not here.
 */

import type { Context } from "hono";
import { z } from "zod";
import { Prisma, REGISTRATION_ACCESS_METHOD, type PrismaClient } from "@admitto/db";
import { findOidcProviderById } from "@admitto/auth";
import { writeAdminAuditLog, type StaffActor } from "@admitto/tickets";
import { requireAuditActor, requireSuperadmin } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import {
  resolveAccessMethodAvailability,
  setEnabledAccessMethods,
  type AccessMethodAvailability,
} from "../registration/access-methods.js";
import { checkTurnstileSecret } from "../registration/bot-challenge.js";
import { buildGuestSsoRedirectUri } from "../registration/sso-routes.js";
import {
  getSsoProviderId,
  listSelectableSsoProviders,
  ssoProviderState,
  setSsoProviderId,
  type GuestSsoProviderState,
} from "../registration/sso-provider.js";
import {
  BOT_PROTECTION_MODES,
  getBotProtectionMode,
  setBotProtectionMode,
  type BotProtectionMode,
} from "../registration/bot-protection-mode.js";
import {
  clearTurnstileSettings,
  describeTurnstileSettings,
  isValidTurnstileSecretKey,
  isValidTurnstileSiteKey,
  patchTurnstileSettings,
  resolveTurnstileKeys,
  type TurnstileSettingsPublic,
} from "../registration/turnstile-settings.js";

/** `null` clears the key, a string sets it, leaving it out keeps it; `bot_protection` is the mode of the check (A2). At least one must be present. */
const turnstilePutSchema = z
  .object({
    site_key: z.string().trim().refine(isValidTurnstileSiteKey).nullable().optional(),
    secret_key: z.string().trim().refine(isValidTurnstileSecretKey).nullable().optional(),
    bot_protection: z.enum(BOT_PROTECTION_MODES).optional(),
  })
  .strict()
  .refine((body) => body.site_key !== undefined || body.secret_key !== undefined || body.bot_protection !== undefined);

/** The secret to check when it is typed in the form and not saved yet; left out, the saved one is checked. */
const turnstileTestSchema = z
  .object({ secret_key: z.string().trim().refine(isValidTurnstileSecretKey).optional() })
  .strict();

const accessMethodsPutSchema = z
  .object({ methods: z.array(z.enum(REGISTRATION_ACCESS_METHOD)).max(REGISTRATION_ACCESS_METHOD.length) })
  .strict();

function serializeTurnstile(settings: TurnstileSettingsPublic, botProtection: BotProtectionMode) {
  return { site_key: settings.siteKey, secret_set: settings.secretSet, status: settings.state, bot_protection: botProtection };
}

const ssoProviderPutSchema = z.object({ provider_id: z.string().trim().min(1).max(128).nullable() }).strict();

/**
 * One address the provider's administrator lists as an allowed redirect: the instance's (`host: "instance"`, always first), then one
 * for each address of its own that an event with the company sign-in has (`host: "event_domain"`, D-C6), whether it is verified yet or
 * not (IT may enter an address before the check passes, and a guest signs in on it as soon as it is).
 */
export interface GuestRedirectUri {
  uri: string;
  host: "instance" | "event_domain";
  verified: boolean;
}

function serializeSsoProvider(
  providerId: string | null,
  state: GuestSsoProviderState,
  providers: { id: string; display_name: string }[],
  redirectUri: string | null,
  redirectUris: GuestRedirectUri[],
) {
  return { provider_id: providerId, state, providers, redirect_uri: redirectUri, redirect_uris: redirectUris };
}

/** The address of the instance that the guests' sign-in is built on (the same `baseUrl` as `handleSsoStart`), or null while none is set. */
export type SsoBaseUrl = () => Promise<string>;

/** The address of the instance that the guests' sign-in returns to, built where the flow builds it; null while the instance has no address. */
export async function readRedirectUri(baseUrl: SsoBaseUrl): Promise<string | null> {
  try {
    return buildGuestSsoRedirectUri(await baseUrl());
  } catch {
    return null;
  }
}

/**
 * Every return address the provider must list: the instance's (when it has an address) and one per address of its own that an
 * event that is not archived and uses the company sign-in has, sorted, each once (an address belongs to one event).
 */
export async function readRedirectUris(db: PrismaClient | Prisma.TransactionClient, instanceUri: string | null): Promise<GuestRedirectUri[]> {
  const rows = await db.eventRegistrationSettings.findMany({
    where: { custom_domain: { not: null }, access_methods: { has: "sso" }, event: { archived_at: null } },
    select: { custom_domain: true, custom_domain_verified_at: true },
  });
  const ofDomains = rows.flatMap((row) =>
    row.custom_domain === null
      ? []
      : [{ uri: buildGuestSsoRedirectUri(`https://${row.custom_domain}`), host: "event_domain" as const, verified: row.custom_domain_verified_at !== null }],
  );
  ofDomains.sort((a, b) => a.uri.localeCompare(b.uri, "en"));
  return [...(instanceUri === null ? [] : [{ uri: instanceUri, host: "instance" as const, verified: true }]), ...ofDomains];
}

/** The choice, how it stands, and what can be chosen. Never a field of a provider but its id and the name staff gave it. */
async function readSsoProvider(db: PrismaClient | Prisma.TransactionClient, redirectUri: string | null) {
  // The stored id is read once and the state is derived from it, so a change of provider between reads cannot make the two disagree.
  const providerId = await getSsoProviderId(db);
  const [provider, providers, redirectUris] = await Promise.all([
    providerId === null ? null : findOidcProviderById(db, providerId),
    listSelectableSsoProviders(db),
    readRedirectUris(db, redirectUri),
  ]);
  return serializeSsoProvider(providerId, ssoProviderState(providerId, provider), providers, redirectUri, redirectUris);
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

/** The answer of the Turnstile routes: the keys as they stand and the mode of the check, read in the same place. */
async function readTurnstileAnswer(db: PrismaClient | Prisma.TransactionClient) {
  return serializeTurnstile(await describeTurnstileSettings(db), await getBotProtectionMode(db));
}

/** Saves the mode of the bot check and records the change, when it is one. Inside the transaction of the save. */
async function saveBotProtectionMode(
  tx: Prisma.TransactionClient,
  mode: BotProtectionMode,
  who: { organizationId: string; actor: StaffActor },
): Promise<void> {
  const previous = await getBotProtectionMode(tx);
  if (previous === mode) return;
  await setBotProtectionMode(tx, mode);
  await writeAdminAuditLog(tx, {
    organizationId: who.organizationId,
    actorUserId: who.actor.operator,
    sessionId: who.actor.sessionId,
    ip: who.actor.ip,
    timezone: who.actor.timezone,
    actionType: "registration_bot_protection_updated",
    // The two modes, nothing else: they are fixed words.
    metadata: { mode, previous_mode: previous },
  });
}

/** GET /api/admin/registration/turnstile */
export async function handleGetRegistrationTurnstile(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  return c.json(await readTurnstileAnswer(db));
}

/**
 * PUT /api/admin/registration/turnstile - site key and/or secret key, and/or `bot_protection` (`required` or `not_used`: whether
 * the form has a bot check at all). The answer never carries the secret. A change of the mode is its own audit entry.
 */
export async function handlePutRegistrationTurnstile(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  const parsed = await parseBody(c, turnstilePutSchema);
  if (parsed.response) return parsed.response;
  const { site_key: siteKey, secret_key: secretKey, bot_protection: mode } = parsed.data;
  const organizationId = await resolveInstanceOrganizationId(db, process.env);

  // The write and its audit row commit together, so a changed secret never goes unrecorded.
  const answer = await db.$transaction(async (tx) => {
    await lockTurnstileSettings(tx);
    if (siteKey !== undefined || secretKey !== undefined) {
      await patchTurnstileSettings(tx, { siteKey, secretKey });
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
    }
    if (mode !== undefined) await saveBotProtectionMode(tx, mode, { organizationId, actor });
    return readTurnstileAnswer(tx);
  });
  return c.json(answer);
}

const TURNSTILE_TEST_OK = "Cloudflare accepted the secret key.";
const TURNSTILE_TEST_NO_SECRET = "Enter the secret key first.";
const TURNSTILE_TEST_UNREADABLE = "The saved secret key cannot be read. Enter the secret key again.";
const TURNSTILE_TEST_REJECTED = "Cloudflare did not accept the secret key. Check it in the Cloudflare dashboard.";
const TURNSTILE_TEST_UNAVAILABLE = "Could not reach Cloudflare. Try again in a moment.";

/**
 * POST /api/admin/registration/turnstile/test - asks Cloudflare whether it knows the secret key: the one typed in the form,
 * else the saved one. Nothing is saved, and the answer never carries the key.
 */
export async function handlePostRegistrationTurnstileTest(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const parsed = await parseBody(c, turnstileTestSchema);
  if (parsed.response) return parsed.response;

  let candidate = parsed.data.secret_key;
  if (candidate === undefined) {
    const keys = await resolveTurnstileKeys(db);
    if (keys.state === "unreadable") return c.json({ ok: false, error: TURNSTILE_TEST_UNREADABLE });
    if (keys.state === "incomplete") return c.json({ ok: false, error: TURNSTILE_TEST_NO_SECRET });
    candidate = keys.secret;
  }
  const result = await checkTurnstileSecret(candidate);
  if (result === "accepted") return c.json({ ok: true, message: TURNSTILE_TEST_OK });
  return c.json({ ok: false, error: result === "rejected" ? TURNSTILE_TEST_REJECTED : TURNSTILE_TEST_UNAVAILABLE });
}

/** DELETE /api/admin/registration/turnstile - removes both keys, which closes the form (unless bot protection is "not used"). */
export async function handleDeleteRegistrationTurnstile(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  const organizationId = await resolveInstanceOrganizationId(db, process.env);
  const answer = await db.$transaction(async (tx) => {
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
    return readTurnstileAnswer(tx);
  });
  return c.json(answer);
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

/**
 * GET /api/admin/registration/sso-provider - the identity provider guests sign in with (D-C4): its id (`provider_id`, null
 * for none), where the choice stands (`state`: `ready`, `not_selected`, `missing` for a provider that was deleted, `disabled`)
 * the providers that can be chosen (`providers`: the enabled OIDC providers, by id and display name) and the address the
 * provider must list as a redirect (`redirect_uri`, built from the address of the instance as the sign-in builds it; null while
 * the instance has none) and every such address (`redirect_uris`: the instance's, then one per own address of an event that uses
 * the sign-in, D-C6; `redirect_uri` stays for the screens that read one).
 */
export async function handleGetRegistrationSsoProvider(c: Context, db: PrismaClient, baseUrl: SsoBaseUrl): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  return c.json(await readSsoProvider(db, await readRedirectUri(baseUrl)));
}

/**
 * PUT /api/admin/registration/sso-provider - `{ "provider_id": "<id>" }` chooses the provider, `{ "provider_id": null }`
 * removes the choice. Only an enabled OIDC provider can be chosen (422 `provider_not_available`, whatever the reason). The
 * choice is audited with the ids before and after; a provider that is later disabled or deleted closes the form of the
 * events that use the sign-in and deletes nothing.
 */
export async function handlePutRegistrationSsoProvider(c: Context, db: PrismaClient, baseUrl: SsoBaseUrl): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  const parsed = await parseBody(c, ssoProviderPutSchema);
  if (parsed.response) return parsed.response;
  const next = parsed.data.provider_id;

  const organizationId = await resolveInstanceOrganizationId(db, process.env);
  // Outside the transaction: the address of the instance is read with its own queries.
  const redirectUri = await readRedirectUri(baseUrl);
  const answer = await db.$transaction(async (tx) => {
    if (next !== null && !(await listSelectableSsoProviders(tx)).some((provider) => provider.id === next)) return null;
    const previous = await getSsoProviderId(tx);
    await setSsoProviderId(tx, next);
    await writeAdminAuditLog(tx, {
      organizationId,
      actorUserId: actor.operator,
      sessionId: actor.sessionId,
      ip: actor.ip,
      timezone: actor.timezone,
      actionType: "registration_sso_provider_updated",
      // Ids only: the choice, not a field of the provider.
      metadata: { provider_id: next, previous_provider_id: previous },
    });
    return readSsoProvider(tx, redirectUri);
  });
  if (answer === null) return c.json({ error: "provider_not_available" }, 422);
  return c.json(answer);
}
