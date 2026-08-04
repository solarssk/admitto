import type { PrismaClient } from "@admitto/db";
import {
  escapeHtmlAttribute,
  escapeHtmlText,
  resolveBranding,
  resolveBrandingAssetUrlForRender,
  resolvePublicBaseUrl,
} from "@admitto/mail-templates";
import { closeMailer, createMailer, type MailerConfig, type MailerProvider, type SendResult } from "@admitto/mailer";
import { resolveMailConfig, resolveMailConfigForOrg } from "@admitto/mailer-config";
import { randomBytes } from "node:crypto";
import type { MailDeliveryDeps } from "./send.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";

const TRANSPORT_TEST_SUBJECT_PREFIX = "Admitto mail transport test";
/** Public product mark served by apps/web (same path as the ticket page). */
const ADMITTO_MARK_PATH = "/assets/admitto-mark.svg";

const PROVIDER_LABELS: Record<MailerProvider, string> = {
  smtp: "SMTP",
  graph: "Microsoft Graph",
  powerautomate: "Power Automate",
  export_only: "Export only",
};

export type TransportTestLogoKind = "branding" | "admitto";

export type TransportTestMessageContext = {
  scope: "organization" | "event";
  /** Already absolutized logo URL, or null/omit for text header. */
  logoUrl?: string | null;
  /** branding = org/event logo; admitto = product mark (+ wordmark). */
  logoKind?: TransportTestLogoKind;
  provider?: MailerProvider;
  eventTitle?: string;
  organizationName?: string;
  /** Recipient of this transport test (shown in Diagnostics). */
  toAddress?: string;
  fromAddress?: string;
  fromName?: string;
  replyTo?: string;
  envelopeFrom?: string;
  /** SMTP host (no secrets). */
  host?: string;
  port?: number;
  /** Graph mailbox identity. */
  mailbox?: string;
};

/** Non-secret send fields for Diagnostics (shared by org/event Send test + bounce probe). */
export function transportTestFieldsFromConfig(
  mailConfig: MailerConfig,
  toAddress: string,
): Pick<
  TransportTestMessageContext,
  | "provider"
  | "toAddress"
  | "fromAddress"
  | "fromName"
  | "replyTo"
  | "envelopeFrom"
  | "host"
  | "port"
  | "mailbox"
> {
  const to = toAddress.trim();
  const fromName = mailConfig.fromName?.trim() || undefined;
  const replyTo = mailConfig.replyTo?.trim() || undefined;
  const envelopeFrom = mailConfig.envelopeFrom?.trim() || undefined;

  if (mailConfig.provider === "smtp") {
    return {
      provider: "smtp",
      toAddress: to,
      fromAddress: mailConfig.fromAddress,
      fromName,
      replyTo,
      envelopeFrom,
      host: mailConfig.host,
      port: mailConfig.port,
    };
  }
  if (mailConfig.provider === "graph") {
    return {
      provider: "graph",
      toAddress: to,
      fromAddress: mailConfig.fromAddress?.trim() || mailConfig.mailbox,
      fromName,
      replyTo,
      envelopeFrom,
      mailbox: mailConfig.mailbox,
    };
  }
  return {
    provider: mailConfig.provider,
    toAddress: to,
    fromAddress: mailConfig.fromAddress,
    fromName,
    replyTo,
    envelopeFrom,
  };
}

/** Best-effort absolutize of a stored branding logo for email HTML. */
export function absolutizeTransportTestLogo(
  logoUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = logoUrl?.trim() ?? "";
  if (!raw) return null;
  try {
    const baseUrl = resolvePublicBaseUrl(env);
    const abs = resolveBrandingAssetUrlForRender("logo_url", raw, baseUrl);
    return abs || null;
  } catch {
    return null;
  }
}

/**
 * Org/event branding logo when set; otherwise the Admitto mark under BASE_URL.
 * Shared by organisation Send test, event Send test, and bounce probe.
 */
