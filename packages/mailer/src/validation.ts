import { z } from "zod";
import { parseAddressList } from "./senderUtils.js";
import type { MailMessage } from "./types.js";

/** Disallow SMTP/header injection via control characters. */
export const NO_CONTROL_CHARS_RE = /[\r\n\0]/;

const emailSchema = z.string().email();

export function hasControlChars(value: string): boolean {
  return NO_CONTROL_CHARS_RE.test(value);
}

/** Reject control characters (CR/LF/NUL) in any of the header-bound fields. */
function validateNoControlChars(message: MailMessage): string | undefined {
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
  return undefined;
}

/** Validate that `to` resolves to exactly one well-formed email address. */
function validateToAddress(message: MailMessage): string | undefined {
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
  return undefined;
}

/** Validate optional `cc`: when present, every address must be well-formed. */
function validateCcAddresses(message: MailMessage): string | undefined {
  if (!message.cc) {
    return undefined;
  }
  const ccAddresses = parseAddressList(message.cc);
  if (ccAddresses.length === 0) {
    return "cc must contain at least one email address when set";
  }
  for (const address of ccAddresses) {
    if (!emailSchema.safeParse(address).success) {
      return `cc contains invalid email address: ${address}`;
    }
  }
  return undefined;
}

/** Validate optional `replyTo`: when present, must resolve to one well-formed address. */
function validateReplyToAddress(message: MailMessage): string | undefined {
  const replyTo = message.replyTo?.trim();
  if (!replyTo) {
    return undefined;
  }
  const replyAddresses = parseAddressList(replyTo);
  if (replyAddresses.length !== 1 || !emailSchema.safeParse(replyAddresses[0]).success) {
    return "replyTo must be a valid email address";
  }
  return undefined;
}

/**
 * Validate outbound message fields before handing to a transport.
 * Returns a human-readable error or undefined when valid.
 */
export function validateMailMessage(message: MailMessage): string | undefined {
  return (
    validateNoControlChars(message) ??
    validateToAddress(message) ??
    validateCcAddresses(message) ??
    validateReplyToAddress(message)
  );
}
