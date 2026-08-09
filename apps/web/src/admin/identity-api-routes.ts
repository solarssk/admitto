import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import {
  listOidcProviders,
  findOidcProviderById,
  createIdentityProviderWithMappings,
  updateIdentityProvider,
  updateIdentityProviderWithMappings,
  toProviderFormView,
  listProviderGroupMappings,
  fetchOidcDiscovery,
  testOidcConnection,
  assertSafeOidcFetchUrl,
  logAuthSettingsChanged,
  getCfAccessConfig,
  isSettingEnvLocked,
  setSetting,
  buildCfAccessConfigFromFields,
  validateCfAccessBootConfigFromResolved,
  clearCfAccessRuntimeConfigCache,
  resolveCfAccessTeamDomainForConnection,
  testCfAccessConnection,
  ensureCloudflareAccessProvider,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_PROTECTED_PREFIXES,
  type GroupRoleMappingInput,
  type IdentityProviderFormView,
  type IdentityProviderInput,
} from "@admitto/auth";
import { writeAdminAuditLogBestEffort } from "@admitto/tickets";
import { emitSystemLog, recordSystemLog } from "@admitto/shared/system-log";
import { adminAuditFromContext } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import { resolveOidcRedirectUri } from "./oidc-redirect-uri.js";

const MAPPING_ROLE = z.enum(["superadmin", "admin", "operator"]);
const MAPPING_SCOPE = z.enum(["instance", "organization", "event"]);

const mappingSchema = z
  .object({
    group: z.string().trim().min(1).max(200),
    role: MAPPING_ROLE,
    scope_type: MAPPING_SCOPE,
    scope_id: z.union([z.string().trim().max(200), z.null()]).optional(),
  })
  .refine(
    (m) =>
      m.scope_type === "instance" ||
      (typeof m.scope_id === "string" && m.scope_id.trim().length > 0),
    { message: "scope_id is required for organization/event scoped mappings", path: ["scope_id"] },
  );

const providerBodySchema = z.strictObject({
  display_name: z.string().trim().min(1).max(200),
  issuer: z.string().trim().min(1).max(2000),
  client_id: z.string().trim().min(1).max(500),
  client_secret: z.string().max(2000).optional(),
  authorization_endpoint: z.string().trim().max(2000).optional(),
  token_endpoint: z.string().trim().max(2000).optional(),
  jwks_uri: z.string().trim().max(2000).optional(),
  userinfo_endpoint: z.string().trim().max(2000).optional(),
  claim_email: z.string().trim().max(200).optional(),
  claim_name: z.string().trim().max(200).optional(),
  claim_groups: z.string().trim().max(200).optional(),
  claim_given_name: z.string().trim().max(200).optional(),
  claim_family_name: z.string().trim().max(200).optional(),
  claim_phone: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
  /**
   * SSO login button copy. Omit to preserve the stored value; send `null` or `""`
   * to clear back to the product default; send a string to set.
   */
  login_button_label: z.union([z.string().trim().max(120), z.null()]).optional(),
  /**
   * Group→role mapping list (replace-all semantics, mirroring the legacy HTML form).
   * Optional on create (defaults to an empty list); **required on every PUT** — the
   * update handler rejects the request with `mappings_required` when it is omitted,
   * so editing other fields can never silently delete every mapping. Send the
   * current list (from GET /:id) unchanged when editing other fields.
   */
  mappings: z.array(mappingSchema).optional(),
});

const oidcProviderTestBodySchema = z.strictObject({
  issuer: z.string().trim().min(1).max(2000),
  authorization_endpoint: z.string().trim().max(2000).optional(),
  token_endpoint: z.string().trim().max(2000).optional(),
  jwks_uri: z.string().trim().max(2000).optional(),
  userinfo_endpoint: z.string().trim().max(2000).optional(),
});

const oidcDiscoverPreviewBodySchema = z.strictObject({
  issuer: z.string().trim().min(1).max(2000),
});

function optionalOidcEndpoint(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** Accept an array of strings or a comma/JSON string and return a clean string array. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  const raw = value.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      /* fall through to comma split */
    }
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const cfAccessBodySchema = z.strictObject({
  enabled: z.boolean().optional(),
  teamDomain: z.union([z.string().trim().max(2000), z.literal("")]).optional(),
  audience: z.union([z.array(z.string()), z.string()]).optional(),
  protectedPrefixes: z.union([z.array(z.string()), z.string()]).optional(),
});

