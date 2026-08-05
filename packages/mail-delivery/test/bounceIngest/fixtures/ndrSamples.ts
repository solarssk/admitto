/**
 * Synthetic NDR fixtures for MIME extraction tests.
 * Patterns mirror real MTA reports (Postfix, Exchange-style multipart/report)
 * without customer PII — only @example.com addresses.
 */

/** ISO-8859-1 quoted-printable with French diagnostic (é via =E9). */
export function iso8859QpNdr(): string {
  const body =
    "user@example.com failed: host mx.example.com said: 550 5.1.1 bo=EEte inconnue";
  return [
    "MIME-Version: 1.0",
    "From: Mail Delivery System <mailer-daemon@example.com>",
    "Subject: =?iso-8859-1?Q?Undeliverable:_user=40example.com?=",
    'Content-Type: text/plain; charset="iso-8859-1"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    body,
  ].join("\r\n");
}

/** UTF-8 QP soft-wrapped diagnostic (real NDRs wrap mid-line with =\r\n). */
export function utf8QpSoftWrapNdr(): string {
  return [
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "user@example.com failed: host mx.example.com (203.0.113.1) =",
    "said: 550 5.1.1 User unknown (in reply to RCPT TO command)",
  ].join("\r\n");
}

/** multipart/report with message/delivery-status (RFC 3464) + human text. */
export function multipartReportDsn(): string {
  return [
    "MIME-Version: 1.0",
    "Content-Type: multipart/report; report-type=delivery-status; boundary=\"bnd\"",
    "",
    "--bnd",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Your message could not be delivered to one or more recipients.",
    "--bnd",
    "Content-Type: message/delivery-status",
    "",
    "Final-Recipient: rfc822; nobody@example.org",
    "Action: failed",
    "Status: 5.1.1",
    "Diagnostic-Code: smtp; 550 5.1.1 User unknown",
    "--bnd",
    "Content-Type: message/rfc822",
    "",
    "Subject: original",
    "",
    "body",
    "--bnd--",
  ].join("\r\n");
}

/** Windows-1252 QP body (common Exchange / Outlook NDR charset). */
export function windows1252QpNdr(): Buffer {
  // "boîte" with î as Windows-1252 0xEE; use QP so the octet survives transport.
  const message = [
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="windows-1252"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "user@example.com failed: host mx.example.com said: 550 5.1.1 bo=EEte inconnue",
  ].join("\r\n");
  return Buffer.from(message, "ascii");
}
