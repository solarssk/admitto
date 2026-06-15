import type { GroupRoleMappingInput, IdentityProviderFormView } from "@admitto/auth";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getAdminPageSecurityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

export interface ProviderListItem {
  id: string;
  display_name: string;
  issuer: string;
  enabled: boolean;
}

export function renderProviderList(providers: ProviderListItem[], flash?: string): string {
  const rows =
    providers.length === 0
      ? "<p>No identity providers configured.</p>"
      : `<table><thead><tr><th>Name</th><th>Issuer</th><th>Status</th></tr></thead><tbody>${providers
          .map(
            (p) =>
              `<tr><td><a href="/admin/auth/providers/${esc(p.id)}">${esc(p.display_name)}</a></td><td>${esc(p.issuer)}</td><td>${p.enabled ? "Enabled" : "Disabled"}</td></tr>`,
          )
          .join("")}</tbody></table>`;

  const flashBlock = flash ? `<p class="flash" role="status">${esc(flash)}</p>` : "";

  return pageShell(
    "Identity providers",
    `${flashBlock}
    <p><a href="/admin/auth/providers/new">Add provider</a></p>
    ${rows}
    <p class="muted">Entra / SAML — coming soon</p>`,
  );
}

export interface MappingRow {
  group: string;
  role: string;
  scope_type: string;
  scope_id: string;
}

