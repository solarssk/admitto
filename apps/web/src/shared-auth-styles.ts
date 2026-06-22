/** Shared inline CSS for server-rendered auth pages (token values from @admitto/ui). */

export const AUTH_PAGE_CSS = `
:root {
  --at-blue: #066fd1;
  --at-blue-600: #0560b8;
  --at-gray-100: #f1f5f9;
  --at-gray-200: #e2e8f0;
  --at-gray-500: #64748b;
  --at-gray-800: #1e293b;
  --at-ink: #1d273b;
  --at-red: #d63939;
  --at-red-050: #fbeaea;
  --at-yellow-050: #fdf3e1;
}

*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: Inter, system-ui, sans-serif;
  background: var(--at-gray-100);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 1rem;
  color: var(--at-ink);
  margin: 0;
}
.auth-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--at-ink);
  margin-bottom: 1.5rem;
}
.auth-brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  background: var(--at-blue);
  color: #fff;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 700;
}
.auth-card {
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
  padding: 2rem;
  width: 100%;
  max-width: 400px;
}
.auth-card-wide {
  max-width: 480px;
}
.auth-card h1 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 0.25rem;
}
.auth-card .subtitle {
  font-size: 0.875rem;
  color: var(--at-gray-500);
  margin: 0 0 1.5rem;
}
.auth-error {
  background: var(--at-red-050);
  color: var(--at-red);
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
.auth-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--at-ink);
  margin-bottom: 0.375rem;
}
.auth-input {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--at-gray-200);
  border-radius: 6px;
  font-size: 0.875rem;
  color: var(--at-ink);
  outline: none;
  transition: border-color 0.15s;
}
.auth-input:focus { border-color: var(--at-blue); box-shadow: 0 0 0 3px rgba(6,111,209,0.15); }
.auth-field { margin-bottom: 1rem; }
.auth-btn-primary {
  display: block;
  width: 100%;
  padding: 0.625rem 1rem;
  background: var(--at-blue);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  margin-top: 1.25rem;
  transition: background 0.15s;
}
.auth-btn-primary:hover { background: var(--at-blue-600); }
.auth-btn-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.625rem 1rem;
  background: #fff;
  color: var(--at-ink);
  border: 1px solid var(--at-gray-200);
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  transition: background 0.15s;
}
.auth-btn-secondary:hover { background: var(--at-gray-100); }
.auth-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.25rem 0;
  font-size: 0.8rem;
  color: var(--at-gray-500);
}
.auth-divider::before, .auth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--at-gray-200);
}
.auth-footer {
  font-size: 0.75rem;
  color: var(--at-gray-500);
  text-align: center;
  margin-top: 1rem;
}
.auth-sso-fallback {
  background: #fffbeb;
  border: 1px solid #f59f00;
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  color: #92400e;
  margin-bottom: 1rem;
}
.auth-check-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--at-gray-500);
  margin-top: 0.75rem;
}
.auth-backup {
  background: var(--at-yellow-050);
  border: 1px solid #f59f00;
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
.auth-backup ul {
  margin: 0.5rem 0;
  padding-left: 1.25rem;
}
.auth-backup code {
  font-size: 0.8rem;
}
.auth-uri-code {
  font-size: 0.75rem;
  word-break: break-all;
  display: block;
  background: var(--at-gray-100);
  padding: 0.5rem;
  border-radius: 4px;
}
.auth-muted {
  font-size: 0.875rem;
  color: var(--at-gray-500);
  margin: 0 0 1rem;
}
.auth-sso-list { display: flex; flex-direction: column; gap: 0.5rem; }
`;

export const ADMIN_PAGE_CSS = `
:root {
  --at-blue: #066fd1;
  --at-gray-100: #f1f5f9;
  --at-gray-200: #e2e8f0;
  --at-gray-500: #64748b;
  --at-ink: #1d273b;
  --at-red: #d63939;
  --at-red-050: #fbeaea;
  --at-green-050: #e9f7ec;
}

*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: Inter, system-ui, sans-serif;
  max-width: 720px;
  margin: 2rem auto;
  padding: 0 1rem;
  color: var(--at-ink);
  background: var(--at-gray-100);
  min-height: 100vh;
}
h1 { font-size: 1.35rem; font-weight: 600; margin: 0 0 1rem; }
.admin-nav { margin-bottom: 1rem; font-size: 0.9rem; }
.admin-nav a { color: var(--at-blue); }
label { display: block; margin-top: 0.75rem; font-size: 0.9rem; }
input[type=text], input[type=password], input[type=url], select {
  width: 100%;
  box-sizing: border-box;
  padding: 0.4rem 0.5rem;
  margin-top: 0.2rem;
  border: 1px solid #e6e7e9;
  border-radius: 6px;
  font-size: 0.875rem;
}
fieldset { margin-top: 1rem; border: 1px solid var(--at-gray-200); padding: 0.75rem; border-radius: 6px; }
table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
th, td { border: 1px solid #e6e7e9; padding: 0.5rem 0.625rem; text-align: left; font-size: 0.875rem; }
th { background: #f8fafc; font-weight: 600; }
td input, td select { width: 100%; margin-top: 0; }
.error { color: var(--at-red); background: var(--at-red-050); padding: 0.5rem 0.75rem; border-radius: 6px; margin-bottom: 0.75rem; }
.flash { color: #065f46; background: #d1fae5; padding: 0.5rem 0.75rem; border-radius: 6px; margin-bottom: 0.75rem; }
.muted { color: var(--at-gray-500); font-size: 0.85rem; }
button, .toggle-btn {
  margin-top: 1rem;
  margin-right: 0.5rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--at-gray-200);
  border-radius: 6px;
  background: #fff;
  font-size: 0.875rem;
  cursor: pointer;
}
button[type=submit]:not(.toggle-btn) { background: var(--at-blue); color: #fff; border-color: var(--at-blue); }
.toggle-btn { margin-top: 0; }
.warn-block { background: #fff8e1; border: 1px solid #f59f00; border-radius: 6px; padding: 0.75rem; margin: 0.75rem 0; font-size: 0.875rem; }
.info-block { background: #e9f2fc; border: 1px solid #066fd1; border-radius: 6px; padding: 0.75rem; margin: 0.75rem 0; font-size: 0.875rem; }
.badge-ok { background: var(--at-green-050); color: #1f7a2e; border-radius: 4px; padding: 2px 8px; font-size: 0.8rem; }
.badge-neutral { background: var(--at-gray-100); color: var(--at-gray-500); border-radius: 4px; padding: 2px 8px; font-size: 0.8rem; }
.status-line { margin: 0.75rem 0; font-size: 0.9rem; }
`;

export function renderAuthDocument(title: string, body: string, css: string = AUTH_PAGE_CSS): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function renderAuthBrand(): string {
  return `<div class="auth-brand"><span class="auth-brand-mark" aria-hidden="true">✓</span> Admitto</div>`;
}
