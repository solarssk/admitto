import type { SendResultStatus } from "./types.js";

export interface MappedFailure {
  status: Extract<SendResultStatus, "failed" | "rejected">;
  retryable: boolean;
}

/** Map HTTP status codes from Graph / Power Automate to normalized failure semantics. */
export function mapHttpStatus(status: number): MappedFailure {
  if (status === 429 || status >= 500) {
    return { status: "failed", retryable: true };
  }
  if (status >= 400) {
    return { status: "rejected", retryable: false };
  }
  return { status: "failed", retryable: false };
}

export function mapNetworkError(): MappedFailure {
  return { status: "failed", retryable: true };
}

const SMTP_CODE_RE = /\b([45]\d{2})\b/;

interface NodemailerSmtpError extends Error {
  responseCode?: number;
  response?: string;
}

function isSmtpReplyCode(value: number): boolean {
  return Number.isInteger(value) && value >= 400 && value < 600;
}

/** Extract an SMTP reply code from nodemailer's structured error fields, if present. */
function extractStructuredSmtpCode(smtpErr: NodemailerSmtpError): number | undefined {
  if (typeof smtpErr.responseCode === "number" && isSmtpReplyCode(smtpErr.responseCode)) {
    return smtpErr.responseCode;
  }
  if (typeof smtpErr.response !== "string") {
    return undefined;
  }
  const responseMatch = /^(\d{3})/.exec(smtpErr.response.trim());
  if (!responseMatch) {
    return undefined;
  }
  const parsed = Number(responseMatch[1]);
  return isSmtpReplyCode(parsed) ? parsed : undefined;
}

/** Prefer nodemailer's structured SMTP fields before regexing Error.message. */
function extractSmtpCode(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const structured = extractStructuredSmtpCode(err as NodemailerSmtpError);
    if (structured !== undefined) return structured;
  }

  const msg = err instanceof Error ? err.message : String(err);
  const codeMatch = SMTP_CODE_RE.exec(msg);
  return codeMatch ? Number(codeMatch[1]) : undefined;
}

/** Map nodemailer / SMTP transport errors to normalized failure semantics. */
export function mapSmtpError(err: unknown): MappedFailure {
  const msg = err instanceof Error ? err.message : String(err);
  const code = extractSmtpCode(err);

  if (code !== undefined) {
    // Permanent auth / policy failures
    if (code === 535 || code === 534 || code === 553 || code === 550) {
      return { status: "rejected", retryable: false };
    }
    // Transient SMTP responses
    if (code === 421 || code === 450 || code === 451 || code === 452) {
      return { status: "failed", retryable: true };
    }
    if (code >= 500) {
      return { status: "rejected", retryable: false };
    }
    if (code >= 400 && code < 500) {
      return { status: "failed", retryable: true };
    }
  }

  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ETIMEOUT|socket timeout/i.test(msg)) {
    return { status: "failed", retryable: true };
  }

  return { status: "failed", retryable: false };
}
