import type { PrismaClient, EmailDelivery } from "@admitto/db";
import { sanitizeDeliveryError } from "../sanitizeError.js";
import { NON_TERMINAL } from "./correlate.js";
import type { ParsedBounceLine } from "./types.js";

export type ApplyBounceOutcome = "hard_bounced" | "soft_logged" | "skipped";

/** SMTP reply (+ enhanced status when present), shared by ingest apply and bounce probe. */
export function buildErrorCode(line: ParsedBounceLine): string {
  return line.enhancedCode ? `${line.smtpCode}/${line.enhancedCode}` : line.smtpCode;
}

function buildErrorMessage(line: ParsedBounceLine): string {
  const code = buildErrorCode(line);
  return sanitizeDeliveryError(`Bounce ${code}: ${line.reason}`) ?? `Bounce ${code}`;
}

/**
 * Map SMTP class → delivery update.
 * 5xx → bounced (terminal). 4xx → log only; do not flip status (ADR 0039 §8).
 * Hard bounce uses updateMany with a non-terminal status filter so a concurrent
 * worker cannot overwrite an already-terminal row.
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
  const updated = await db.emailDelivery.updateMany({
    where: {
      id: delivery.id,
      status: { in: [...NON_TERMINAL] },
    },
    data: {
      status: "bounced",
      retryable: false,
      failed_at: now,
      error_code: buildErrorCode(line).slice(0, 64),
      error: buildErrorMessage(line),
    },
  });

  if (updated.count === 0) {
    log(
      `[bounce-ingest] skipped already-terminal delivery=${delivery.id} code=${buildErrorCode(line)}`,
    );
    return "skipped";
  }

  return "hard_bounced";
}
