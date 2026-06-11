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

/** Map nodemailer / SMTP transport errors to normalized failure semantics. */
export function mapSmtpError(err: unknown): MappedFailure {
  const msg = err instanceof Error ? err.message : String(err);
  const codeMatch = SMTP_CODE_RE.exec(msg);
  const code = codeMatch ? Number(codeMatch[1]) : undefined;

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
