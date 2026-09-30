import type { HealthCheckRowDto } from "../api/types.js";
import { IDENTITY_CLOUDFLARE_ROUTE, IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";

export type HealthCheckGuidance = {
  /** Why the row is in this state, in one sentence (the "Why" line). Omitted for the quiet
   * informational note, which is not a problem. */
  cause?: string;
  /** Omitted only for {@link UNRECOGNISED_STATE_GUIDANCE}, which does not guess what is affected. */
  impact?: string;
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
  cause: "An error occurred while Admitto was reading the data for this check.",
  impact: "Admitto cannot tell whether this part works.",
  nextStep:
    "Reload this page. If the Database row is also down, fix that first. If the problem stays, use Copy for GitHub Issue and open an issue.",
};

function databaseGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  const migrations = detailValue(check, "migrations");
  if (check.status === "down") {
    if (migrations === undefined) {
      return {
        cause: "Admitto could not connect to the database.",
        impact: "Admitto cannot read or save attendees, events or settings.",
        nextStep: "Check that the database service is running and that DATABASE_URL is correct.",
      };
    }
    if (migrations === "pending") {
      return {
        cause: "A new version was installed, but its database update has not run yet.",
        impact: "The database has not been updated for this version of Admitto.",
        nextStep:
          "Run the pending database update. In Docker Compose that is the migrate service, so start it and read its log.",
      };
    }
    return null;
  }
  if (check.status === "degraded" && migrations === "current") {
    return {
      cause: "The database answered the last check slowly.",
      impact: "Pages may load slowly.",
      nextStep: "Reload this page to check again. If it stays slow, check how busy the database server is.",
    };
  }
  return null;
}

function rateLimitStorageGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status === "degraded") {
    return {
      cause: "Redis answered the last check slowly.",
      impact: "Requests that are rate limited may be slower.",
      nextStep: "Reload this page to check again. If it stays slow, check how busy the Redis server is.",
    };
  }
  if (check.status !== "down") return null;
  return {
    cause: "Admitto could not connect to Redis.",
    impact: "Rate limits still apply, but each server counts on its own until Redis is running again.",
    nextStep: "Check that the Redis service is running and that REDIS_URL is correct.",
  };
}

/** Only reached for down: the row is down exactly when ENCRYPTION_KEY is missing (outside
 * development) or fails Admitto's own key validation. */
function dataEncryptionGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status !== "down") return null;
  return {
    cause: "ENCRYPTION_KEY is missing, or is not a valid 32-byte key.",
    impact: "Admitto cannot read or save secrets such as mail and identity provider credentials.",
    nextStep:
      "Set ENCRYPTION_KEY in your deployment configuration (for example the output of openssl rand -base64 32) and restart Admitto. If secrets are already saved, use the key they were saved with.",
  };
}

function backgroundWorkerGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status !== "degraded") return null;
  const reason = detailValue(check, "reason");
  if (reason === "never_ran") {
    return {
      cause: "The worker has never reported that it is running.",
      impact: "Queued emails, imports, exports and bounce checks may not run.",
      nextStep: "Start the worker service, then reload this page.",
    };
  }
  if (reason === "stale") {
    return {
      cause: "The worker has stopped reporting that it is running.",
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
      cause: "The mail service did not accept some emails, or could not be reached.",
      impact: "Some emails could not be sent yet. The worker retries them automatically, a limited number of times.",
      nextStep: "If the number does not go down, check that the worker is running and that Email sending works.",
    };
  }
  const queued = Number(detailValue(check, "queued"));
  const threshold = Number(detailValue(check, "degraded_threshold"));
  if (Number.isFinite(queued) && Number.isFinite(threshold) && queued >= threshold) {
    return {
      cause: "More emails were queued than the worker has sent so far.",
      impact: "Emails are waiting to be sent. This is normal right after sending many emails at once.",
      nextStep: "If the number does not go down, check the Background worker, Email sending and Instance URL rows.",
    };
  }
  return null;
}

function emailSendingGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status === "down" && detailValue(check, "live_check") === "failed") {
    return {
      cause: "The connection test to the mail service did not pass.",
      impact: "Organisation emails may not be sent.",
      nextStep:
        "Check the mail settings and credentials, and that this server can reach the mail service. Then run live checks again.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
    };
  }
  if (check.status === "degraded" && detailValue(check, "reason") === "mail_secret_decryption_failed") {
    return {
      cause: "The saved mail credentials were probably encrypted with a different ENCRYPTION_KEY.",
      impact: "Admitto cannot read the saved mail credentials, so organisation emails may not be sent.",
      nextStep: "Enter the mail credentials again in Mail settings, or restore the previous ENCRYPTION_KEY.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
    };
  }
  return null;
}

