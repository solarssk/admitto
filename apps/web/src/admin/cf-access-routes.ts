import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import {
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
  logAuthSettingsChanged,
} from "@admitto/auth";
import { getAdminPageSecurityHeaders } from "./auth-providers-html.js";
import {
  renderCfAccessForm,
  parseCfAccessForm,
  type CfAccessFormView,
} from "./cf-access-html.js";

function htmlResponse(c: Context, html: string, status: 200 | 403 = 200): Response {
  for (const [name, value] of Object.entries(getAdminPageSecurityHeaders())) {
    c.header(name, value);
  }
  return c.html(html, status);
}

async function parseForm(c: Context): Promise<Record<string, string>> {
  const body = await c.req.parseBody();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function flashFromQuery(c: Context): string | undefined {
  return c.req.query("flash") ?? undefined;
}

function actorUserId(c: Context): string {
  return c.get("auth").userId;
}

async function buildFormView(prisma: PrismaClient): Promise<CfAccessFormView> {
  const config = await getCfAccessConfig(prisma);
  return {
    enabled: config.enabled,
    teamDomain: config.teamDomain,
    audience: JSON.stringify(config.audience),
    protectedPrefixes: JSON.stringify(config.protectedPrefixes),
    locks: {
      enabled: isSettingEnvLocked(SETTING_CF_ACCESS_ENABLED),
      teamDomain: isSettingEnvLocked(SETTING_CF_ACCESS_TEAM_DOMAIN),
      audience: isSettingEnvLocked(SETTING_CF_ACCESS_AUD),
      protectedPrefixes: isSettingEnvLocked(SETTING_CF_ACCESS_PROTECTED_PREFIXES),
    },
  };
}

async function resolveDraftFromForm(
  db: PrismaClient,
  parsed: ReturnType<typeof parseCfAccessForm>,
): Promise<{
  enabled: boolean;
  teamDomainRaw: string;
  audience: string[];
  protectedPrefixes: string[];
}> {
  const current = await getCfAccessConfig(db);
  return {
    enabled: isSettingEnvLocked(SETTING_CF_ACCESS_ENABLED) ? current.enabled : parsed.enabled,
    teamDomainRaw: isSettingEnvLocked(SETTING_CF_ACCESS_TEAM_DOMAIN)
      ? current.teamDomain
      : parsed.teamDomain,
    audience: isSettingEnvLocked(SETTING_CF_ACCESS_AUD) ? current.audience : parsed.audience,
    protectedPrefixes: isSettingEnvLocked(SETTING_CF_ACCESS_PROTECTED_PREFIXES)
      ? current.protectedPrefixes
      : parsed.protectedPrefixes,
  };
}

/** GET /admin/auth/cf-access */
export async function handleGetCfAccess(c: Context, db: PrismaClient): Promise<Response> {
  const form = await buildFormView(db);
  return htmlResponse(c, renderCfAccessForm({ form, flash: flashFromQuery(c) }));
}

/** POST /admin/auth/cf-access */
export async function handlePostCfAccess(c: Context, db: PrismaClient): Promise<Response> {
  let parsed: ReturnType<typeof parseCfAccessForm>;
  try {
    parsed = parseCfAccessForm(await parseForm(c));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid form";
    const form = await buildFormView(db);
    return htmlResponse(c, renderCfAccessForm({ form, error: message }));
  }

  const draft = await resolveDraftFromForm(db, parsed);

  let resolved;
  try {
    resolved = buildCfAccessConfigFromFields(draft);
    if (resolved.enabled) {
      validateCfAccessBootConfigFromResolved(resolved);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid configuration";
    const form = await buildFormView(db);
    return htmlResponse(c, renderCfAccessForm({ form, error: message }));
  }

  const wasEnabled = (await getCfAccessConfig(db)).enabled;

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
    const form = await buildFormView(db);
    return htmlResponse(c, renderCfAccessForm({ form, error: message }));
  }

  clearCfAccessRuntimeConfigCache();

  const settingsAction =
    wasEnabled === resolved.enabled ? "update" : resolved.enabled ? "enable" : "disable";

  logAuthSettingsChanged({
    actorUserId: actorUserId(c),
    resource: "cf_access",
    action: settingsAction,
  });

  return c.redirect("/admin/auth/cf-access?flash=Settings+saved", 302);
}

/** POST /admin/auth/cf-access/test */
export async function handlePostCfAccessTest(c: Context, db: PrismaClient): Promise<Response> {
  const form = await parseForm(c);
  const teamRaw = form["team_domain"]?.trim() ?? "";
  let teamDomain = "";
  try {
    teamDomain = teamRaw
      ? resolveCfAccessTeamDomainForConnection(teamRaw)
      : (await getCfAccessConfig(db)).teamDomain;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid team domain";
    const view = await buildFormView(db);
    return htmlResponse(c, renderCfAccessForm({ form: view, error: message }));
  }

  if (!teamDomain) {
    const view = await buildFormView(db);
    return htmlResponse(
      c,
      renderCfAccessForm({ form: view, error: "Team domain is required to test JWKS" }),
    );
  }

  const result = await testCfAccessConnection({ teamDomain });
  const view = await buildFormView(db);
  if (result.ok) {
    return htmlResponse(c, renderCfAccessForm({ form: view, flash: "JWKS connection OK" }));
  }
  return htmlResponse(c, renderCfAccessForm({ form: view, error: result.error }));
}