const cfAccessTestBodySchema = z.strictObject({
  teamDomain: z.union([z.string().trim().max(2000), z.literal("")]).optional(),
});

interface ProviderDetailDto extends IdentityProviderFormView {
  mappings: { group: string; role: string; scope_type: string; scope_id: string }[];
  /** Exact OIDC callback URL to register at the IdP; null when no public base URL is resolvable. */
  redirect_uri: string | null;
}

function actorUserId(c: Context): string {
  return c.get("auth").userId;
}

/** Record only a stable failure category for superadmin identity work. External OIDC/CF values
 * and exception text may be attacker-controlled or sensitive configuration, so never enter the
 * System logs buffer. */
function recordIdentityFailure(
  c: Context,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  recordSystemLog({
    level: "warn",
    source: "security",
    message,
    fields: { actorUserId: actorUserId(c), errorKind: "unexpected", ...fields },
  });
}

/** Same safe shape for failures that previously had no stdout signal at all. */
function emitIdentityFailure(
  c: Context,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  emitSystemLog("security", "warn", message, {
    actorUserId: actorUserId(c),
    errorKind: "unexpected",
    ...fields,
  });
}

function toMappingInput(m: z.infer<typeof mappingSchema>): GroupRoleMappingInput {
  return {
    group: m.group,
    role: m.role,
    scope_type: m.scope_type,
    scope_id: m.scope_id ?? null,
  };
}

function toProviderInput(body: z.infer<typeof providerBodySchema>): IdentityProviderInput {
  return {
    display_name: body.display_name,
    issuer: body.issuer,
    client_id: body.client_id,
    client_secret: body.client_secret?.trim() || undefined,
    authorization_endpoint: body.authorization_endpoint?.trim() || undefined,
    token_endpoint: body.token_endpoint?.trim() || undefined,
    jwks_uri: body.jwks_uri?.trim() || undefined,
    userinfo_endpoint: body.userinfo_endpoint?.trim() || undefined,
    claim_email: body.claim_email?.trim() || undefined,
    claim_name: body.claim_name?.trim() || undefined,
    claim_groups: body.claim_groups?.trim() || undefined,
    claim_given_name: body.claim_given_name?.trim() || undefined,
    claim_family_name: body.claim_family_name?.trim() || undefined,
    claim_phone: body.claim_phone?.trim() || undefined,
    enabled: body.enabled,
    // undefined preserves the stored label (auth layer); null/"" clears to default.
    login_button_label:
      body.login_button_label === undefined
        ? undefined
        : body.login_button_label?.trim() || null,
  };
}

async function providerDetailDto(
  db: PrismaClient,
  provider: NonNullable<Awaited<ReturnType<typeof findOidcProviderById>>>,
  injectedBaseUrl?: string,
): Promise<ProviderDetailDto> {
  const rows = await listProviderGroupMappings(db, provider.id);
  return {
    ...toProviderFormView(provider),
    mappings: rows.map((r) => ({
      group: r.group,
      role: r.role,
      scope_type: r.scope_type,
      scope_id: r.scope_id ?? "",
    })),
    redirect_uri: await resolveOidcRedirectUri(db, provider.id, injectedBaseUrl),
  };
}

/** GET /api/admin/identity/providers */
export async function handleApiListProviders(c: Context, db: PrismaClient): Promise<Response> {
  const providers = await listOidcProviders(db);
  return c.json({
    providers: providers.map((p) => ({
      id: p.id,
      display_name: p.display_name,
      issuer: p.issuer,
      enabled: p.enabled,
    })),
  });
}

/** GET /api/admin/identity/providers/:id */
export async function handleApiGetProvider(
  c: Context,
  db: PrismaClient,
  injectedBaseUrl?: string,
): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.json({ error: "not_found" }, 404);
  return c.json(await providerDetailDto(db, provider, injectedBaseUrl));
}

