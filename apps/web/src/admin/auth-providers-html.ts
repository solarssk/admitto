import type { GroupRoleMappingInput, IdentityProviderFormView } from "@admitto/auth";
import { DEFAULT_SSO_LOGIN_BUTTON_LABEL, resolveSsoLoginButtonLabel } from "@admitto/auth";
import { AUTH_PAGE_ICON_CSP, renderAdmittoFaviconLink } from "../favicon.js";
import { AUTH_SSO_BUTTON_ICON_SVG, renderAdminShell } from "../shared-auth-styles.js";

const ALLOWED_MAPPING_ROLES = ["superadmin", "admin", "operator"] as const;
const ALLOWED_SCOPE_TYPES = ["instance", "organization", "event"] as const;

/** Escape HTML special characters for server-rendered admin pages. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Security headers for server-rendered IdP admin HTML pages. */
export function getAdminPageSecurityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy": [
      "default-src 'none'",
      AUTH_PAGE_ICON_CSP,
      "style-src 'unsafe-inline' 'self'",
      "font-src 'self'",
      "img-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "connect-src 'self'",
      "script-src 'unsafe-inline'",
    ].join("; "),
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

/** Render a role `<select>`; invalid legacy roles require explicit replacement. */
function renderRoleSelect(name: string, currentRole: string): string {
  const isKnown = ALLOWED_MAPPING_ROLES.includes(currentRole as (typeof ALLOWED_MAPPING_ROLES)[number]);
  if (currentRole && !isKnown) {
    const options = ALLOWED_MAPPING_ROLES.map((role) => `<option value="${role}">${role}</option>`).join("");
    return `<p class="error" role="alert">Invalid role &quot;${esc(currentRole)}&quot; — choose a replacement before saving.</p>
    <select name="${esc(name)}" required>
      <option value="" selected disabled>Select role…</option>
      ${options}
    </select>`;
  }
  const options = ALLOWED_MAPPING_ROLES.map(
    (role) => `<option value="${role}"${role === currentRole ? " selected" : ""}>${role}</option>`,
  ).join("");
  return `<select name="${esc(name)}" required>${options}</select>`;
}

function renderScopeTypeSelect(name: string, currentScope: string): string {
  const scope = ALLOWED_SCOPE_TYPES.includes(currentScope as (typeof ALLOWED_SCOPE_TYPES)[number])
    ? currentScope
    : "instance";
  const options = ALLOWED_SCOPE_TYPES.map(
    (t) => `<option value="${t}"${t === scope ? " selected" : ""}>${t}</option>`,
  ).join("");
  return `<select name="${esc(name)}" required>${options}</select>`;
}

function renderMappingRow(m: MappingRow, index: number): string {
  return `<tr data-mapping-row>
        <td><input name="mapping_group_${index}" value="${esc(m.group)}" placeholder="IdP group name"></td>
        <td>${renderRoleSelect(`mapping_role_${index}`, m.role)}</td>
        <td>${renderScopeTypeSelect(`mapping_scope_type_${index}`, m.scope_type)}</td>
        <td><input name="mapping_scope_id_${index}" value="${esc(m.scope_id)}" placeholder="Org or event ID"></td>
        <td class="mapping-actions"><button type="button" class="mapping-remove-btn" data-mapping-remove>Remove</button></td>
      </tr>`;
}

