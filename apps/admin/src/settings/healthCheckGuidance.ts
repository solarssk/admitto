import type { HealthCheckRowDto } from "../api/types.js";
import { IDENTITY_CLOUDFLARE_ROUTE, IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";

export type HealthCheckGuidance = {
  impact: string;
  nextStep: string;
  link?: { label: string; to: string };
  /** A quiet, non-alarming note (email_sending with no mail provider set) rather than guidance
   * about an actual problem - rendered with a muted tone instead of the usual one. */
  quiet?: boolean;
};

function detailValue(check: HealthCheckRowDto, key: string): string | undefined {
  return check.details.find((d) => d.key === key)?.value;
}

const LOOKUP_FAILED_GUIDANCE: HealthCheckGuidance = {
  impact: "Admitto could not read the data for this check, so it cannot tell whether it works.",
  nextStep:
    "Reload this page. If the Database row is also down, fix that first. If the problem stays, use Copy for GitHub Issue and open an issue.",
};

function databaseGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  const migrations = detailValue(check, "migrations");
  if (check.status === "down") {
    if (migrations === undefined) {
      return {
        impact: "Admitto cannot read or save attendees, events or settings.",
        nextStep: "Check that the database service is running and that DATABASE_URL is correct.",
      };
    }
    if (migrations === "pending") {
      return {
        impact: "The database has not been updated for this version of Admitto.",
        nextStep:
          "Run the pending database update. In Docker Compose that is the migrate service, so start it and read its log.",
      };
    }
    return null;
  }
  if (check.status === "degraded" && migrations === "current") {
    return {
      impact: "Pages may load slowly.",
      nextStep: "Reload this page to check again. If it stays slow, check how busy the database server is.",
    };
  }
  return null;
}

function rateLimitStorageGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status !== "down") return null;
  return {
    impact: "Rate limits still apply, but each server counts on its own until Redis is running again.",
    nextStep: "Check that the Redis service is running and that REDIS_URL is correct.",
  };
}

function backgroundWorkerGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status !== "degraded") return null;
  const reason = detailValue(check, "reason");
  if (reason === "never_ran") {
    return {
      impact: "Queued emails, imports, exports and bounce checks may not run.",
      nextStep: "Start the worker service, then reload this page.",
    };
  }
  if (reason === "stale") {
    return {
      impact: "Queued emails, imports, exports and bounce checks may not run.",
      nextStep: "Check that the worker is running and restart it if it is not.",
    };
  }
  return null;
}

function mailDeliveryQueueGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status !== "degraded") return null;
  const failedRetryable = Number(detailValue(check, "failed_retryable"));
  if (Number.isFinite(failedRetryable) && failedRetryable > 0) {
    return {
      impact: "Some emails could not be sent yet. The worker retries them automatically, a limited number of times.",
      nextStep: "If the number does not go down, check that the worker is running and that Email sending works.",
    };
  }
  const queued = Number(detailValue(check, "queued"));
  const threshold = Number(detailValue(check, "degraded_threshold"));
  if (Number.isFinite(queued) && Number.isFinite(threshold) && queued >= threshold) {
    return {
      impact: "Emails are waiting to be sent. This is normal right after sending many emails at once.",
      nextStep: "If the number does not go down, check the Background worker, Email sending and Instance URL rows.",
    };
  }
  return null;
}

function emailSendingGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status === "down" && detailValue(check, "live_check") === "failed") {
    return {
      impact: "The mail connection test did not pass. Organisation emails may not be sent.",
      nextStep:
        "Check the mail settings and credentials, and that this server can reach the mail service. Then run live checks again.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
    };
  }
  if (check.status === "degraded" && detailValue(check, "reason") === "mail_secret_decryption_failed") {
    return {
      impact: "Admitto cannot read the saved mail credentials.",
      nextStep: "Enter the mail credentials again in Mail settings, or restore the previous ENCRYPTION_KEY.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
    };
  }
  return null;
}

function identityProviderGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status !== "down" || detailValue(check, "live_check") !== "failed") return null;
  return {
    impact: "Staff may not be able to sign in with this provider.",
    nextStep:
      "Check the provider's URLs in Identity settings and that this server can reach them. Then run live checks again.",
    link: { label: "Open Identity settings", to: IDENTITY_PROVIDERS_ROUTE },
  };
}

function cloudflareAccessGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status !== "down") return null;
  const directIdp = detailValue(check, "direct_identity_provider");
  if (directIdp === "missing" || directIdp === "disabled") {
    return {
      impact: "Cloudflare Access is turned on but has no enabled direct identity provider.",
      nextStep: "Choose an enabled direct identity provider in the Cloudflare Access settings.",
      link: { label: "Open Cloudflare Access settings", to: IDENTITY_CLOUDFLARE_ROUTE },
    };
  }
  if (detailValue(check, "live_check") === "failed") {
    return {
      impact: "The Cloudflare Access connection test did not pass, so sign-ins through it may not work.",
      nextStep: "Check the Cloudflare team URL in the Cloudflare Access settings and that this server can reach it.",
      link: { label: "Open Cloudflare Access settings", to: IDENTITY_CLOUDFLARE_ROUTE },
    };
  }
  return null;
}

/** `not_a_directory`/`not_writable` (both original) and `cannot_create_directory` (added later
 * by #1477's canCreateUploadDir(), after this guidance table was first drafted) all describe the
 * same underlying problem - no working upload folder - so they share one message. */
const FILE_STORAGE_FOLDER_PROBLEM_REASONS = new Set([
  "not_a_directory",
  "not_writable",
  "cannot_create_directory",
]);

function fileStorageGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  const reason = detailValue(check, "reason");
  const isFolderProblem =
    (check.status === "down" && FILE_STORAGE_FOLDER_PROBLEM_REASONS.has(reason ?? "")) ||
    (check.status === "degraded" && reason === "write_probe_failed");
  if (!isFolderProblem) return null;
  return {
    impact: "Logos, imports and exports need this folder.",
    nextStep:
      "Make sure UPLOAD_DIR exists and Admitto can write to it. In Docker Compose that is the uploads folder on the host.",
  };
}

function addressLookupGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  const link = { label: "Open External services", to: "/admin/settings?tab=external" };
  // The only real degraded branch is "slow" (status alone, no reason key); excluding
  // reason=lookup_failed keeps this from also swallowing this check's own generic
  // could-not-read fallback, which is also degraded with no other distinguishing key.
  if (check.status === "degraded" && detailValue(check, "reason") === undefined) {
    return {
      impact: "Address suggestions may be slow.",
      nextStep:
        "Check the geocoding address under Maps in External services and that this server can reach it. Then run live checks again.",
      link,
    };
  }
  if (check.status === "down") {
    return {
      impact: "Address suggestions may not work.",
      nextStep:
        "Check the geocoding address under Maps in External services and that this server can reach it. Then run live checks again.",
      link,
    };
  }
  return null;
}

const WEATHER_UNREACHABLE_LIVE_CHECKS = new Set(["failed", "timeout", "unavailable"]);

function weatherGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  const liveCheck = detailValue(check, "live_check");
  if (liveCheck === "support_contact_required") {
    return weatherSupportContactGuidance();
  }
  // The passive "no geocoding contact configured" branch (MET Norway only) has neither a
  // live_check nor a reason key - checking for no reason key at all keeps this from also
  // swallowing this check's own generic could-not-read fallback, which shares that same
  // missing-live_check shape but does carry reason=lookup_failed.
  if (check.status === "degraded" && liveCheck === undefined && detailValue(check, "reason") === undefined) {
    return weatherSupportContactGuidance();
  }
  if (check.status === "down" && liveCheck !== undefined && WEATHER_UNREACHABLE_LIVE_CHECKS.has(liveCheck)) {
    return {
      impact: "Weather forecasts may be missing.",
      nextStep:
        "Check the weather provider in External services and that this server can reach it. Then run live checks again.",
      link: { label: "Open External services", to: "/admin/settings?tab=external" },
    };
  }
  return null;
}

