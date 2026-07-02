import type { PrismaClient } from "@prisma/client";
import { InstanceUrlRequiredError, resolveInstanceBaseUrl } from "@admitto/auth";
import { retryDelivery } from "@admitto/mail-delivery";
import { CliError, arg, hasFlag, parseFormat } from "../lib/args.js";
import { formatJson } from "../lib/output.js";

export async function runMailRetryFailed(db: PrismaClient): Promise<void> {
  const eventId = arg("event");
  if (!eventId) {
    throw new CliError("Usage: admitto mail retry-failed --event <id>");
  }

  const format = parseFormat();

  const candidates = await db.emailDelivery.findMany({
    where: { event_id: eventId, status: "failed", retryable: true },
    select: { id: true },
  });

  if (hasFlag("dry-run")) {
    console.log(`Would retry ${candidates.length} failed delivery row(s).`);
    return;
  }

  let baseUrl: string;
  try {
    baseUrl = await resolveInstanceBaseUrl(db, process.env);
  } catch (err) {
    if (err instanceof InstanceUrlRequiredError) {
      throw new CliError(
        "Instance URL not configured (Settings → General or BASE_URL env). Cannot retry deliveries.",
      );
    }
    throw err;
  }

  let retried = 0;
  let skipped = 0;
  let failed = 0;

  for (const { id } of candidates) {
    try {
      const result = await retryDelivery(id, db, process.env, {}, { baseUrl });
      if (result.ok) {
        retried++;
      } else if (result.reason === "not_retryable" || result.reason === "missing_snapshot") {
        skipped++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  const summary = { retried, skipped, failed, total: candidates.length };
  if (format === "json") {
    console.log(formatJson(summary));
  } else {
    console.log(
      `Retry complete: ${retried} retried, ${skipped} skipped, ${failed} failed (${candidates.length} candidates).`,
    );
  }

  if (failed > 0 && retried === 0) {
    process.exitCode = 1;
  } else if (failed > 0) {
    process.exitCode = 2;
  }
}
