import {
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_PROTECTED_PREFIXES,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
} from "@admitto/auth";
import { renderAdmittoFaviconLink } from "../favicon.js";
import { renderAdminShell } from "../shared-auth-styles.js";

/** Escape HTML special characters for server-rendered admin pages. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface CfAccessFormFieldLocks {
  enabled: boolean;
  teamDomain: boolean;
  audience: boolean;
  protectedPrefixes: boolean;
}

export interface CfAccessFormView {
  enabled: boolean;
  teamDomain: string;
  audience: string;
  protectedPrefixes: string;
  locks: CfAccessFormFieldLocks;
}

/** Render the Cloudflare Access settings page (`GET /admin/auth/cf-access`). */
export function renderCfAccessForm(options: {
  form: CfAccessFormView;
  flash?: string;
  error?: string;
}): string {
  const f = options.form;
  const flashBlock = options.flash ? `<p class="flash">${esc(options.flash)}</p>` : "";
  const errorBlock = options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : "";

  const lockBadge = (locked: boolean) =>
    locked ? ' <span class="muted">(locked by env)</span>' : "";

  const disabled = (locked: boolean) => (locked ? " disabled" : "");

  const statusBadge = f.enabled
    ? '<span class="badge-ok">Active</span>'
    : '<span class="badge-neutral">Inactive</span>';

  const enabledWarning =
    f.enabled && !f.locks.enabled
      ? `<div class="warn-block" role="alert"><strong>Before you enable:</strong> run <strong>Test connection</strong> with your team URL. A wrong application token or team URL can block staff sign-in until you fix the values or use a local break-glass account.</div>`
      : "";

  const envLockedWarning = f.enabled && f.locks.enabled
    ? `<div class="info-block">Cloudflare Access is enabled and locked by environment configuration.</div>`
    : "";

  const fallthroughInfo = `<div class="info-block"><strong>How staff sign-in works:</strong> When Cloudflare sends a valid Access JWT, Admitto trusts it for protected admin paths. When no JWT is present (direct URL, local network, or break-glass), Admitto shows the normal email/password login. Local superadmin accounts always remain available as a fallback.</div>`;

  return pageShell(
    "Cloudflare Access",
    `${flashBlock}${errorBlock}
    <p class="status-line">CF Access: ${statusBadge}</p>
    ${fallthroughInfo}
    ${enabledWarning}
    ${envLockedWarning}
    <form method="post" action="/admin/auth/cf-access">
      <label>
        <input type="checkbox" name="enabled" value="1"${f.enabled ? " checked" : ""}${disabled(f.locks.enabled)}>
        Enable Cloudflare Access for protected admin paths${lockBadge(f.locks.enabled)}
      </label>
      <label>
        Cloudflare team URL
        <input name="team_domain" type="url" placeholder="https://yourteam.cloudflareaccess.com" value="${esc(f.teamDomain)}"${disabled(f.locks.teamDomain)}>
        <span class="field-hint">Zero Trust → Settings → Custom Pages. Paste the team URL (issuer), not the application hostname.</span>
        ${lockBadge(f.locks.teamDomain)}
      </label>
      <label>
        Application token (AUD)
        <input name="audience" placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890" value="${esc(f.audience)}"${disabled(f.locks.audience)}>
        <span class="field-hint">Zero Trust → Access → Applications → your app → Overview → <strong>Application Audience (AUD) Tag</strong>. One value, or comma-separated / JSON array for multiple apps.</span>
        ${lockBadge(f.locks.audience)}
      </label>
      <label>
        Protected URL paths
        <input name="protected_prefixes" placeholder="/admin, /api/admin" value="${esc(f.protectedPrefixes)}"${disabled(f.locks.protectedPrefixes)}>
        <span class="field-hint">Paths that require a Cloudflare Access JWT. Default covers the admin UI and admin API. Comma-separated or JSON array (must start with <code>/</code>).</span>
        ${lockBadge(f.locks.protectedPrefixes)}
      </label>
      <div class="adm-form-actions">
        <button type="submit" class="adm-btn--secondary" formaction="/admin/auth/cf-access/test" formmethod="post" formnovalidate>Test connection</button>
        <button type="submit">Save</button>
      </div>
    </form>
    <p class="admin-nav"><a href="/admin/auth/providers">Identity providers</a></p>`,
  );
}

/** Wrap admin page body in a shared HTML shell with full sidebar. */
function pageShell(heading: string, body: string): string {
  return renderAdminShell({
    title: heading,
    body: `<h1>${esc(heading)}</h1>${body}`,
    activeItem: "cf-access",
    favicon: renderAdmittoFaviconLink(),
  });
}

/** Parse Cloudflare Access settings from a submitted admin form. */
export function parseCfAccessForm(form: Record<string, string>): {
  enabled: boolean;
  teamDomain: string;
  audience: string[];
  protectedPrefixes: string[];
} {
  const audienceRaw = form["audience"]?.trim() ?? "";
  let audience: string[] = [];
  if (audienceRaw.startsWith("[")) {
    try {
      const parsed = JSON.parse(audienceRaw) as unknown;
      if (Array.isArray(parsed)) {
        audience = parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      audience = audienceRaw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  } else {
    audience = audienceRaw.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const prefixesRaw = form["protected_prefixes"]?.trim() ?? "";
  let protectedPrefixes = ["/admin", "/api/admin"];
  if (prefixesRaw) {
    if (prefixesRaw.startsWith("[")) {
      try {
        const parsed = JSON.parse(prefixesRaw) as unknown;
        if (Array.isArray(parsed)) {
          protectedPrefixes = parsed.map((v) => String(v).trim()).filter(Boolean);
        }
      } catch {
        protectedPrefixes = prefixesRaw.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } else {
      protectedPrefixes = prefixesRaw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (protectedPrefixes.length === 0) {
    throw new Error("Protected path prefixes cannot be empty");
  }

  return {
    enabled: form["enabled"] === "1",
    teamDomain: form["team_domain"]?.trim() ?? "",
    audience,
    protectedPrefixes,
  };
}

export const CF_ACCESS_SETTING_KEYS = {
  enabled: SETTING_CF_ACCESS_ENABLED,
  teamDomain: SETTING_CF_ACCESS_TEAM_DOMAIN,
  audience: SETTING_CF_ACCESS_AUD,
  protectedPrefixes: SETTING_CF_ACCESS_PROTECTED_PREFIXES,
} as const;