/** Render the identity provider list page (`GET /admin/auth/providers`). */
export function renderProviderList(providers: ProviderListItem[], flash?: string): string {
  const rows =
    providers.length === 0
      ? "<p>No identity providers configured.</p>"
      : `<table><thead><tr><th>Name</th><th>Issuer</th><th>Status</th><th>Actions</th></tr></thead><tbody>${providers
          .map(
            (p) =>
              `<tr>
                <td><a href="/admin/auth/providers/${esc(p.id)}">${esc(p.display_name)}</a></td>
                <td>${esc(p.issuer)}</td>
                <td><span class="${p.enabled ? "badge-ok" : "badge-neutral"}">${p.enabled ? "Enabled" : "Disabled"}</span></td>
                <td>
                  <form method="post" action="/admin/auth/providers/${esc(p.id)}/toggle" style="display:inline">
                    <button type="submit" class="toggle-btn">${p.enabled ? "Disable" : "Enable"}</button>
                  </form>
                </td>
              </tr>`,
          )
          .join("")}</tbody></table>`;

  const flashBlock = flash ? `<p class="flash" role="status">${esc(flash)}</p>` : "";

  return pageShell(
    "Identity providers",
    `${flashBlock}
    <p class="admin-nav"><a href="/admin/auth/providers/new">Add provider</a> · <a href="/admin/auth/cf-access">Cloudflare Access</a></p>
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

const PROVIDER_FORM_SCRIPTS = `<script>
(function () {
  var defaultSsoLabel = ${JSON.stringify(DEFAULT_SSO_LOGIN_BUTTON_LABEL)};
  var labelInput = document.querySelector('input[name="login_button_label"]');
  var previewLabel = document.getElementById('sso-button-preview-label');
  if (labelInput && previewLabel) {
    function updateSsoPreview() {
      var value = labelInput.value.trim();
      previewLabel.textContent = value || defaultSsoLabel;
    }
    labelInput.addEventListener('input', updateSsoPreview);
    updateSsoPreview();
  }

  var tbody = document.getElementById('mapping-tbody');
  var addBtn = document.getElementById('mapping-add-btn');
  if (!tbody || !addBtn) return;

  var nextIndex = tbody.querySelectorAll('[data-mapping-row]').length;
  var roles = ${JSON.stringify([...ALLOWED_MAPPING_ROLES])};
  var scopes = ${JSON.stringify([...ALLOWED_SCOPE_TYPES])};

  function buildRoleSelect(name, selected) {
    return '<select name="' + name + '" required>' + roles.map(function (role) {
      return '<option value="' + role + '"' + (role === selected ? ' selected' : '') + '>' + role + '</option>';
    }).join('') + '</select>';
  }

  function buildScopeSelect(name, selected) {
    return '<select name="' + name + '" required>' + scopes.map(function (scope) {
      return '<option value="' + scope + '"' + (scope === selected ? ' selected' : '') + '>' + scope + '</option>';
    }).join('') + '</select>';
  }

  addBtn.addEventListener('click', function () {
    var index = nextIndex++;
    var row = document.createElement('tr');
    row.setAttribute('data-mapping-row', '');
    row.innerHTML =
      '<td><input name="mapping_group_' + index + '" placeholder="IdP group name"></td>' +
      '<td>' + buildRoleSelect('mapping_role_' + index, 'operator') + '</td>' +
      '<td>' + buildScopeSelect('mapping_scope_type_' + index, 'instance') + '</td>' +
      '<td><input name="mapping_scope_id_' + index + '" placeholder="Org or event ID"></td>' +
      '<td class="mapping-actions"><button type="button" class="mapping-remove-btn" data-mapping-remove>Remove</button></td>';
    tbody.appendChild(row);
  });

  tbody.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var removeBtn = target.closest('[data-mapping-remove]');
    if (!removeBtn) return;
    removeBtn.closest('tr')?.remove();
  });
})();
</script>`;

/** Render the create/edit identity provider form HTML. */
export function renderProviderForm(options: {
  provider?: IdentityProviderFormView;
  mappings: MappingRow[];
  flash?: string;
  error?: string;
  warning?: string;
  isNew: boolean;
}): string {
  const p = options.provider;
  const heading = options.isNew
    ? "Add identity provider"
    : `Edit: ${p?.display_name ?? ""}`;
  const action = options.isNew ? "/admin/auth/providers/new" : `/admin/auth/providers/${esc(p!.id)}`;
  const secretHint = p?.has_client_secret
    ? '<p class="muted">Client secret is stored (••••). Leave blank to keep existing.</p>'
    : "";

  const mappingRows = options.mappings.map((m, i) => renderMappingRow(m, i)).join("");
  const previewLabel = resolveSsoLoginButtonLabel(p?.login_button_label);

  const flashBlock = options.flash ? `<p class="flash">${esc(options.flash)}</p>` : "";
  const errorBlock = options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : "";
  const warningBlock = options.warning
    ? `<div class="warn-block" role="status">${esc(options.warning)}</div>`
    : "";

  const discoverAction =
    !options.isNew && p
      ? `<button type="submit" formaction="/admin/auth/providers/${esc(p.id)}/discover" formmethod="post" formnovalidate>Discover endpoints</button>`
      : "";

  const testAction =
    !options.isNew && p
      ? `<button type="submit" formaction="/admin/auth/providers/${esc(p.id)}/test" formmethod="post" formnovalidate style="margin-left:0.5rem">Test connection</button>`
      : "";

  return pageShell(
    heading,
    `${flashBlock}${warningBlock}${errorBlock}
    <form method="post" action="${action}">
      <label>Display name <input name="display_name" required value="${esc(p?.display_name ?? "")}"></label>
      <fieldset>
        <legend>Sign-in page (/login)</legend>
        <label>SSO button text <input name="login_button_label" maxlength="120" placeholder="Continue with SSO" value="${esc(p?.login_button_label ?? "")}"></label>
        <p class="muted">Label on the SSO button for this provider. Leave blank for the default &quot;Continue with SSO&quot;.</p>
        <div class="sso-preview" aria-live="polite">
          <span class="muted">Preview on /login</span>
          <span class="auth-btn-secondary auth-btn-sso sso-preview__btn" aria-hidden="true">
            ${AUTH_SSO_BUTTON_ICON_SVG}<span id="sso-button-preview-label">${esc(previewLabel)}</span>
          </span>
        </div>
      </fieldset>
      <label>Issuer URL <input type="url" name="issuer" required value="${esc(p?.issuer ?? "")}" placeholder="https://idp.example.com"></label>
      ${discoverAction}${testAction}
      <label>Client ID <input name="client_id" required value="${esc(p?.client_id ?? "")}"></label>
      <label>Client secret <input type="password" name="client_secret" autocomplete="new-password" placeholder="Write-only"></label>
      ${secretHint}
      <label>Authorization endpoint <input type="url" name="authorization_endpoint" value="${esc(p?.authorization_endpoint ?? "")}" placeholder="https://idp.example.com/oauth2/authorize"></label>
      <label>Token endpoint <input type="url" name="token_endpoint" value="${esc(p?.token_endpoint ?? "")}" placeholder="https://idp.example.com/oauth2/token"></label>
      <label>JWKS URI <input type="url" name="jwks_uri" value="${esc(p?.jwks_uri ?? "")}" placeholder="https://idp.example.com/.well-known/jwks.json"></label>
      <label>Userinfo endpoint <input type="url" name="userinfo_endpoint" value="${esc(p?.userinfo_endpoint ?? "")}" placeholder="https://idp.example.com/oauth2/userinfo"></label>
      <fieldset>
        <legend>Claim mapping</legend>
        <label>Email claim <input name="claim_email" value="${esc(p?.claim_email ?? "email")}"></label>
        <label>Name claim <input name="claim_name" value="${esc(p?.claim_name ?? "name")}"></label>
        <label>Groups claim <input name="claim_groups" value="${esc(p?.claim_groups ?? "groups")}"></label>
      </fieldset>
      <fieldset>
        <legend>Group → role mapping</legend>
        <p class="mapping-hint">Map an identity-provider group to an Admitto role. Use <code>instance</code> for superadmin, <code>organization</code> with an org ID, or <code>event</code> with an event ID.</p>
        <table class="mapping-table"><thead><tr><th>IdP group</th><th>Admitto role</th><th>Scope</th><th>Scope ID</th><th class="mapping-actions">Actions</th></tr></thead>
        <tbody id="mapping-tbody">${mappingRows}</tbody></table>
        <button type="button" id="mapping-add-btn" class="mapping-add-btn">Add mapping</button>
      </fieldset>
      <label><input type="checkbox" name="enabled" value="1" ${p?.enabled ? "checked" : ""}> Enabled</label>
      <button type="submit">Save</button>
    </form>
    <p class="admin-nav"><a href="/admin/auth/providers">Back to list</a></p>`,
    PROVIDER_FORM_SCRIPTS,
  );
}

/** Wrap admin page body in a shared HTML shell with full sidebar. */
function pageShell(heading: string, body: string, scripts = ""): string {
  return renderAdminShell({
    title: heading,
    body: `<h1>${esc(heading)}</h1>