export function resolveTransportTestHeaderLogo(
  brandingLogoUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { url: string; kind: TransportTestLogoKind } | null {
  const branded = absolutizeTransportTestLogo(brandingLogoUrl, env);
  if (branded) return { url: branded, kind: "branding" };

  try {
    const base = resolvePublicBaseUrl(env).replace(/\/$/, "");
    if (!base) return null;
    return { url: `${base}${ADMITTO_MARK_PATH}`, kind: "admitto" };
  } catch {
    return null;
  }
}

function buildTransportTestHeaderInner(ctx: TransportTestMessageContext): string {
  const logoUrl = ctx.logoUrl?.trim() || "";
  if (!logoUrl) {
    return `<span style="font-size:20px;font-weight:700;color:#1f2937;letter-spacing:-0.02em;">Admitto</span>`;
  }

  if (ctx.logoKind === "admitto") {
    return (
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td style="vertical-align:middle;padding:0;">` +
      `<img src="${escapeHtmlAttribute(logoUrl)}" alt="" width="32" height="32" ` +
      `style="display:block;border:0;outline:none;text-decoration:none;" />` +
      `</td>` +
      `<td style="vertical-align:middle;padding:0 0 0 10px;font-family:Arial,Helvetica,sans-serif;` +
      `font-size:20px;font-weight:700;color:#1f2937;letter-spacing:-0.02em;">Admitto</td>` +
      `</tr></table>`
    );
  }

  const alt = ctx.organizationName?.trim() || ctx.eventTitle?.trim() || "Admitto";
  return (
    `<img src="${escapeHtmlAttribute(logoUrl)}" alt="${escapeHtmlAttribute(alt)}" width="140" ` +
    `style="display:block;border:0;outline:none;text-decoration:none;max-width:140px;height:auto;" />`
  );
}

type DiagRow = [string, string | readonly string[]];

function formatFromDiagValue(ctx: TransportTestMessageContext): string | readonly string[] | null {
  const addr = ctx.fromAddress?.trim();
  if (!addr) return null;
  const name = ctx.fromName?.trim();
  if (!name) return addr;
  return [name, `<${addr}>`];
}

function renderDiagValueHtml(value: string | readonly string[]): string {
  const lines = typeof value === "string" ? [value] : [...value];
  return lines
    .map(
      (line) =>
        `<div style="line-height:18px;word-break:break-all;">${escapeHtmlText(line)}</div>`,
    )
    .join("");
}

function buildTransportTestDiagRows(
  nonce: string,
  stamp: string,
  ctx: TransportTestMessageContext,
): DiagRow[] {
  const providerLabel = ctx.provider ? (PROVIDER_LABELS[ctx.provider] ?? ctx.provider) : null;
  const scopeLabel =
    ctx.scope === "event"
      ? ctx.eventTitle?.trim()
        ? `Event: ${ctx.eventTitle.trim()}`
        : "Event mail settings"
      : ctx.organizationName?.trim()
        ? `Organization: ${ctx.organizationName.trim()}`
        : "Organization mail settings";

  const rows: DiagRow[] = [
    ["Test id", nonce],
    ["Sent at", stamp],
    ["Scope", scopeLabel],
  ];
  if (providerLabel) rows.push(["Transport", providerLabel]);
  if (ctx.toAddress?.trim()) rows.push(["Recipient", ctx.toAddress.trim()]);
  const fromValue = formatFromDiagValue(ctx);
  if (fromValue) rows.push(["From", fromValue]);
  if (ctx.replyTo?.trim()) rows.push(["Reply-To", ctx.replyTo.trim()]);
  if (ctx.envelopeFrom?.trim()) rows.push(["Envelope-From", ctx.envelopeFrom.trim()]);
  if (ctx.host?.trim()) {
    rows.push(["Host", ctx.port != null ? `${ctx.host.trim()}:${ctx.port}` : ctx.host.trim()]);
  }
  if (ctx.mailbox?.trim()) rows.push(["Mailbox", ctx.mailbox.trim()]);
  if (ctx.scope === "event" && ctx.organizationName?.trim()) {
    rows.push(["Organization", ctx.organizationName.trim()]);
  }
  return rows;
}

/** Modest green check in a circle - table-based for Outlook. */
function buildTransportOkBadge(): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">` +
    `<tr><td align="center" valign="middle" bgcolor="#dcfce7" width="44" height="44" ` +
    `style="width:44px;height:44px;border-radius:22px;background-color:#dcfce7;` +
    `color:#16a34a;font-size:20px;line-height:44px;text-align:center;font-family:Arial,Helvetica,sans-serif;">&#10003;</td></tr>` +
    `</table>` +
    `<div style="margin-top:10px;font-size:13px;font-weight:600;line-height:18px;color:#16a34a;text-align:center;">Transport OK</div>`
  );
}

