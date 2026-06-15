import {
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_PROTECTED_PREFIXES,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
} from "@admitto/auth";

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

  return pageShell(
    "Cloudflare Access",
    `${flashBlock}${errorBlock}
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
    <p><a href="/admin/auth/providers">Identity providers</a></p>`,
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
    input[type=text], input[type=url] { width: 100%; box-sizing: border-box; padding: 0.4rem; margin-top: 0.2rem; }
    .error { color: #991b1b; background: #fee2e2; padding: 0.5rem; border-radius: 4px; }
    .flash { color: #065f46; background: #d1fae5; padding: 0.5rem; border-radius: 4px; }
    .muted { color: #666; font-size: 0.85rem; }
    button { margin-top: 1rem; margin-right: 0.5rem; padding: 0.5rem 1rem; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  ${body}
</body>
</html>`;
}

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
