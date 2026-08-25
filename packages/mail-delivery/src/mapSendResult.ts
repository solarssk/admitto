import type { SendResult } from "@admitto/mailer";
import type { EmailDeliveryStatus } from "@admitto/db";
import { sanitizeDeliveryError } from "./sanitizeError.js";

export interface DeliveryStatusUpdate {
  status: EmailDeliveryStatus;
  provider_message_id?: string;
  error?: string | null;
  error_code?: string | null;
  retryable?: boolean;
  attempted_at: Date;
  accepted_at?: Date;
  sent_at?: Date;
  failed_at?: Date;
}

export function mapSendResultToDelivery(sendResult: SendResult): DeliveryStatusUpdate {
  const now = new Date();
  const base = {
    provider_message_id: sendResult.providerMessageId,
    attempted_at: now,
  };

  switch (sendResult.status) {
    // Explicit null (not omitted) so Prisma actually clears error/error_code left by an earlier
    // failed attempt on this row, instead of leaving `undefined` fields untouched.
    case "accepted":
      return { ...base, status: "accepted", accepted_at: now, error: null, error_code: null };
    case "sent":
      return { ...base, status: "sent", sent_at: now, error: null, error_code: null };
    case "failed":
      return {
        ...base,
        status: "failed",
        failed_at: now,
        retryable: sendResult.retryable ?? false,
        error: sanitizeDeliveryError(sendResult.error),
      };
    case "rejected":
      return {
        ...base,
        status: "rejected",
        failed_at: now,
        retryable: false,
        error: sanitizeDeliveryError(sendResult.error),
      };
    default: {
      const _exhaustive: never = sendResult.status;
      throw new Error(`Unknown send status: ${String(_exhaustive)}`);
    }
  }
}