/** POST /api/admin/identity/providers */
export async function handleApiCreateProvider(
  c: Context,
  db: PrismaClient,
  injectedBaseUrl?: string,
): Promise<Response> {
  let body: z.infer<typeof providerBodySchema>;
  try {
    body = providerBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  let provider;
  try {
    provider = await createIdentityProviderWithMappings(
      db,
      toProviderInput(body),
      (body.mappings ?? []).map(toMappingInput),
    );
  } catch (err) {
    console.error("[identity] create provider failed:", err);
    recordIdentityFailure(c, "oidc_provider_save_failed", { operation: "create" });
    return c.json({ error: "save_failed" }, 500);
  }

  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "oidc_provider",
    action: "create",
    targetId: provider.id,
  });
  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLogBestEffort(db, {
    organizationId: orgId,
    actorUserId: actorUserId(c),
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "identity_provider_created",
    metadata: { providerId: provider.id, displayName: provider.display_name },
  });
  return c.json(await providerDetailDto(db, provider, injectedBaseUrl), 201);
}

/** PUT /api/admin/identity/providers/:id */
export async function handleApiUpdateProvider(
  c: Context,
  db: PrismaClient,
  injectedBaseUrl?: string,
): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.json({ error: "not_found" }, 404);

  let body: z.infer<typeof providerBodySchema>;
  try {
    body = providerBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }
  // PUT is replace-all: the client must send the full mapping list. Omitting it
  // would silently delete every group→role mapping, so reject explicitly.
  if (!body.mappings) {
    return c.json({ error: "mappings_required" }, 400);
  }

  let updated;
  try {
    updated = await updateIdentityProviderWithMappings(db, id, toProviderInput(body), body.mappings.map(toMappingInput));
  } catch (err) {
    console.error("[identity] update provider failed:", err);
    recordIdentityFailure(c, "oidc_provider_save_failed", { providerId: id, operation: "update" });
    return c.json({ error: "save_failed" }, 500);
  }

  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "oidc_provider",
    action: "update",
    targetId: id,
  });
  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLogBestEffort(db, {
    organizationId: orgId,
    actorUserId: actorUserId(c),
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "identity_provider_updated",
    metadata: { providerId: id },
  });
  return c.json(await providerDetailDto(db, updated, injectedBaseUrl));
}

/** POST /api/admin/identity/providers/:id/toggle */
export async function handleApiToggleProvider(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.json({ error: "not_found" }, 404);

  // Atomic conditional update: only flip when the row still matches the value we
  // read. Two concurrent toggles can't both succeed — the loser affects 0 rows and
  // gets a 409 so the client can refetch, avoiding a silent lost toggle (TOCTOU).
  const intended = !provider.enabled;
  const result = await db.identityProvider.updateMany({
    where: { id, enabled: provider.enabled },
    data: { enabled: intended },
  });
  if (result.count === 0) {
    return c.json({ error: "toggle_race" }, 409);
  }
  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "oidc_provider",
    action: provider.enabled ? "disable" : "enable",
    targetId: id,
  });
  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLogBestEffort(db, {
    organizationId: orgId,
    actorUserId: actorUserId(c),
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "identity_provider_toggled",
    metadata: { providerId: id, enabled: intended },
  });
  return c.json({ id, enabled: intended });
}

/** POST /api/admin/identity/providers/:id/discover */
export async function handleApiDiscoverProvider(
  c: Context,
  db: PrismaClient,
  injectedBaseUrl?: string,
): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.json({ error: "not_found" }, 404);

  let discovery;
  try {
    discovery = await fetchOidcDiscovery(provider.issuer);
  } catch (err) {
    console.warn("[identity] OIDC discovery failed:", err);
    recordIdentityFailure(c, "oidc_provider_discover_failed", { providerId: id });
    return c.json({ ok: false, error: "discovery_failed" }, 400);
  }

  try {
    await updateIdentityProvider(db, id, {
      display_name: provider.display_name,
      login_button_label: provider.login_button_label,
      issuer: discovery.issuer,
      client_id: provider.client_id,
      authorization_endpoint: discovery.authorization_endpoint,
      token_endpoint: discovery.token_endpoint,
      jwks_uri: discovery.jwks_uri,
      userinfo_endpoint: discovery.userinfo_endpoint ?? undefined,
      enabled: provider.enabled,
    });
  } catch (err) {
    console.error("[identity] persist discovery failed:", err);
    recordIdentityFailure(c, "oidc_provider_discover_failed", { providerId: id });
    return c.json({ ok: false, error: "save_failed" }, 500);
  }

  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "oidc_provider",
    action: "discover",
    targetId: id,
  });
  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLogBestEffort(db, {
    organizationId: orgId,
    actorUserId: actorUserId(c),
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "identity_provider_discovered",
    metadata: { providerId: id },
  });

  const refreshed = await findOidcProviderById(db, id);
  return c.json({
    ok: true,
    endpoints: {
      issuer: discovery.issuer,
      authorization_endpoint: discovery.authorization_endpoint,
      token_endpoint: discovery.token_endpoint,
      jwks_uri: discovery.jwks_uri,
      userinfo_endpoint: discovery.userinfo_endpoint ?? null,
    },
    provider: refreshed ? await providerDetailDto(db, refreshed, injectedBaseUrl) : null,
  });
}

