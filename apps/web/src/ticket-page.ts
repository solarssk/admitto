import type { ResolvedTicket } from "@admitto/tickets";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
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
    .qr { margin-top: 1.5rem; text-align: center; }
    .qr img { width: 220px; height: 220px; }
  </style>
</head>
<body>
  <h1>${esc(event.title)}</h1>
  <p class="meta">${esc(formatDate(event.date))}${event.location ? ` · ${esc(event.location)}` : ""}</p>
  <p class="name">${esc(attendee.name)}</p>
  ${attendee.ticket_type ? `<p>${esc(attendee.ticket_type)}</p>` : ""}
  <span class="badge badge-${esc(attendee.status)}">${esc(attendee.status)}</span>
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

export function renderRevoked(name: string, eventTitle: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Ticket revoked</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem">
  <h1>Ticket revoked</h1>
  <p>${esc(name)}'s ticket for <strong>${esc(eventTitle)}</strong> has been revoked.</p>
</body>
</html>`;
}
