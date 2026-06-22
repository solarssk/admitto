import {
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_PROTECTED_PREFIXES,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
} from "@admitto/auth";
import { ADMIN_PAGE_CSS } from "../shared-auth-styles.js";

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
      ? `<div class="warn-block" role="alert"><strong>Warning:</strong> Cloudflare Access is enabled. If your CF configuration is incorrect, users may be locked out. Use &quot;Test JWKS&quot; before saving changes.</div>`
      : "";

  const envLockedWarning = f.enabled && f.locks.enabled
    ? `<div class="info-block">Cloudflare Access is enabled and locked by environment configuration.</div>`
    : "";

  const fallthroughInfo = `<div class="info-block"><strong>How it works:</strong> When a Cloudflare JWT is present in the request, Admitto validates it against your Access policy. If no JWT is present (e.g. direct access), Admitto falls through to the standard local login. This means local accounts always work as a break-glass fallback.</div>`;

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
        Enabled${lockBadge(f.locks.enabled)}
      </label>
      <label>
        Team domain (issuer URL)
        <input name="team_domain" type="url" placeholder="https://team.cloudflareaccess.com" value="${esc(f.teamDomain)}"${disabled(f.locks.teamDomain)}>
        ${lockBadge(f.locks.teamDomain)}
      </label>
      <label>
        Application audience (AUD) tags
        <input name="audience" placeholder="comma-separated or JSON array" value="${esc(f.audience)}"${disabled(f.locks.audience)}>
        ${lockBadge(f.locks.audience)}
      </label>
      <label>
        Protected path prefixes
        <input name="protected_prefixes" placeholder='["/admin","/api/admin"]' value="${esc(f.protectedPrefixes)}"${disabled(f.locks.protectedPrefixes)}>
        ${lockBadge(f.locks.protectedPrefixes)}
      </label>
      <button type="submit" formaction="/admin/auth/cf-access/test" formmethod="post" formnovalidate>Test JWKS</button>
      <button type="submit">Save</button>
    </form>
    <p class="admin-nav"><a href="/admin/auth/providers">Identity providers</a></p>`,
  );
}

/** Wrap admin page body in a shared HTML shell; tab title uses the `Admitto —` prefix. */
function pageShell(heading: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Admitto — ${esc(heading)}</title>
  <style>${ADMIN_PAGE_CSS}</style>
</head>
<body>
  <h1>${esc(heading)}</h1>
  ${body}
</body>
</html>`;
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