/** POST /api/admin/identity/providers/test — probe endpoints from a draft (no persist). */
export async function handleApiTestProviderDraft(c: Context): Promise<Response> {
  let body: z.infer<typeof oidcProviderTestBodySchema>;
  try {
    body = oidcProviderTestBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const issuer = body.issuer.trim();
  try {
    // Mirror the same guard resolveEndpoints applies on save: issuer must be a safe HTTPS URL.
    assertSafeOidcFetchUrl(issuer.endsWith("/") ? issuer : `${issuer}/`);
  } catch {
    return c.json({ ok: false, error: "invalid_issuer" }, 400);
  }
  const auth = optionalOidcEndpoint(body.authorization_endpoint);
  const token = optionalOidcEndpoint(body.token_endpoint);
  const jwks = optionalOidcEndpoint(body.jwks_uri);
  const userinfo = optionalOidcEndpoint(body.userinfo_endpoint);
  const result = await testOidcConnection({
    issuer,
    ...(auth && token && jwks ? { authorization_endpoint: auth, token_endpoint: token, jwks_uri: jwks } : {}),
    ...(userinfo ? { userinfo_endpoint: userinfo } : {}),
  });
  if (!result.ok) emitIdentityFailure(c, "oidc_test_connection_failed", { flow: "draft" });
  return c.json({ ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
}

/** POST /api/admin/identity/providers/discover-preview — autofill endpoints without persist. */
export async function handleApiDiscoverProviderPreview(c: Context): Promise<Response> {
  let body: z.infer<typeof oidcDiscoverPreviewBodySchema>;
  try {
    body = oidcDiscoverPreviewBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  try {
    const discovery = await fetchOidcDiscovery(body.issuer.trim());
    return c.json({
      ok: true,
      endpoints: {
        issuer: discovery.issuer,
        authorization_endpoint: discovery.authorization_endpoint,
        token_endpoint: discovery.token_endpoint,
        jwks_uri: discovery.jwks_uri,
        userinfo_endpoint: discovery.userinfo_endpoint ?? null,
      },
    });
  } catch (err) {
    console.warn("[identity] discovery preview failed:", err);
    recordIdentityFailure(c, "oidc_provider_discover_failed", { flow: "draft" });
    return c.json({ ok: false, error: "discovery_failed" }, 400);
  }
}

/** POST /api/admin/identity/providers/:id/test */
export async function handleApiTestProvider(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.json({ error: "not_found" }, 404);

  const result = await testOidcConnection({
    issuer: provider.issuer,
    authorization_endpoint: provider.authorization_endpoint,
    token_endpoint: provider.token_endpoint,
    jwks_uri: provider.jwks_uri,
  });
  if (result.ok) return c.json({ ok: true });
  emitIdentityFailure(c, "oidc_test_connection_failed", { providerId: id });
  return c.json({ ok: false, error: result.error }, 400);
}

interface CfAccessDto {
  enabled: boolean;
  teamDomain: string;
  audience: string[];
  protectedPrefixes: string[];
  locks: {
    enabled: boolean;
    teamDomain: boolean;
    audience: boolean;
    protectedPrefixes: boolean;
  };
}

async function cfAccessDto(db: PrismaClient): Promise<CfAccessDto> {
  const config = await getCfAccessConfig(db);
  return {
    enabled: config.enabled,
    teamDomain: config.teamDomain,
    audience: config.audience,
    protectedPrefixes: config.protectedPrefixes,
    locks: {
      enabled: isSettingEnvLocked(SETTING_CF_ACCESS_ENABLED),
      teamDomain: isSettingEnvLocked(SETTING_CF_ACCESS_TEAM_DOMAIN),
      audience: isSettingEnvLocked(SETTING_CF_ACCESS_AUD),
      protectedPrefixes: isSettingEnvLocked(SETTING_CF_ACCESS_PROTECTED_PREFIXES),
    },
  };
}

/** GET /api/admin/identity/cf-access */
export async function handleApiGetCfAccess(c: Context, db: PrismaClient): Promise<Response> {
  return c.json(await cfAccessDto(db));
}

/** PUT /api/admin/identity/cf-access */
export async function handleApiUpdateCfAccess(c: Context, db: PrismaClient): Promise<Response> {
  let body: z.infer<typeof cfAccessBodySchema>;
  try {
    body = cfAccessBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const current = await getCfAccessConfig(db);
  const enabled = isSettingEnvLocked(SETTING_CF_ACCESS_ENABLED) ? current.enabled : (body.enabled ?? current.enabled);
  const teamDomain = isSettingEnvLocked(SETTING_CF_ACCESS_TEAM_DOMAIN)
    ? current.teamDomain
    : (body.teamDomain?.trim() ?? current.teamDomain);
  const audienceOverride =
    body.audience !== undefined ? toStringArray(body.audience) : current.audience;
  const audience = isSettingEnvLocked(SETTING_CF_ACCESS_AUD) ? current.audience : audienceOverride;
  const protectedPrefixesOverride =
    body.protectedPrefixes !== undefined
      ? toStringArray(body.protectedPrefixes)
      : current.protectedPrefixes;
  const protectedPrefixes = isSettingEnvLocked(SETTING_CF_ACCESS_PROTECTED_PREFIXES)
    ? current.protectedPrefixes
    : protectedPrefixesOverride;

  let resolved;
  try {
    resolved = buildCfAccessConfigFromFields({ enabled, teamDomainRaw: teamDomain, audience, protectedPrefixes });
    if (resolved.enabled) {
      validateCfAccessBootConfigFromResolved(resolved);
    }
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  const wasEnabled = current.enabled;
  try {
    await db.$transaction(async (tx) => {
      if (!isSettingEnvLocked(SETTING_CF_ACCESS_ENABLED)) {
        await setSetting(tx, SETTING_CF_ACCESS_ENABLED, resolved.enabled);
      }
      if (!isSettingEnvLocked(SETTING_CF_ACCESS_TEAM_DOMAIN)) {
        await setSetting(tx, SETTING_CF_ACCESS_TEAM_DOMAIN, resolved.teamDomain);
      }
      if (!isSettingEnvLocked(SETTING_CF_ACCESS_AUD)) {
        await setSetting(tx, SETTING_CF_ACCESS_AUD, resolved.audience);
      }
      if (!isSettingEnvLocked(SETTING_CF_ACCESS_PROTECTED_PREFIXES)) {
        await setSetting(tx, SETTING_CF_ACCESS_PROTECTED_PREFIXES, resolved.protectedPrefixes);
      }
      await ensureCloudflareAccessProvider(tx, resolved);
    });
  } catch (err) {
    console.error("[identity] CF Access save failed:", err);
    recordIdentityFailure(c, "cf_access_save_failed");
    return c.json({ error: "save_failed" }, 500);
  }

  clearCfAccessRuntimeConfigCache();

  const enabledChangeAction = resolved.enabled ? "enable" : "disable";
  const settingsAction = wasEnabled === resolved.enabled ? "update" : enabledChangeAction;
  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "cf_access",
    action: settingsAction,
  });
  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLogBestEffort(db, {
    organizationId: orgId,
    actorUserId: actorUserId(c),
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "identity_cf_access_updated",
    metadata: { action: settingsAction },
  });

  return c.json(await cfAccessDto(db));
}

/** POST /api/admin/identity/cf-access/test */
export async function handleApiTestCfAccess(c: Context, db: PrismaClient): Promise<Response> {
  let body: z.infer<typeof cfAccessTestBodySchema> | undefined;
  try {
    body = cfAccessTestBodySchema.parse(await c.req.json().catch(() => ({})));
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  let teamDomain = "";
  try {
    teamDomain = body.teamDomain?.trim()
      ? resolveCfAccessTeamDomainForConnection(body.teamDomain.trim())
      : (await getCfAccessConfig(db)).teamDomain;
  } catch {
    return c.json({ ok: false, error: "invalid_team_domain" }, 400);
  }

  if (!teamDomain) {
    return c.json({ ok: false, error: "team_domain_required" }, 400);
  }

  const result = await testCfAccessConnection({ teamDomain });
  if (result.ok) return c.json({ ok: true });
  emitIdentityFailure(c, "cf_access_test_failed");
  return c.json({ ok: false, error: result.error }, 400);
}
