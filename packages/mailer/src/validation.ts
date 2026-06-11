import { z } from "zod";
import { parseAddressList } from "./senderUtils.js";
import type { MailMessage } from "./types.js";

/** Disallow SMTP/header injection via control characters. */
export const NO_CONTROL_CHARS_RE = /[\r\n\0]/;

const emailSchema = z.string().email();

export function hasControlChars(value: string): boolean {
  return NO_CONTROL_CHARS_RE.test(value);
}

/**
 * Validate outbound message fields before handing to a transport.
 * Returns a human-readable error or undefined when valid.
 */
export function validateMailMessage(message: MailMessage): string | undefined {
  if (hasControlChars(message.subject)) {
    return "subject must not contain control characters (CR/LF/NUL)";
  }
  if (hasControlChars(message.to)) {
    return "to must not contain control characters (CR/LF/NUL)";
  }
  if (message.cc && hasControlChars(message.cc)) {
    return "cc must not contain control characters (CR/LF/NUL)";
  }
  if (message.replyTo && hasControlChars(message.replyTo)) {
    return "replyTo must not contain control characters (CR/LF/NUL)";
  }

  const toAddresses = parseAddressList(message.to);
  if (toAddresses.length === 0) {
    return "to must be a valid email address";
  }
  if (toAddresses.length !== 1) {
    return "to must resolve to exactly one recipient email address";
  }
  if (!emailSchema.safeParse(toAddresses[0]).success) {
    return "to must be a valid email address";
  }

  if (message.cc) {
    const ccAddresses = parseAddressList(message.cc);
    if (ccAddresses.length === 0) {
      return "cc must contain at least one email address when set";
    }
    for (const address of ccAddresses) {
      if (!emailSchema.safeParse(address).success) {
        return `cc contains invalid email address: ${address}`;
      }
    }
  }

  const replyTo = message.replyTo?.trim();
  if (replyTo) {
    const replyAddresses = parseAddressList(replyTo);
    if (replyAddresses.length !== 1 || !emailSchema.safeParse(replyAddresses[0]).success) {
      return "replyTo must be a valid email address";
    }
  }

  return undefined;
}
