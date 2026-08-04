import type { PrismaClient, EmailDelivery } from "@admitto/db";
import { sanitizeDeliveryError } from "../sanitizeError.js";
import type { ParsedBounceLine } from "./types.js";

export type ApplyBounceOutcome = "hard_bounced" | "soft_logged" | "skipped";

function buildErrorCode(line: ParsedBounceLine): string {
  return line.enhancedCode ? `${line.smtpCode}/${line.enhancedCode}` : line.smtpCode;
}

function buildErrorMessage(line: ParsedBounceLine): string {
  const code = buildErrorCode(line);
  return sanitizeDeliveryError(`Bounce ${code}: ${line.reason}`) ?? `Bounce ${code}`;
}

/**
 * Map SMTP class → delivery update.
 * 5xx → bounced (terminal). 4xx → log only; do not flip status (ADR 0039 §8).
 */
export async function applyBounceResult(
  db: PrismaClient,
  delivery: EmailDelivery,
  line: ParsedBounceLine,
  log: (msg: string) => void = console.error,
): Promise<ApplyBounceOutcome> {
  const classDigit = line.smtpCode.charAt(0);

  if (classDigit === "4") {
    log(
      `[bounce-ingest] soft bounce delivery=${delivery.id} code=${buildErrorCode(line)} (status unchanged)`,
    );
    return "soft_logged";
  }

  if (classDigit !== "5") {
    log(
      `[bounce-ingest] ignored non-4xx/5xx code=${line.smtpCode} delivery=${delivery.id}`,
    );
    return "skipped";
  }

  const now = new Date();
  await db.emailDelivery.update({
    where: { id: delivery.id },
    data: {
      status: "bounced",
      retryable: false,
      failed_at: now,
      error_code: buildErrorCode(line).slice(0, 64),
      error: buildErrorMessage(line),
    },
  });

  return "hard_bounced";
}