${body}`,
    activeItem: "providers",
    favicon: renderAdmittoFaviconLink(),
    scripts,
  });
}

/** Collect numeric indices present in submitted mapping row fields. */
function mappingRowIndicesFromForm(form: Record<string, string>): number[] {
  const indices = new Set<number>();
  for (const key of Object.keys(form)) {
    const m = /^mapping_group_(\d+)$/.exec(key);
    if (m) indices.add(Number(m[1]));
  }
  return [...indices].sort((a, b) => a - b);
}

/** Parse group→role mapping rows from a submitted provider form. */
export function parseMappingsFromForm(form: Record<string, string>): GroupRoleMappingInput[] {
  const mappings: GroupRoleMappingInput[] = [];
  for (const i of mappingRowIndicesFromForm(form)) {
    const group = form[`mapping_group_${i}`]?.trim();
    const role = form[`mapping_role_${i}`]?.trim();
    const scope_type = form[`mapping_scope_type_${i}`]?.trim();
    const scope_id = form[`mapping_scope_id_${i}`]?.trim();
    if (group && role && scope_type) {
      mappings.push({ group, role, scope_type, scope_id: scope_id || null });
    }
  }
  return mappings;
}

/** Rehydrate mapping table rows from a submitted form (includes incomplete drafts). */
export function parseMappingRowsFromForm(form: Record<string, string>): MappingRow[] {
  const rows: MappingRow[] = [];
  for (const i of mappingRowIndicesFromForm(form)) {
    const group = form[`mapping_group_${i}`]?.trim() ?? "";
    const role = form[`mapping_role_${i}`]?.trim() ?? "";
    const scope_type = form[`mapping_scope_type_${i}`]?.trim() ?? "";
    const scope_id = form[`mapping_scope_id_${i}`]?.trim() ?? "";
    if (!group && !role && !scope_type && !scope_id) continue;
    rows.push({
      group,
      role: role || "operator",
      scope_type: scope_type || "instance",
      scope_id,
    });
  }
  return rows;
}

/** Warn when a partially filled mapping row will not be persisted. */
export function incompleteMappingRowsWarning(form: Record<string, string>): string | undefined {
  const incomplete = mappingRowIndicesFromForm(form).filter((i) => {
    const group = form[`mapping_group_${i}`]?.trim();
    const role = form[`mapping_role_${i}`]?.trim();
    const scope_type = form[`mapping_scope_type_${i}`]?.trim();
    const scope_id = form[`mapping_scope_id_${i}`]?.trim();
    const hasAny = Boolean(group || role || scope_type || scope_id);
    const isComplete = Boolean(group && role && scope_type);
    return hasAny && !isComplete;
  });
  if (incomplete.length === 0) return undefined;
  return "Some mapping rows are incomplete (group, role, and scope are required) and will not be saved until filled in.";
}

/** Build admin form view from a failed POST so field values and drafts are preserved. */
export function providerFormViewFromSubmitted(
  form: Record<string, string>,
  base?: IdentityProviderFormView,
): IdentityProviderFormView {
  const input = parseProviderInput(form);
  return {
    id: base?.id ?? "",
    provider_type: base?.provider_type ?? "oidc",
    display_name: input.display_name,
    issuer: input.issuer,
    client_id: input.client_id,
    has_client_secret: base?.has_client_secret ?? Boolean(input.client_secret),
    authorization_endpoint: input.authorization_endpoint ?? "",
    token_endpoint: input.token_endpoint ?? "",
    jwks_uri: input.jwks_uri ?? "",
    userinfo_endpoint: input.userinfo_endpoint ?? null,
    claim_email: input.claim_email ?? "email",
    claim_name: input.claim_name ?? "name",
    claim_groups: input.claim_groups ?? "groups",
    enabled: input.enabled,
    login_button_label: input.login_button_label || null,
  };
}

/** Parse provider metadata fields from a submitted create/edit form. */
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
  login_button_label?: string;
} {
  return {
    display_name: form["display_name"]?.trim() ?? "",
    login_button_label: form["login_button_label"]?.trim() ?? "",
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
