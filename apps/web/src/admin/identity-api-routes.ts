import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
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

const MAPPING_ROLE = z.enum(["superadmin", "admin", "operator"]);
const MAPPING_SCOPE = z.enum(["instance", "organization", "event"]);

const mappingSchema = z.object({
  group: z.string().trim().min(1).max(200),
  role: MAPPING_ROLE,
  scope_type: MAPPING_SCOPE,
  scope_id: z.union([z.string().trim().max(200), z.null()]).optional(),
});

const providerBodySchema = z
  .object({
    display_name: z.string().trim().min(1).max(200),
    issuer: z.string().trim().min(1).max(2000),
    client_id: z.string().trim().min(1).max(500),
    client_secret: z.string().max(2000).optional(),
    authorization_endpoint: z.union([z.string().trim().max(2000), z.literal("")]).optional(),
    token_endpoint: z.union([z.string().trim().max(2000), z.literal("")]).optional(),
    jwks_uri: z.union([z.string().trim().max(2000), z.literal("")]).optional(),
    userinfo_endpoint: z.union([z.string().trim().max(2000), z.literal("")]).optional(),
    claim_email: z.union([z.string().trim().max(200), z.literal("")]).optional(),
    claim_name: z.union([z.string().trim().max(200), z.literal("")]).optional(),
    claim_groups: z.union([z.string().trim().max(200), z.literal("")]).optional(),
    enabled: z.boolean().optional(),
    login_button_label: z.union([z.string().trim().max(120), z.literal(""), z.null()]).optional(),
    mappings: z.array(mappingSchema).optional(),
  })
  .strict();

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

const cfAccessBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    teamDomain: z.union([z.string().trim().max(2000), z.literal("")]).optional(),
    audience: z.union([z.array(z.string()), z.string()]).optional(),
    protectedPrefixes: z.union([z.array(z.string()), z.string()]).optional(),
  })
  .strict();

const cfAccessTestBodySchema = z
  .object({
    teamDomain: z.union([z.string().trim().max(2000), z.literal("")]).optional(),
  })
  .strict();

interface ProviderDetailDto extends IdentityProviderFormView {
  mappings: { group: string; role: string; scope_type: string; scope_id: string }[];
}

function actorUserId(c: Context): string {
  return c.get("auth").userId;
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
    enabled: body.enabled,
    login_button_label: body.login_button_label?.trim() || null,
  };
}

async function providerDetailDto(
  db: PrismaClient,
  provider: NonNullable<Awaited<ReturnType<typeof findOidcProviderById>>>,
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
export async function handleApiGetProvider(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.json({ error: "not_found" }, 404);
  return c.json(await providerDetailDto(db, provider));
}

/** POST /api/admin/identity/providers */
export async function handleApiCreateProvider(c: Context, db: PrismaClient): Promise<Response> {
  let body: z.infer<typeof providerBodySchema>;
  try {
    body = providerBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  let provider;
  try {
    const mappings = (body.mappings ?? []).map(toMappingInput);
    provider = await createIdentityProviderWithMappings(db, toProviderInput(body), mappings);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create provider";
    return c.json({ error: message }, 400);
  }

  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "oidc_provider",
    action: "create",
    targetId: provider.id,
  });
  return c.json(await providerDetailDto(db, provider), 201);
}

/** PUT /api/admin/identity/providers/:id */
export async function handleApiUpdateProvider(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.json({ error: "not_found" }, 404);

  let body: z.infer<typeof providerBodySchema>;
  try {
    body = providerBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "validation_failed" }, 400);
  }

  let updated;
  try {
    const mappings = (body.mappings ?? []).map(toMappingInput);
    updated = await updateIdentityProviderWithMappings(db, id, toProviderInput(body), mappings);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save provider";
    return c.json({ error: message }, 400);
  }

  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "oidc_provider",
    action: "update",
    targetId: id,
  });
  return c.json(await providerDetailDto(db, updated));
}

/** POST /api/admin/identity/providers/:id/toggle */
export async function handleApiToggleProvider(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.json({ error: "not_found" }, 404);

  await db.identityProvider.update({ where: { id }, data: { enabled: !provider.enabled } });
  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "oidc_provider",
    action: provider.enabled ? "disable" : "enable",
    targetId: id,
  });
  return c.json({ id, enabled: !provider.enabled });
}

/** POST /api/admin/identity/providers/:id/discover */
export async function handleApiDiscoverProvider(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.json({ error: "not_found" }, 404);

  let discovery;
  try {
    discovery = await fetchOidcDiscovery(provider.issuer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery failed";
    return c.json({ ok: false, error: message }, 400);
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
    const message = err instanceof Error ? err.message : "Failed to persist discovery";
    return c.json({ ok: false, error: message }, 400);
  }

  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "oidc_provider",
    action: "discover",
    targetId: id,
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
    provider: refreshed ? await providerDetailDto(db, refreshed) : null,
  });
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
  const audience = isSettingEnvLocked(SETTING_CF_ACCESS_AUD)
    ? current.audience
    : (body.audience !== undefined ? toStringArray(body.audience) : current.audience);
  const protectedPrefixes = isSettingEnvLocked(SETTING_CF_ACCESS_PROTECTED_PREFIXES)
    ? current.protectedPrefixes
    : (body.protectedPrefixes !== undefined ? toStringArray(body.protectedPrefixes) : current.protectedPrefixes);

  let resolved;
  try {
    resolved = buildCfAccessConfigFromFields({ enabled, teamDomainRaw: teamDomain, audience, protectedPrefixes });
    if (resolved.enabled) {
      validateCfAccessBootConfigFromResolved(resolved);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid configuration";
    return c.json({ error: message }, 400);
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
    const message = err instanceof Error ? err.message : "Save failed";
    return c.json({ error: message }, 400);
  }

  clearCfAccessRuntimeConfigCache();

  const settingsAction =
    wasEnabled === resolved.enabled ? "update" : resolved.enabled ? "enable" : "disable";
  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "cf_access",
    action: settingsAction,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid team domain";
    return c.json({ ok: false, error: message }, 400);
  }

  if (!teamDomain) {
    return c.json({ ok: false, error: "Team domain is required to test connection" }, 400);
  }

  const result = await testCfAccessConnection({ teamDomain });
  if (result.ok) return c.json({ ok: true });
  return c.json({ ok: false, error: result.error }, 400);
}
