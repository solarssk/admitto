import type { ResolvedTicket } from "@admitto/tickets";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function badgeClass(status: string): string {
  switch (status) {
    case "registered":
      return "badge-registered";
    case "confirmed":
      return "badge-confirmed";
    case "checked_in":
      return "badge-checked_in";
    case "revoked":
      return "badge-revoked";
    case "cancelled":
      return "badge-cancelled";
    default:
      return "badge-unknown";
  }
}

export function getTicketPageSecurityHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

export function renderTicket(resolved: ResolvedTicket, qrDataUrl: string): string {
  const { attendee, event } = resolved;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ticket — ${esc(event.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    .meta { color: #555; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .name { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge-registered { background: #e0f2fe; color: #0369a1; }
    .badge-confirmed  { background: #dcfce7; color: #166534; }
    .badge-checked_in { background: #f0fdf4; color: #15803d; }
    .badge-revoked    { background: #fee2e2; color: #991b1b; }
    .badge-cancelled  { background: #fff7ed; color: #c2410c; }
    .badge-unknown    { background: #f3f4f6; color: #374151; }
    .qr { margin-top: 1.5rem; text-align: center; }
    .qr img { width: 220px; height: 220px; }
  </style>
</head>
<body>
  <h1>${esc(event.title)}</h1>
  <p class="meta">${esc(formatDate(event.date))}${event.location ? ` · ${esc(event.location)}` : ""}</p>
  <p class="name">${esc(attendee.name)}</p>
  ${attendee.ticket_type ? `<p>${esc(attendee.ticket_type)}</p>` : ""}
  <span class="badge ${badgeClass(attendee.status)}">${esc(attendee.status)}</span>
  <div class="qr"><img src="${qrDataUrl}" alt="QR code for ticket entry"></div>
</body>
</html>`;
}

export function renderNotFound(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Ticket not found</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem">
  <h1>Ticket not found</h1>
  <p>This ticket link is invalid or has expired.</p>
</body>
</html>`;
}

export function renderServerError(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Server error</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem">
  <h1>Server error</h1>
  <p>Unable to render this ticket right now. Please contact support.</p>
</body>
</html>`;
}

export function renderRevoked(name: string, eventTitle: string, reason: "revoked" | "cancelled" = "revoked"): string {
  const heading = reason === "cancelled" ? "Ticket cancelled" : "Ticket revoked";
  const message =
    reason === "cancelled"
      ? `${esc(name)}'s ticket for <strong>${esc(eventTitle)}</strong> has been cancelled.`
      : `${esc(name)}'s ticket for <strong>${esc(eventTitle)}</strong> has been revoked.`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${heading}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem">
  <h1>${heading}</h1>
  <p>${message}</p>
</body>
</html>`;
}
