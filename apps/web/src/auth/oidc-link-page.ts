function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getOidcLinkPageSecurityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

export interface RenderOidcLinkFormOptions {
  providerId: string;
  providerName: string;
  requiresTotp: boolean;
  next?: string;
  error?: string;
}

export function renderOidcLinkForm(options: RenderOidcLinkFormOptions): string {
  const { providerId, providerName, requiresTotp, next, error } = options;
  const errorBlock = error ? `<p class="error" role="alert">${esc(error)}</p>` : "";
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  const totpField = requiresTotp
    ? `<label>Authenticator code <input name="code" inputmode="numeric" autocomplete="one-time-code" required></label>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Link ${esc(providerName)} — Admitto</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.25rem; }
    p.hint { font-size: 0.9rem; color: #444; }
    label { display: block; margin-top: 1rem; font-size: 0.9rem; }
    input { width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.5rem; }
    button { margin-top: 1.25rem; padding: 0.5rem 1rem; }
    .error { color: #991b1b; background: #fee2e2; padding: 0.5rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Link ${esc(providerName)}</h1>
  <p class="hint">Confirm your password${requiresTotp ? " and authenticator code" : ""} before linking this sign-in method to your account.</p>
  ${errorBlock}
  <form method="post" action="/account/oidc/${esc(providerId)}/link">
    ${nextField}
    <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
    ${totpField}
    <button type="submit">Continue to ${esc(providerName)}</button>
  </form>
  <p><a href="/operator">Cancel</a></p>
</body>
</html>`;
}
