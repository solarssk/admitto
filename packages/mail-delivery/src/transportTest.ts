import type { PrismaClient } from "@admitto/db";
import {
  buildEmailBoxedSectionHtml,
  buildEmailStatusBadgeHtml,
  buildSystemEmailHtml,
  buildSystemEmailSubject,
  escapeHtmlText,
  resolveBranding,
  resolveEmailShellHeaderLogo,
  type EmailShellLogoKind,
} from "@admitto/mail-templates";
import { closeMailer, createMailer, type MailerConfig, type MailerProvider, type SendResult } from "@admitto/mailer";
import { resolveMailConfig, resolveMailConfigForOrg } from "@admitto/mailer-config";
import { MAIL_PROVIDER_LABELS } from "@admitto/shared";
import { randomBytes } from "node:crypto";
import type { MailDeliveryDeps } from "./send.js";
import { sanitizeDeliveryError } from "./sanitizeError.js";

const TRANSPORT_TEST_SUBJECT_PREFIX = "Admitto mail transport test";

export type TransportTestLogoKind = EmailShellLogoKind;

export type TransportTestMessageContext = {
  scope: "organization" | "event";
  /** Already absolutized logo URL, or null/omit for text header. */
  logoUrl?: string | null;
  /** branding = org/event logo; admitto = product wordmark SVG. */
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

/** @see resolveEmailShellHeaderLogo in @admitto/mail-templates - re-exported under this
 * package's existing names for backward compatibility with existing callers/tests. */
export {
  absolutizeEmailShellLogo as absolutizeTransportTestLogo,
  resolveEmailShellHeaderLogo as resolveTransportTestHeaderLogo,
} from "@admitto/mail-templates";

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

function eventScopeLabel(ctx: TransportTestMessageContext): string {
  const title = ctx.eventTitle?.trim();
  return title ? `Event: ${title}` : "Event mail settings";
}

function organizationScopeLabel(ctx: TransportTestMessageContext): string {
  const name = ctx.organizationName?.trim();
  return name ? `Organization: ${name}` : "Organization mail settings";
}

function buildTransportTestDiagRows(
  nonce: string,
  stamp: string,
  ctx: TransportTestMessageContext,
): DiagRow[] {
  const providerLabel = ctx.provider ? MAIL_PROVIDER_LABELS[ctx.provider] : null;
  const scopeLabel = ctx.scope === "event" ? eventScopeLabel(ctx) : organizationScopeLabel(ctx);

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
  return buildEmailStatusBadgeHtml({
    circleBackground: "#dcfce7",
    circleColor: "#16a34a",
    glyphHtml: "&#10003;",
    labelColor: "#16a34a",
    labelText: "Transport OK",
  });
}

function buildTransportTestHtml(
  nonce: string,
  stamp: string,
  ctx: TransportTestMessageContext,
): string {
  const diagHtml = buildTransportTestDiagRows(nonce, stamp, ctx)
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;color:#6b7280;font-size:12px;line-height:18px;vertical-align:top;white-space:nowrap;">${escapeHtmlText(label)}</td>` +
        `<td style="padding:4px 0;color:#111827;font-size:12px;line-height:18px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${renderDiagValueHtml(value)}</td>` +
        `</tr>`,
    )
    .join("");

  const bodyHtml =
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
    buildEmailBoxedSectionHtml({
      label: "Diagnostics",
      innerHtml: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${diagHtml}</table>`,
    }) +
    `</td></tr>`;

  return buildSystemEmailHtml({
    titleText: TRANSPORT_TEST_SUBJECT_PREFIX,
    logoUrl: ctx.logoUrl,
    logoKind: ctx.logoKind,
    altFallbackName: ctx.organizationName?.trim() || ctx.eventTitle?.trim() || undefined,
    bodyHtml,
    footerText: "Automated message from Admitto. No reply needed.",
  });
}

/** Unique per send so SMTP relays that suppress identical From/To/Subject/body
 * (common on corporate smart hosts) do not drop a second click for the same recipient. */
export function buildTransportTestMessage(
  now: Date = new Date(),
  ctx?: TransportTestMessageContext,
): {
  subject: string;
  html: string;
  nonce: string;
  stamp: string;
} {
  const messageCtx = ctx ?? { scope: "organization" as const };
  const stamp = now.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  const nonce = randomBytes(4).toString("hex");
  // Same org-name-first, event-title-fallback precedence as the header's altFallbackName below -
  // "Admitto" only when neither is available (e.g. a lookup failure), not the everyday case.
  const prefixName = messageCtx.organizationName?.trim() || messageCtx.eventTitle?.trim() || "Admitto";
  return {
    subject: buildSystemEmailSubject(prefixName, `mail transport test (${stamp} - ${nonce})`),
    html: buildTransportTestHtml(nonce, stamp, messageCtx),
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
  const headerLogo = resolveEmailShellHeaderLogo(org?.logo_url, env);
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
  const headerLogo = resolveEmailShellHeaderLogo(branding.logo_url, env);
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
function transportTestConfigFields(extras: {
  provider?: MailerProvider;
  toAddress?: string;
  mailConfig?: MailerConfig;
  now?: Date;
}): Partial<TransportTestMessageContext> {
  if (extras.mailConfig && extras.toAddress) {
    return transportTestFieldsFromConfig(extras.mailConfig, extras.toAddress);
  }
  if (extras.toAddress) return { toAddress: extras.toAddress.trim() };
  return {};
}

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
  const headerLogo = resolveEmailShellHeaderLogo(branding.logo_url, env);
  return buildTransportTestMessage(extras.now ?? new Date(), {
    scope: "event",
    eventTitle: event?.title ?? undefined,
    organizationName: event?.organization.name ?? undefined,
    logoUrl: headerLogo?.url ?? null,
    logoKind: headerLogo?.kind,
    provider: extras.provider ?? extras.mailConfig?.provider,
    ...transportTestConfigFields(extras),
  });
}