/** Only reached for a down or degraded row (healthCheckGuidance() returns early for the rest).
 * Down covers an address that is missing and one that is invalid, and BASE_URL is read before the
 * address saved in General settings, so a wrong BASE_URL has to be fixed or removed first: a valid
 * address entered in General settings does not clear it. */
function instanceUrlGuidance(check: HealthCheckRowDto): HealthCheckGuidance {
  if (check.status === "degraded") {
    return {
      cause: "BASE_URL is not set, so Admitto falls back to the address saved in General settings.",
      impact: "Links in emails and tickets use the address saved in General settings, so they keep working.",
      nextStep: "Set the BASE_URL environment variable to the same address in your deployment configuration.",
    };
  }
  return {
    cause: "BASE_URL or the address saved in General settings is missing or not a valid URL.",
    impact: "Admitto cannot build links for emails, tickets and wallet passes.",
    nextStep:
      "If BASE_URL is set, correct it or remove it, because it takes priority over General settings. Otherwise enter a valid Instance URL in General settings.",
    link: { label: "Open General settings", to: "/admin/settings?tab=general" },
  };
}

function identityProviderGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  if (check.status !== "down" || detailValue(check, "live_check") !== "failed") return null;
  return {
    cause: "The connection test to this provider did not pass.",
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
      cause: "Cloudflare Access is turned on, but no direct identity provider is enabled for it.",
      impact: "Sign-ins through Cloudflare Access may not work.",
      nextStep: "Choose an enabled direct identity provider in the Cloudflare Access settings.",
      link: { label: "Open Cloudflare Access settings", to: IDENTITY_CLOUDFLARE_ROUTE },
    };
  }
  if (detailValue(check, "live_check") === "failed") {
    return {
      cause: "The connection test to Cloudflare Access did not pass.",
      impact: "Sign-ins through Cloudflare Access may not work.",
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

/** `s3` is a recognised STORAGE_PROVIDER value that Admitto does not implement yet, and any other
 * value that is not `local` is unknown - both leave uploads without a working store. The unknown
 * provider's real value is deliberately not repeated here (see `provider_raw` on the server row). */
const FILE_STORAGE_PROVIDER_PROBLEMS = new Map<string, string>([
  ["not_implemented", "STORAGE_PROVIDER is set to s3, which Admitto does not support yet."],
  ["unknown_provider", "STORAGE_PROVIDER is set to a value Admitto does not recognise."],
]);

function fileStorageGuidance(check: HealthCheckRowDto): HealthCheckGuidance | null {
  const reason = detailValue(check, "reason");
  const providerProblem = check.status === "degraded" ? FILE_STORAGE_PROVIDER_PROBLEMS.get(reason ?? "") : undefined;
  if (providerProblem) {
    return {
      cause: providerProblem,
      impact: "Logos, imports and exports cannot be stored.",
      nextStep: "Set STORAGE_PROVIDER to local, or remove it, in your deployment configuration, then restart Admitto.",
    };
  }
  const isFolderProblem =
    (check.status === "down" && FILE_STORAGE_FOLDER_PROBLEM_REASONS.has(reason ?? "")) ||
    (check.status === "degraded" && reason === "write_probe_failed");
  if (!isFolderProblem) return null;
  return {
    cause: "The upload folder is missing, is not a folder, or Admitto cannot write to it.",
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
      cause: "The address service answered the last check slowly.",
      impact: "Address suggestions may be slow.",
      nextStep:
        "Check the geocoding address under Maps in External services and that this server can reach it. Then run live checks again.",
      link,
    };
  }
  if (check.status === "down") {
    return {
      cause: "Admitto could not reach the address service.",
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
  // A successful but slow live probe (weatherLiveOkRow(), latency at or above
  // WEATHER_DEGRADED_MS) is also degraded, with live_check=ok rather than missing entirely.
  if (check.status === "degraded" && liveCheck === "ok") {
    return {
      cause: "The weather provider answered the last check slowly.",
      impact: "Weather forecasts may be slow to load.",
      nextStep:
        "Check the weather provider in External services and that this server can reach it. Then run live checks again.",
      link: { label: "Open External services", to: "/admin/settings?tab=external" },
    };
  }
  if (check.status === "down" && liveCheck !== undefined && WEATHER_UNREACHABLE_LIVE_CHECKS.has(liveCheck)) {
    return {
      cause: "Admitto could not reach the weather provider.",
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
    cause: "MET Norway requires a contact address in each request, and no support contact is set.",
    impact: "Weather forecasts are not available.",
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
    cause: "For some events, the last bounce check failed or is overdue.",
    impact: "Bounced emails may not be detected for those events.",
    nextStep:
      "Check the Background worker row first. Then open Event settings for events with bounce detection turned on.",
  };
}

/** Not a problem - a quiet, scoped note that Admitto cannot send organisation email yet,
 * shown on the row's own not_configured state (no provider, or a provider that only exports).
 * Gated on PO decision 8; changes no verdict, since not_configured is already excluded from the
 * tally in HealthCheckPanel.tsx.
 *
 * `source: "env"` (only ever set on the export_only branch, `describeMailConfigForOrg()`'s
 * `field()` helper marks a field `locked` exactly when its source is "env") means EMAIL_PROVIDER
 * is set in the deployment, so the Mail settings link this note otherwise offers would land on a
 * read-only field - point at the deployment configuration instead. */
function emailSendingNotConfiguredGuidance(check: HealthCheckRowDto): HealthCheckGuidance {
  const isExportOnly = detailValue(check, "provider") === "export_only";
  if (isExportOnly && detailValue(check, "source") === "env") {
    return {
      impact: "This provider does not send emails.",
      nextStep:
        "Set by the EMAIL_PROVIDER environment variable, not Mail settings. Change it in your deployment configuration to send emails from Admitto.",
      quiet: true,
    };
  }
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
  ["instance_url", instanceUrlGuidance],
  ["rate_limit_storage", rateLimitStorageGuidance],
  ["data_encryption", dataEncryptionGuidance],
  ["background_worker", backgroundWorkerGuidance],
  ["mail_delivery_queue", mailDeliveryQueueGuidance],
  ["email_sending", emailSendingGuidance],
  ["cloudflare_access", cloudflareAccessGuidance],
  ["file_storage", fileStorageGuidance],
  ["address_lookup", addressLookupGuidance],
  ["weather", weatherGuidance],
  ["bounce_ingest", bounceIngestGuidance],
]);

/** A down or degraded state this table has no specific guidance for: one the server gained after
 * the table was written, or one that was never expected. No cause or impact is guessed, only how
 * to get more help. */
export const UNRECOGNISED_STATE_GUIDANCE: HealthCheckGuidance = {
  cause: "Admitto does not recognise this state yet, so it has no specific explanation for it.",
  nextStep:
    "Reload this page and run live checks again. If the problem stays, use Copy for GitHub Issue and open an issue.",
};

/**
 * One cause sentence, one impact sentence and one next-step sentence (plus an optional link to
 * the relevant settings tab) for a problem row, shown above its detail list when expanded. Detection is by
 * exact match on the check's id, status and existing detail values - returns null for a healthy
 * row, and {@link UNRECOGNISED_STATE_GUIDANCE} for any down/degraded state this module doesn't
 * recognise, rather than guessing.
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

  // A row whose state could not be read says nothing about its cause, so no id-specific advice
  // (an invalid ENCRYPTION_KEY, an unreachable Redis, a bad BASE_URL) applies, whatever its status.
  if (detailValue(check, "reason") === "lookup_failed") return LOOKUP_FAILED_GUIDANCE;

  const specific = check.id.startsWith("identity_provider_")
    ? identityProviderGuidance(check)
    : (GUIDANCE_BY_ID.get(check.id)?.(check) ?? null);
  if (specific) return specific;

  if (check.status === "degraded") {
    // mail_delivery_queue's own "could not read queue depth" state has no reason key at all -
    // it signals the same failure with a missing `queued` detail instead (health-check-routes.ts
    // mailQueueRow(), the `queued < 0` branch). mailDeliveryQueueGuidance() above already
    // returned non-null for every other degraded state, all of which set `queued`.
    if (check.id === "mail_delivery_queue" && detailValue(check, "queued") === undefined) {
      return LOOKUP_FAILED_GUIDANCE;
    }
  }
  return UNRECOGNISED_STATE_GUIDANCE;
}