function weatherSupportContactGuidance(): HealthCheckGuidance {
  return {
    impact: "Weather forecasts are not available until a support contact is set.",
    nextStep: "Add a support contact in General settings.",
    link: { label: "Open General settings", to: "/admin/settings?tab=general" },
  };
}

function bounceIngestGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  // The real degraded state has no reason key at all (just problem_events/enabled_events
  // counts) - checking for no reason key keeps this from also swallowing this check's own
  // generic could-not-read fallback, which is degraded with reason=lookup_failed and no
  // problem_events key.
  if (check.status !== "degraded" || detailValue(check, "reason") !== undefined) return null;
  return {
    impact: "Bounced emails may not be detected for those events.",
    nextStep:
      "Check the Background worker row first. Then open Event settings for events with bounce detection turned on.",
  };
}

/** Not a problem - a quiet, scoped note that Admitto cannot send organisation email yet,
 * shown on the row's own not_configured state (no provider, or a provider that only exports).
 * Gated on PO decision 8; changes no verdict, since not_configured is already excluded from the
 * tally in HealthCheckPanel.tsx. */
function emailSendingNotConfiguredGuidance(check: HealthCheckRowDto): HealthCheckGuidance {
  const isExportOnly = detailValue(check, "provider") === "export_only";
  return {
    impact: isExportOnly
      ? "This provider does not send emails."
      : "No organisation mail provider is set.",
    nextStep: "To send emails from Admitto, choose a mail provider in Mail settings.",
    link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
    quiet: true,
  };
}

/** `Map`, not a plain object - `check.id` is server-controlled today, but the same
 * `["__proto__"]` footgun applies to any object indexed by an external string (see
 * healthCheckDisplay.ts's REASON_SENTENCES for the full reasoning), and here it would throw
 * (`GUIDANCE_BY_ID[id]` returning a non-function `Object.prototype` and then being called)
 * rather than just displaying the wrong thing. */
const GUIDANCE_BY_ID = new Map<string, (check: HealthCheckRowDto) => HealthCheckGuidance | null>([
  ["database", databaseGuidance],
  ["rate_limit_storage", rateLimitStorageGuidance],
  ["background_worker", backgroundWorkerGuidance],
  ["mail_delivery_queue", mailDeliveryQueueGuidance],
  ["email_sending", emailSendingGuidance],
  ["cloudflare_access", cloudflareAccessGuidance],
  ["file_storage", fileStorageGuidance],
  ["address_lookup", addressLookupGuidance],
  ["weather", weatherGuidance],
  ["bounce_ingest", bounceIngestGuidance],
]);

/**
 * One impact sentence and one next-step sentence (plus an optional link to the relevant
 * settings tab) for a problem row, shown above its detail list when expanded. Detection is by
 * exact match on the check's id, status and existing detail values - returns null for a healthy
 * row, or for any down/degraded state this module doesn't recognise, rather than guessing.
 *
 * The one exception is email_sending's own not_configured state, which gets a quiet informational
 * note (no organisation mail provider set) rather than problem guidance - see
 * emailSendingNotConfiguredGuidance()'s own doc comment.
 */
export function healthCheckGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.id === "email_sending" && check.status === "not_configured") {
    return emailSendingNotConfiguredGuidance(check);
  }
  if (check.status !== "down" && check.status !== "degraded") return null;

  const specific = check.id.startsWith("identity_provider_")
    ? identityProviderGuidance(check)
    : (GUIDANCE_BY_ID.get(check.id)?.(check) ?? null);
  if (specific) return specific;

  if (check.status === "degraded") {
    if (detailValue(check, "reason") === "lookup_failed") return LOOKUP_FAILED_GUIDANCE;
    // mail_delivery_queue's own "could not read queue depth" state has no reason key at all -
    // it signals the same failure with a missing `queued` detail instead (health-check-routes.ts
    // mailQueueRow(), the `queued < 0` branch). mailDeliveryQueueGuidance() above already
    // returned non-null for every other degraded state, all of which set `queued`.
    if (check.id === "mail_delivery_queue" && detailValue(check, "queued") === undefined) {
      return LOOKUP_FAILED_GUIDANCE;
    }
  }
  return null;
}
