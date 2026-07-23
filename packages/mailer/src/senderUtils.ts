import addressparser from "nodemailer/lib/addressparser/index.js";
import type { GraphConfig, MailSenderConfig } from "./config.js";
import type { MailMessage, MailSender } from "./types.js";

/** Quote a display name for RFC5322 From (escapes backslash and double-quote). */
export function quoteDisplayName(name: string): string {
  const escaped = name.replaceAll(/\\/g, String.raw`\\`).replaceAll(/"/g, String.raw`\"`);
  return `"${escaped}"`;
}

/** Build RFC5322 From header value: "Display Name <addr>" or plain address. */
export function formatFromHeader(sender: Pick<MailSender, "fromAddress" | "fromName">): string {
  const { fromAddress, fromName } = sender;
  if (fromName) return `${quoteDisplayName(fromName)} <${fromAddress}>`;
  return fromAddress;
}

/** Message replyTo wins over config default. */
export function resolveReplyTo(configReplyTo: string | undefined, message: MailMessage): string | undefined {
  const msgReplyTo = message.replyTo?.trim();
  return msgReplyTo || configReplyTo;
}

export function toMailSender(config: MailSenderConfig): MailSender {
  const sender: MailSender = { fromAddress: config.fromAddress };
  if (config.fromName !== undefined) sender.fromName = config.fromName;
  if (config.replyTo !== undefined) sender.replyTo = config.replyTo;
  if (config.envelopeFrom !== undefined) sender.envelopeFrom = config.envelopeFrom;
  return sender;
}

/**
 * Parse an RFC5322 address list (via nodemailer's addressparser).
 * Returns bare email addresses only — display names are stripped.
 */
export function parseAddressList(list: string): string[] {
  const trimmed = list.trim();
  if (!trimmed) return [];
  const parsed = addressparser(trimmed, { flatten: true });
  return parsed
    .map((entry) => entry.address?.trim())
    .filter((address): address is string => Boolean(address));
}

/** Graph API toRecipients / ccRecipients / replyTo shape. */
export function graphRecipients(list?: string) {
  return parseAddressList(list ?? "").map((address) => ({ emailAddress: { address } }));
}

/** Effective display from address for Graph (defaults to mailbox). */
export function graphDisplayFromAddress(config: GraphConfig): string {
  return config.fromAddress ?? config.mailbox;
}

/**
 * Whether to set message.from in Graph payload.
 * Omit when mailbox alone is sufficient (no display name, no send-as).
 */
export function shouldSetGraphMessageFrom(config: GraphConfig): boolean {
  if (config.fromName) return true;
  if (config.fromAddress && config.fromAddress !== config.mailbox) return true;
  return false;
}
