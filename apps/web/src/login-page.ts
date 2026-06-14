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
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Render the operator sign-in form HTML (optional uniform error message). */
export function renderLoginForm(error?: string, next?: string): string {
  const errorBlock = error
    ? `<p class="error" role="alert">${esc(error)}</p>`
    : "";
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Operator sign in — Admitto</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 400px; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.25rem; }
    label { display: block; margin-top: 1rem; font-size: 0.9rem; }
    input { width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.5rem; }
    button { margin-top: 1.25rem; padding: 0.5rem 1rem; }
    .error { color: #991b1b; background: #fee2e2; padding: 0.5rem; border-radius: 4px; }
    footer { margin-top: 2rem; font-size: 0.85rem; color: #666; }
  </style>
</head>
<body>
  <h1>Operator sign in</h1>
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
  <footer>SSO / corporate login — coming soon</footer>
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
