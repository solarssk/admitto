import type { MailerProvider, SendResult } from "./types.js";

export function rejectedSendResult(
  provider: MailerProvider,
  error: string,
  idempotencyKey?: string,
): SendResult {
  return {
    status: "rejected",
    provider,
    retryable: false,
    error,
    idempotencyKey,
  };
}
