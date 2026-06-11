import type { GraphConfig, MailSenderConfig } from "./config.js";
import type { MailMessage, MailSender } from "./types.js";

/** Build RFC5322 From header value: "Display Name <addr>" or plain address. */
export function formatFromHeader(sender: Pick<MailSender, "fromAddress" | "fromName">): string {
  const { fromAddress, fromName } = sender;
  if (fromName) return `${fromName} <${fromAddress}>`;
  return fromAddress;
}

/** Message replyTo wins over config default. */
export function resolveReplyTo(configReplyTo: string | undefined, message: MailMessage): string | undefined {
  return message.replyTo ?? configReplyTo;
}

export function toMailSender(config: MailSenderConfig): MailSender {
  return {
    fromAddress: config.fromAddress,
    fromName: config.fromName,
    replyTo: config.replyTo,
    envelopeFrom: config.envelopeFrom,
  };
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
  const displayAddress = graphDisplayFromAddress(config);
  if (config.fromName) return true;
  if (config.fromAddress && config.fromAddress !== config.mailbox) return true;
  if (displayAddress !== config.mailbox) return true;
  return false;
}
