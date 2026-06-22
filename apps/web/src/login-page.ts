function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Security headers for server-rendered operator login and landing pages. */
export function getLoginPageSecurityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    // Primary CSRF signal for HTML form POSTs: Referer on same-origin submits (Safari).
    // Sec-Fetch-Site in same-origin-post.ts is a legacy-UA fallback only.
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

/** SSO provider link for login footer. */
export interface LoginSsoProvider {
  id: string;
  display_name: string;
}

/** Uniform login failure copy (POST /login). */
export const LOGIN_ERROR_CODE = "invalid_credentials";

function loginErrorMessage(error?: string): string | undefined {
  if (!error) return undefined;
  if (error === "oidc_failed") {
    return "Corporate sign-in failed. Try again or use your local password.";
  }
  if (error === LOGIN_ERROR_CODE) {
    return "Invalid email or password.";
  }
  return undefined;
}

/** Render the operator sign-in form HTML (optional uniform error message). */
export function renderLoginForm(
  error?: string,
  next?: string,
  ssoProviders: LoginSsoProvider[] = [],
): string {
  const message = loginErrorMessage(error);
  const errorBlock = message ? `<p class="error" role="alert">${esc(message)}</p>` : "";
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  const ssoBlock =
    ssoProviders.length > 0
      ? `<div class="sso">${ssoProviders
          .map((p) => {
            const startUrl = `/api/auth/oidc/${encodeURIComponent(p.id)}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
            return `<p><a href="${esc(startUrl)}">Sign in with ${esc(p.display_name)}</a></p>`;
          })
          .join("")}</div>`
      : `<footer>SSO / corporate login — coming soon</footer>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign in to Admitto</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 400px; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.25rem; }
    label { display: block; margin-top: 1rem; font-size: 0.9rem; }
    input { width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.5rem; }
    button { margin-top: 1.25rem; padding: 0.5rem 1rem; }
    .error { color: #991b1b; background: #fee2e2; padding: 0.5rem; border-radius: 4px; }
    footer, .sso { margin-top: 2rem; font-size: 0.85rem; color: #666; }
  </style>
</head>
<body>
  <h1>Sign in to Admitto</h1>
  ${errorBlock}
  <form method="post" action="/login">
    ${nextField}
    <label>Email <input type="email" name="email" required autocomplete="username"></label>
    <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
    <label>Device label <span style="color:#666">(optional)</span>
      <input type="text" name="device_label" placeholder="Tablet 1 — main entrance" maxlength="120">
    </label>
    <button type="submit">Sign in</button>
  </form>
  ${ssoBlock}
</body>
</html>`;
}

/** Event row shown on the temporary `/operator` landing page. */
export interface OperatorEventRow {
  title: string;
  slug: string;
}

/** Render the signed-in operator landing page (event list + sign out). */
export function renderOperatorLanding(email: string, events: OperatorEventRow[]): string {
  const eventList =
    events.length === 0
      ? "<p>No events assigned yet. Contact an administrator.</p>"
      : `<ul>${events.map((e) => `<li>${esc(e.title)} <span style="color:#666">(${esc(e.slug)})</span></li>`).join("")}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Signed in — Admitto</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.25rem; }
    .meta { color: #555; font-size: 0.9rem; }
    form { margin-top: 1.5rem; }
  </style>
</head>
<body>
  <h1>Signed in</h1>
  <p class="meta">${esc(email)}</p>
  <h2 style="font-size:1rem;margin-top:1.5rem">Your events</h2>
  ${eventList}
  <form method="post" action="/logout"><button type="submit">Sign out</button></form>
</body>
</html>`;
}
