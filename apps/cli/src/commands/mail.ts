import type { PrismaClient } from "@prisma/client";
import { InstanceUrlRequiredError, resolveInstanceBaseUrl } from "@admitto/auth";
import { retryDelivery } from "@admitto/mail-delivery";
import { CliError, arg, hasFlag, parseFormat } from "../lib/args.js";
import { formatJson } from "../lib/output.js";

async function resolveBaseUrlForRetry(db: PrismaClient): Promise<string> {
  try {
    return await resolveInstanceBaseUrl(db, process.env);
  } catch (err) {
    if (err instanceof InstanceUrlRequiredError) {
      throw new CliError(
        "Instance URL not configured (Settings → General or BASE_URL env). Cannot retry deliveries.",
      );
    }
    throw err;
  }
}

type RetryOutcome = "retried" | "skipped" | "failed";

async function retryOneDelivery(
  id: string,
  db: PrismaClient,
  baseUrl: string,
): Promise<RetryOutcome> {
  try {
    const result = await retryDelivery(id, db, process.env, {}, { baseUrl });
    if (result.ok) {
      return "retried";
    }
    if (result.reason === "not_retryable" || result.reason === "missing_snapshot") {
      return "skipped";
    }
    return "failed";
  } catch {
    return "failed";
  }
}

interface RetrySummary {
  retried: number;
  skipped: number;
  failed: number;
  total: number;
}

function printRetrySummary(summary: RetrySummary, format: string): void {
  if (format === "json") {
    console.log(formatJson(summary));
  } else {
    console.log(
      `Retry complete: ${summary.retried} retried, ${summary.skipped} skipped, ${summary.failed} failed (${summary.total} candidates).`,
    );
  }
}

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

  const baseUrl = await resolveBaseUrlForRetry(db);

  let retried = 0;
  let skipped = 0;
  let failed = 0;

  for (const { id } of candidates) {
    const outcome = await retryOneDelivery(id, db, baseUrl);
    if (outcome === "retried") {
      retried++;
    } else if (outcome === "skipped") {
      skipped++;
    } else {
      failed++;
    }
  }

  const summary: RetrySummary = { retried, skipped, failed, total: candidates.length };
  printRetrySummary(summary, format);

  if (failed > 0 && retried === 0) {
    process.exitCode = 1;
  } else if (failed > 0) {
    process.exitCode = 2;
  }
}
