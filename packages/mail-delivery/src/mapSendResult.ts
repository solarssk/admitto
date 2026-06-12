import type { SendResult } from "@admitto/mailer";
import type { EmailDeliveryStatus } from "@admitto/db";
import { sanitizeDeliveryError } from "./sanitizeError.js";

export interface DeliveryStatusUpdate {
  status: EmailDeliveryStatus;
  provider_message_id?: string;
  error?: string;
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
    error: sanitizeDeliveryError(sendResult.error),
    attempted_at: now,
  };

  switch (sendResult.status) {
    case "accepted":
      return { ...base, status: "accepted", accepted_at: now };
    case "sent":
      return { ...base, status: "sent", sent_at: now };
    case "failed":
      return {
        ...base,
        status: "failed",
        failed_at: now,
        retryable: sendResult.retryable ?? false,
      };
    case "rejected":
      return {
        ...base,
        status: "rejected",
        failed_at: now,
        retryable: false,
      };
    default: {
      const _exhaustive: never = sendResult.status;
      throw new Error(`Unknown send status: ${String(_exhaustive)}`);
    }
  }
}
