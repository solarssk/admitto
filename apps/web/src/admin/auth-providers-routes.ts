import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
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
} from "@admitto/auth";
import {
  getAdminPageSecurityHeaders,
  renderProviderList,
  renderProviderForm,
  parseMappingsFromForm,
  parseProviderInput,
  type MappingRow,
} from "./auth-providers-html.js";

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

async function mappingsForProvider(db: PrismaClient, providerId: string): Promise<MappingRow[]> {
  const rows = await listProviderGroupMappings(db, providerId);
  return rows.map((r) => ({
    group: r.group,
    role: r.role,
    scope_type: r.scope_type,
    scope_id: r.scope_id ?? "",
  }));
}

/** GET /admin/auth/providers */
export async function handleListProviders(c: Context, db: PrismaClient): Promise<Response> {
  const providers = await listOidcProviders(db);
  return htmlResponse(
    c,
    renderProviderList(
      providers.map((p) => ({
        id: p.id,
        display_name: p.display_name,
        issuer: p.issuer,
        enabled: p.enabled,
      })),
      flashFromQuery(c),
    ),
  );
}

/** GET /admin/auth/providers/new */
export function handleGetNewProvider(c: Context): Response {
  return htmlResponse(
    c,
    renderProviderForm({ isNew: true, mappings: [], flash: flashFromQuery(c) }),
  );
}

/** POST /admin/auth/providers/new */
export async function handlePostNewProvider(c: Context, db: PrismaClient): Promise<Response> {
  const form = await parseForm(c);
  const input = parseProviderInput(form);
  if (!input.display_name || !input.issuer || !input.client_id) {
    return htmlResponse(
      c,
      renderProviderForm({
        isNew: true,
        mappings: [],
        error: "Display name, issuer, and client ID are required.",
      }),
    );
  }
  try {
    const mappings = parseMappingsFromForm(form);
    const provider = await createIdentityProviderWithMappings(db, input, mappings);
    return c.redirect(`/admin/auth/providers/${provider.id}?flash=${encodeURIComponent("Provider created.")}`, 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create provider";
    return htmlResponse(c, renderProviderForm({ isNew: true, mappings: [], error: message }));
  }
}

/** GET /admin/auth/providers/:id */
export async function handleGetEditProvider(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.text("Not found", 404);
  const mappings = await mappingsForProvider(db, id);
  return htmlResponse(
    c,
    renderProviderForm({
      isNew: false,
      provider: toProviderFormView(provider),
      mappings,
      flash: flashFromQuery(c),
    }),
  );
}

/** POST /admin/auth/providers/:id */
export async function handlePostEditProvider(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.text("Not found", 404);

  const form = await parseForm(c);
  const input = parseProviderInput(form);
  if (!input.display_name || !input.issuer || !input.client_id) {
    const mappings = await mappingsForProvider(db, id);
    return htmlResponse(
      c,
      renderProviderForm({
        isNew: false,
        provider: toProviderFormView(provider),
        mappings,
        error: "Display name, issuer, and client ID are required.",
      }),
    );
  }

  try {
    const mappings = parseMappingsFromForm(form);
    await updateIdentityProviderWithMappings(db, id, input, mappings);
    return c.redirect(`/admin/auth/providers/${id}?flash=${encodeURIComponent("Provider saved.")}`, 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save provider";
    const mappings = await mappingsForProvider(db, id);
    return htmlResponse(
      c,
      renderProviderForm({
        isNew: false,
        provider: toProviderFormView(provider),
        mappings,
        error: message,
      }),
    );
  }
}

/** POST /admin/auth/providers/:id/discover */
export async function handlePostDiscover(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.text("Not found", 404);

  try {
    const discovery = await fetchOidcDiscovery(provider.issuer);
    await updateIdentityProvider(db, id, {
      display_name: provider.display_name,
      issuer: discovery.issuer,
      client_id: provider.client_id,
      authorization_endpoint: discovery.authorization_endpoint,
      token_endpoint: discovery.token_endpoint,
      jwks_uri: discovery.jwks_uri,
      userinfo_endpoint: discovery.userinfo_endpoint ?? undefined,
      enabled: provider.enabled,
    });
    return c.redirect(
      `/admin/auth/providers/${id}?flash=${encodeURIComponent("Discovery completed — endpoints updated.")}`,
      302,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery failed";
    return c.redirect(
      `/admin/auth/providers/${id}?flash=${encodeURIComponent(`Discovery failed: ${message}`)}`,
      302,
    );
  }
}

/** POST /admin/auth/providers/:id/test */
export async function handlePostTestConnection(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) return c.text("Not found", 404);

  const result = await testOidcConnection({
    issuer: provider.issuer,
    authorization_endpoint: provider.authorization_endpoint,
    token_endpoint: provider.token_endpoint,
    jwks_uri: provider.jwks_uri,
  });
  const flash = result.ok ? "Connection test OK." : `Connection test failed: ${result.error}`;
  return c.redirect(`/admin/auth/providers/${id}?flash=${encodeURIComponent(flash)}`, 302);
}

/** POST /admin/auth/providers/:id/toggle */
export async function handleToggleProvider(c: Context, db: PrismaClient): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const provider = await findOidcProviderById(db, id);
  if (!provider) {
    return c.redirect(
      `/admin/auth/providers?flash=${encodeURIComponent("Provider not found.")}`,
      302,
    );
  }
  await db.identityProvider.update({ where: { id }, data: { enabled: !provider.enabled } });
  const msg = provider.enabled ? "Provider disabled." : "Provider enabled.";
  return c.redirect(`/admin/auth/providers?flash=${encodeURIComponent(msg)}`, 302);
}