function buildTransportTestHtml(
  nonce: string,
  stamp: string,
  ctx: TransportTestMessageContext,
): string {
  const headerInner = buildTransportTestHeaderInner(ctx);
  const diagHtml = buildTransportTestDiagRows(nonce, stamp, ctx)
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;color:#6b7280;font-size:12px;line-height:18px;vertical-align:top;white-space:nowrap;">${escapeHtmlText(label)}</td>` +
        `<td style="padding:4px 0;color:#111827;font-size:12px;line-height:18px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${renderDiagValueHtml(value)}</td>` +
        `</tr>`,
    )
    .join("");

  return (
    `<!DOCTYPE html>` +
    `<html lang="en">` +
    `<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>${escapeHtmlText(TRANSPORT_TEST_SUBJECT_PREFIX)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:#f4f4f4;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;padding:24px 12px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">` +
    // Header
    `<tr><td style="padding:24px 28px 16px 28px;border-bottom:1px solid #f3f4f6;">${headerInner}</td></tr>` +
    // Status + title (centered under divider)
    `<tr><td align="center" style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;">` +
    buildTransportOkBadge() +
    `<div style="margin-top:18px;font-size:22px;font-weight:700;line-height:28px;color:#111827;text-align:center;">Mail transport test</div>` +
    `<div style="margin-top:10px;font-size:15px;line-height:24px;color:#4b5563;text-align:center;max-width:440px;margin-left:auto;margin-right:auto;">` +
    `This message confirms that Admitto can send through the configured mail transport. ` +
    `It is not a ticket or attendee email.` +
    `</div>` +
    `</td></tr>` +
    // Diagnostics
    `<tr><td style="padding:20px 28px 28px 28px;font-family:Arial,Helvetica,sans-serif;">` +
    `<div style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;">` +
    `<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">Diagnostics</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${diagHtml}</table>` +
    `</div>` +
    `</td></tr>` +
    // Footer
    `<tr><td align="center" style="padding:0 28px 24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;text-align:center;">` +
    `Automated message from Admitto. No reply needed.` +
    `</td></tr>` +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/** Unique per send so SMTP relays that suppress identical From/To/Subject/body
 * (common on corporate smart hosts) do not drop a second click for the same recipient. */
export function buildTransportTestMessage(
  now: Date = new Date(),
  ctx: TransportTestMessageContext = { scope: "organization" },
): {
  subject: string;
  html: string;
  nonce: string;
  stamp: string;
} {
  const stamp = now.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  const nonce = randomBytes(4).toString("hex");
  return {
    subject: `${TRANSPORT_TEST_SUBJECT_PREFIX} (${stamp} - ${nonce})`,
    html: buildTransportTestHtml(nonce, stamp, ctx),
    nonce,
    stamp,
  };
}

export interface SendTransportTestEmailParams {
  organizationId: string;
  toAddress: string;
}

export interface SendEventTransportTestEmailParams {
  eventId: string;
  toAddress: string;
}

async function sendTransportTestEmailWithConfig(
  mailConfig: MailerConfig,
  toAddress: string,
  deps: MailDeliveryDeps,
  messageCtx: TransportTestMessageContext,
): Promise<SendResult> {
  const mailer = await createMailer(mailConfig, { exportSink: deps.exportSink });
  const { subject, html } = buildTransportTestMessage(new Date(), {
    ...messageCtx,
    ...transportTestFieldsFromConfig(mailConfig, toAddress),
    provider: messageCtx.provider ?? mailConfig.provider,
  });

  try {
    const result = await mailer.send({
      to: toAddress,
      subject,
      html,
    });

    if (result.error) {
      return { ...result, error: sanitizeDeliveryError(result.error) };
    }
    return result;
  } finally {
    await closeMailer(mailer);
  }
}

/**
 * Sends one transport-level test email using org-scoped mail config.
 * Does not create EmailDelivery rows — operator preflight only.
 */
export async function sendTransportTestEmail(
  params: SendTransportTestEmailParams,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
): Promise<SendResult> {
  const mailConfig = await resolveMailConfigForOrg(params.organizationId, prisma, env);
  const org = await prisma.organization.findUnique({
    where: { id: params.organizationId },
    select: { name: true, logo_url: true },
  });
  const headerLogo = resolveTransportTestHeaderLogo(org?.logo_url, env);
  return sendTransportTestEmailWithConfig(mailConfig, params.toAddress, deps, {
    scope: "organization",
    organizationName: org?.name ?? undefined,
    logoUrl: headerLogo?.url ?? null,
    logoKind: headerLogo?.kind,
    provider: mailConfig.provider,
  });
}

/**
 * Sends one transport-level test email using event-scoped mail config, falling
 * back to the organization's config per resolveMailConfig's normal precedence.
 * Does not create EmailDelivery rows — operator preflight only.
 */
export async function sendEventTransportTestEmail(
  params: SendEventTransportTestEmailParams,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  deps: MailDeliveryDeps = {},
): Promise<SendResult> {
  const mailConfig = await resolveMailConfig(params.eventId, prisma, env);
  const event = await prisma.event.findUnique({
    where: { id: params.eventId },
    select: { title: true, organization: { select: { name: true } } },
  });
  const branding = await resolveBranding(params.eventId, prisma);
  const headerLogo = resolveTransportTestHeaderLogo(branding.logo_url, env);
  return sendTransportTestEmailWithConfig(mailConfig, params.toAddress, deps, {
    scope: "event",
    eventTitle: event?.title ?? undefined,
    organizationName: event?.organization.name ?? undefined,
    logoUrl: headerLogo?.url ?? null,
    logoKind: headerLogo?.kind,
    provider: mailConfig.provider,
  });
}

/** Build a branded transport-test message for an event (shared by Send test + bounce probe). */
export async function buildEventTransportTestMessage(
  eventId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  extras: {
    provider?: MailerProvider;
    toAddress?: string;
    mailConfig?: MailerConfig;
    now?: Date;
  } = {},
): Promise<{ subject: string; html: string; nonce: string; stamp: string }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { title: true, organization: { select: { name: true } } },
  });
  const branding = await resolveBranding(eventId, prisma);
  const headerLogo = resolveTransportTestHeaderLogo(branding.logo_url, env);
  const configFields =
    extras.mailConfig && extras.toAddress
      ? transportTestFieldsFromConfig(extras.mailConfig, extras.toAddress)
      : extras.toAddress
        ? { toAddress: extras.toAddress.trim() }
        : {};
  return buildTransportTestMessage(extras.now ?? new Date(), {
    scope: "event",
    eventTitle: event?.title ?? undefined,
    organizationName: event?.organization.name ?? undefined,
    logoUrl: headerLogo?.url ?? null,
    logoKind: headerLogo?.kind,
    provider: extras.provider ?? extras.mailConfig?.provider,
    ...configFields,
  });
}