export function renderProviderForm(options: {
  provider?: IdentityProviderFormView;
  mappings: MappingRow[];
  flash?: string;
  error?: string;
  isNew: boolean;
}): string {
  const p = options.provider;
  const title = options.isNew ? "Add identity provider" : `Edit: ${p?.display_name ?? ""}`;
  const action = options.isNew ? "/admin/auth/providers/new" : `/admin/auth/providers/${esc(p!.id)}`;
  const secretHint = p?.has_client_secret
    ? '<p class="muted">Client secret is stored (••••). Leave blank to keep existing.</p>'
    : "";

  const mappingRows = options.mappings
    .map(
      (m, i) => `<tr>
        <td><input name="mapping_group_${i}" value="${esc(m.group)}"></td>
        <td><input name="mapping_role_${i}" value="${esc(m.role)}"></td>
        <td><input name="mapping_scope_type_${i}" value="${esc(m.scope_type)}"></td>
        <td><input name="mapping_scope_id_${i}" value="${esc(m.scope_id)}"></td>
      </tr>`,
    )
    .join("");

  const flashBlock = options.flash ? `<p class="flash">${esc(options.flash)}</p>` : "";
  const errorBlock = options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : "";

  const discoverAction =
    !options.isNew && p
      ? `<button type="submit" formaction="/admin/auth/providers/${esc(p.id)}/discover" formmethod="post" formnovalidate>Discover endpoints</button>`
      : "";

  const testAction =
    !options.isNew && p
      ? `<button type="submit" formaction="/admin/auth/providers/${esc(p.id)}/test" formmethod="post" formnovalidate style="margin-left:0.5rem">Test connection</button>`
      : "";

  return pageShell(
    title,
    `${flashBlock}${errorBlock}
    <form method="post" action="${action}">
      <label>Display name <input name="display_name" required value="${esc(p?.display_name ?? "")}"></label>
      <label>Issuer URL <input name="issuer" required value="${esc(p?.issuer ?? "")}"></label>
      ${discoverAction}${testAction}
      <label>Client ID <input name="client_id" required value="${esc(p?.client_id ?? "")}"></label>
      <label>Client secret <input type="password" name="client_secret" autocomplete="new-password" placeholder="Write-only"></label>
      ${secretHint}
      <label>Authorization endpoint <input name="authorization_endpoint" value="${esc(p?.authorization_endpoint ?? "")}"></label>
      <label>Token endpoint <input name="token_endpoint" value="${esc(p?.token_endpoint ?? "")}"></label>
      <label>JWKS URI <input name="jwks_uri" value="${esc(p?.jwks_uri ?? "")}"></label>
      <label>Userinfo endpoint <input name="userinfo_endpoint" value="${esc(p?.userinfo_endpoint ?? "")}"></label>
      <fieldset>
        <legend>Claim mapping</legend>
        <label>Email claim <input name="claim_email" value="${esc(p?.claim_email ?? "email")}"></label>
        <label>Name claim <input name="claim_name" value="${esc(p?.claim_name ?? "name")}"></label>
        <label>Groups claim <input name="claim_groups" value="${esc(p?.claim_groups ?? "groups")}"></label>
      </fieldset>
      <fieldset>
        <legend>Group → role mapping</legend>
        <table class="mapping"><thead><tr><th>Group</th><th>Role</th><th>Scope type</th><th>Scope ID</th></tr></thead>
        <tbody>${mappingRows}
        <tr>
          <td><input name="mapping_group_new" placeholder="admin-group"></td>
          <td><input name="mapping_role_new" placeholder="superadmin"></td>
          <td><input name="mapping_scope_type_new" placeholder="instance"></td>
          <td><input name="mapping_scope_id_new" placeholder=""></td>
        </tr>
        </tbody></table>
      </fieldset>
      <label><input type="checkbox" name="enabled" value="1" ${p?.enabled ? "checked" : ""}> Enabled</label>
      <button type="submit">Save</button>
    </form>
    <p><a href="/admin/auth/providers">Back to list</a></p>`,
  );
}

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} — Admitto</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #111; }
    label { display: block; margin-top: 0.75rem; font-size: 0.9rem; }
    input[type=text], input[type=password], input[type=url] { width: 100%; box-sizing: border-box; padding: 0.4rem; margin-top: 0.2rem; }
    fieldset { margin-top: 1rem; border: 1px solid #ddd; padding: 0.75rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    td input { width: 100%; box-sizing: border-box; }
    .error { color: #991b1b; background: #fee2e2; padding: 0.5rem; border-radius: 4px; }
    .flash { color: #065f46; background: #d1fae5; padding: 0.5rem; border-radius: 4px; }
    .muted { color: #666; font-size: 0.85rem; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  ${body}
</body>
</html>`;
}

export function parseMappingsFromForm(form: Record<string, string>): GroupRoleMappingInput[] {
  const mappings: GroupRoleMappingInput[] = [];
  const indices = new Set<number>();
  for (const key of Object.keys(form)) {
    const m = /^mapping_group_(\d+)$/.exec(key);
    if (m) indices.add(Number(m[1]));
  }
  for (const i of indices) {
    const group = form[`mapping_group_${i}`]?.trim();
    const role = form[`mapping_role_${i}`]?.trim();
    const scope_type = form[`mapping_scope_type_${i}`]?.trim();
    const scope_id = form[`mapping_scope_id_${i}`]?.trim();
    if (group && role && scope_type) {
      mappings.push({ group, role, scope_type, scope_id: scope_id || null });
    }
  }
  const ng = form["mapping_group_new"]?.trim();
  const nr = form["mapping_role_new"]?.trim();
  const nst = form["mapping_scope_type_new"]?.trim();
  const nsid = form["mapping_scope_id_new"]?.trim();
  if (ng && nr && nst) {
    mappings.push({ group: ng, role: nr, scope_type: nst, scope_id: nsid || null });
  }
  return mappings;
}

export function parseProviderInput(form: Record<string, string>): {
  display_name: string;
  issuer: string;
  client_id: string;
  client_secret?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
  claim_email?: string;
  claim_name?: string;
  claim_groups?: string;
  enabled: boolean;
} {
  return {
    display_name: form["display_name"]?.trim() ?? "",
    issuer: form["issuer"]?.trim() ?? "",
    client_id: form["client_id"]?.trim() ?? "",
    client_secret: form["client_secret"]?.trim() || undefined,
    authorization_endpoint: form["authorization_endpoint"]?.trim() || undefined,
    token_endpoint: form["token_endpoint"]?.trim() || undefined,
    jwks_uri: form["jwks_uri"]?.trim() || undefined,
    userinfo_endpoint: form["userinfo_endpoint"]?.trim() || undefined,
    claim_email: form["claim_email"]?.trim() || undefined,
    claim_name: form["claim_name"]?.trim() || undefined,
    claim_groups: form["claim_groups"]?.trim() || undefined,
    enabled: form["enabled"] === "1",
  };
}
