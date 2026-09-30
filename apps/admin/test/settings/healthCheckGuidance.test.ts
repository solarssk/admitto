import { describe, expect, it } from "vitest";
import { healthCheckGuidance, UNRECOGNISED_STATE_GUIDANCE } from "../../src/settings/healthCheckGuidance.js";
import type { HealthCheckRowDto, HealthDetailDto, HealthRowStatus } from "../../src/api/types.js";

function checkRow(
  id: string,
  status: HealthRowStatus,
  details: HealthDetailDto[] = [],
): HealthCheckRowDto {
  return { id, label: id, status, summary: "summary", details };
}

describe("healthCheckGuidance", () => {
  it("returns null for a healthy row", () => {
    expect(healthCheckGuidance(checkRow("database", "ok"))).toBeNull();
  });

  it("returns null for a not_configured row on a check with no quiet note", () => {
    expect(healthCheckGuidance(checkRow("database", "not_configured"))).toBeNull();
  });

  it("gives database down with no migrations key the missing-database-service guidance", () => {
    const guidance = healthCheckGuidance(checkRow("database", "down"));
    expect(guidance).toEqual({
      cause: "Admitto could not connect to the database.",
      impact: "Admitto cannot read or save attendees, events or settings.",
      nextStep: "Check that the database service is running and that DATABASE_URL is correct.",
    });
  });

  it("gives database down with migrations=pending the pending-update guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("database", "down", [{ key: "migrations", value: "pending" }]),
    );
    expect(guidance).toEqual({
      cause: "A new version was installed, but its database update has not run yet.",
      impact: "The database has not been updated for this version of Admitto.",
      nextStep:
        "Run the pending database update. In Docker Compose that is the migrate service, so start it and read its log.",
    });
  });

  it("gives database down with an unrecognised migrations value the unrecognised-state guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("database", "down", [{ key: "migrations", value: "something_new" }]),
    );
    expect(guidance).toBe(UNRECOGNISED_STATE_GUIDANCE);
  });

  it("explains an unrecognised state without guessing what it affects", () => {
    expect(UNRECOGNISED_STATE_GUIDANCE.cause).toBe(
      "Admitto does not recognise this state yet, so it has no specific explanation for it.",
    );
    expect(UNRECOGNISED_STATE_GUIDANCE.impact).toBeUndefined();
    expect(UNRECOGNISED_STATE_GUIDANCE.nextStep).toContain("Copy for GitHub Issue");
  });

  it("gives database degraded with migrations=current the slow-pages guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("database", "degraded", [{ key: "migrations", value: "current" }]),
    );
    expect(guidance).toEqual({
      cause: "The database answered the last check slowly.",
      impact: "Pages may load slowly.",
      nextStep: "Reload this page to check again. If it stays slow, check how busy the database server is.",
    });
  });

  it("gives instance_url degraded the set-BASE_URL guidance", () => {
    expect(healthCheckGuidance(checkRow("instance_url", "degraded"))).toEqual({
      cause: "BASE_URL is not set, so Admitto falls back to the address saved in General settings.",
      impact: "Links in emails and tickets use the address saved in General settings, so they keep working.",
      nextStep: "Set the BASE_URL environment variable to the same address in your deployment configuration.",
    });
  });

  it("gives instance_url down guidance that fixes an invalid BASE_URL first and only then points to General settings", () => {
    const guidance = healthCheckGuidance(checkRow("instance_url", "down"));
    expect(guidance).toEqual({
      cause: "BASE_URL or the address saved in General settings is missing or not a valid URL.",
      impact: "Admitto cannot build links for emails, tickets and wallet passes.",
      nextStep:
        "If BASE_URL is set, correct it or remove it, because it takes priority over General settings. Otherwise enter a valid Instance URL in General settings.",
      link: { label: "Open General settings", to: "/admin/settings?tab=general" },
    });
  });

  it("returns null for an instance_url row that is healthy or only optional", () => {
    expect(healthCheckGuidance(checkRow("instance_url", "ok"))).toBeNull();
    expect(healthCheckGuidance(checkRow("instance_url", "not_configured"))).toBeNull();
  });

  it("gives rate_limit_storage down the Redis guidance", () => {
    const guidance = healthCheckGuidance(checkRow("rate_limit_storage", "down"));
    expect(guidance).toEqual({
      cause: "Admitto could not connect to Redis.",
      impact: "Rate limits still apply, but each server counts on its own until Redis is running again.",
      nextStep: "Check that the Redis service is running and that REDIS_URL is correct.",
    });
  });

  it("gives rate_limit_storage degraded the slow-Redis guidance", () => {
    expect(healthCheckGuidance(checkRow("rate_limit_storage", "degraded"))).toEqual({
      cause: "Redis answered the last check slowly.",
      impact: "Requests that are rate limited may be slower.",
      nextStep: "Reload this page to check again. If it stays slow, check how busy the Redis server is.",
    });
  });

  it("gives background_worker degraded/never_ran the start-worker guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("background_worker", "degraded", [{ key: "reason", value: "never_ran" }]),
    );
    expect(guidance).toEqual({
      cause: "The worker has never reported that it is running.",
      impact: "Queued emails, imports, exports and bounce checks may not run.",
      nextStep: "Start the worker service, then reload this page.",
    });
  });

  it("gives background_worker degraded/stale the restart-worker guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("background_worker", "degraded", [{ key: "reason", value: "stale" }]),
    );
    expect(guidance).toEqual({
      cause: "The worker has stopped reporting that it is running.",
      impact: "Queued emails, imports, exports and bounce checks may not run.",
      nextStep: "Check that the worker is running and restart it if it is not.",
    });
  });

  it("gives mail_delivery_queue degraded with failed_retryable>0 the retry guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("mail_delivery_queue", "degraded", [
        { key: "failed_retryable", value: "3" },
        { key: "queued", value: "10" },
        { key: "degraded_threshold", value: "5" },
      ]),
    );
    expect(guidance).toEqual({
      cause: "The mail service did not accept some emails, or could not be reached.",
      impact: "Some emails could not be sent yet. The worker retries them automatically, a limited number of times.",
      nextStep: "If the number does not go down, check that the worker is running and that Email sending works.",
    });
  });

  it("gives mail_delivery_queue degraded with queued>=threshold and no retryable failures the bulk-send guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("mail_delivery_queue", "degraded", [
        { key: "failed_retryable", value: "0" },
        { key: "queued", value: "218" },
        { key: "degraded_threshold", value: "100" },
      ]),
    );
    expect(guidance).toEqual({
      cause: "More emails were queued than the worker has sent so far.",
      impact: "Emails are waiting to be sent. This is normal right after sending many emails at once.",
      nextStep: "If the number does not go down, check the Background worker, Email sending and Instance URL rows.",
    });
  });

  it("gives mail_delivery_queue degraded below the threshold, with nothing failing, the unrecognised-state guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("mail_delivery_queue", "degraded", [
        { key: "failed_retryable", value: "0" },
        { key: "queued", value: "10" },
        { key: "degraded_threshold", value: "100" },
      ]),
    );
    expect(guidance).toBe(UNRECOGNISED_STATE_GUIDANCE);
  });

  it("gives email_sending down/live_check=failed the mail-connection guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("email_sending", "down", [{ key: "live_check", value: "failed" }]),
    );
    expect(guidance).toEqual({
      cause: "The connection test to the mail service did not pass.",
      impact: "Organisation emails may not be sent.",
      nextStep:
        "Check the mail settings and credentials, and that this server can reach the mail service. Then run live checks again.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
    });
  });

  it("gives email_sending down without a failed live_check the unrecognised-state guidance", () => {
    expect(healthCheckGuidance(checkRow("email_sending", "down"))).toBe(UNRECOGNISED_STATE_GUIDANCE);
  });

  it("gives email_sending degraded/mail_secret_decryption_failed the credentials guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("email_sending", "degraded", [
        { key: "reason", value: "mail_secret_decryption_failed" },
      ]),
    );
    expect(guidance).toEqual({
      cause: "The saved mail credentials were probably encrypted with a different ENCRYPTION_KEY.",
      impact: "Admitto cannot read the saved mail credentials, so organisation emails may not be sent.",
      nextStep: "Enter the mail credentials again in Mail settings, or restore the previous ENCRYPTION_KEY.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
    });
  });

  it("gives an identity_provider_* row down/live_check=failed the sign-in guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("identity_provider_idp-1", "down", [{ key: "live_check", value: "failed" }]),
    );
    expect(guidance).toEqual({
      cause: "The connection test to this provider did not pass.",
      impact: "Staff may not be able to sign in with this provider.",
      nextStep:
        "Check the provider's URLs in Identity settings and that this server can reach them. Then run live checks again.",
      link: { label: "Open Identity settings", to: "/admin/settings/identity/providers" },
    });
  });

  it("gives an identity_provider_* row down without a failed live_check the unrecognised-state guidance", () => {
    expect(healthCheckGuidance(checkRow("identity_provider_idp-1", "down"))).toBe(UNRECOGNISED_STATE_GUIDANCE);
  });

  it("gives cloudflare_access down/direct_identity_provider=missing the choose-provider guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("cloudflare_access", "down", [
        { key: "direct_identity_provider", value: "missing" },
      ]),
    );
    expect(guidance).toEqual({
      cause: "Cloudflare Access is turned on, but no direct identity provider is enabled for it.",
      impact: "Sign-ins through Cloudflare Access may not work.",
      nextStep: "Choose an enabled direct identity provider in the Cloudflare Access settings.",
      link: { label: "Open Cloudflare Access settings", to: "/admin/settings/identity/cloudflare" },
    });
  });

  it("gives cloudflare_access down/direct_identity_provider=disabled the same choose-provider guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("cloudflare_access", "down", [
        { key: "direct_identity_provider", value: "disabled" },
      ]),
    );
    expect(guidance?.cause).toBe("Cloudflare Access is turned on, but no direct identity provider is enabled for it.");
    expect(guidance?.impact).toBe("Sign-ins through Cloudflare Access may not work.");
  });

  it("gives cloudflare_access down/live_check=failed the connection-test guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("cloudflare_access", "down", [{ key: "live_check", value: "failed" }]),
    );
    expect(guidance).toEqual({
      cause: "The connection test to Cloudflare Access did not pass.",
      impact: "Sign-ins through Cloudflare Access may not work.",
      nextStep: "Check the Cloudflare team URL in the Cloudflare Access settings and that this server can reach it.",
      link: { label: "Open Cloudflare Access settings", to: "/admin/settings/identity/cloudflare" },
    });
  });

  it.each(["identity_provider_idp-1", "cloudflare_access", "address_lookup", "bounce_ingest", "background_worker", "wallet_passes", "weather", "email_sending", "mail_delivery_queue"])(
    "gives %s degraded/reason=lookup_failed the shared could-not-read guidance",
    (id) => {
      const guidance = healthCheckGuidance(
        checkRow(id, "degraded", [{ key: "reason", value: "lookup_failed" }]),
      );
      expect(guidance).toEqual({
        cause: "An error occurred while Admitto was reading the data for this check.",
        impact: "Admitto cannot tell whether this part works.",
        nextStep:
          "Reload this page. If the Database row is also down, fix that first. If the problem stays, use Copy for GitHub Issue and open an issue.",
      });
    },
  );

  it("gives an unrecognised check id with no lookup_failed reason the unrecognised-state guidance", () => {
    expect(healthCheckGuidance(checkRow("map_tiles", "down"))).toBe(UNRECOGNISED_STATE_GUIDANCE);
  });

  it("gives mail_delivery_queue degraded with no queued detail the shared could-not-read guidance", () => {
    // health-check-routes.ts's mailQueueRow() "could not read queue depth" branch (queued < 0)
    // sets only degraded_threshold, no reason key and no queued key at all - a different
    // signalling mechanism from every other check's reason=lookup_failed.
    const guidance = healthCheckGuidance(
      checkRow("mail_delivery_queue", "degraded", [
        { key: "degraded_threshold", value: "100" },
      ]),
    );
    expect(guidance).toEqual({
      cause: "An error occurred while Admitto was reading the data for this check.",
      impact: "Admitto cannot tell whether this part works.",
      nextStep:
        "Reload this page. If the Database row is also down, fix that first. If the problem stays, use Copy for GitHub Issue and open an issue.",
    });
  });

  it.each(["not_a_directory", "not_writable", "cannot_create_directory"])(
    "gives file_storage down/reason=%s the missing-folder guidance",
    (reason) => {
      const guidance = healthCheckGuidance(
        checkRow("file_storage", "down", [{ key: "reason", value: reason }]),
      );
      expect(guidance).toEqual({
        cause: "The upload folder is missing, is not a folder, or Admitto cannot write to it.",
        impact: "Logos, imports and exports need this folder.",
        nextStep:
          "Make sure UPLOAD_DIR exists and Admitto can write to it. In Docker Compose that is the uploads folder on the host.",
      });
    },
  );

  it("gives file_storage degraded/write_probe_failed the same missing-folder guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("file_storage", "degraded", [{ key: "reason", value: "write_probe_failed" }]),
    );
    expect(guidance?.impact).toBe("Logos, imports and exports need this folder.");
  });

  it("gives file_storage degraded/not_implemented (S3) the provider guidance", () => {
    expect(
      healthCheckGuidance(checkRow("file_storage", "degraded", [{ key: "reason", value: "not_implemented" }])),
    ).toEqual({
      cause: "STORAGE_PROVIDER is set to s3, which Admitto does not support yet.",
      impact: "Logos, imports and exports cannot be stored.",
      nextStep: "Set STORAGE_PROVIDER to local, or remove it, in your deployment configuration, then restart Admitto.",
    });
  });

  it("gives file_storage degraded/unknown_provider the provider guidance without repeating the value", () => {
    const guidance = healthCheckGuidance(
      checkRow("file_storage", "degraded", [
        { key: "reason", value: "unknown_provider" },
        { key: "provider_raw", value: "my-secret-bucket-host" },
      ]),
    );
    expect(guidance?.cause).toBe("STORAGE_PROVIDER is set to a value Admitto does not recognise.");
    expect(JSON.stringify(guidance)).not.toContain("my-secret-bucket-host");
  });

  it("gives data_encryption down the ENCRYPTION_KEY guidance, and a healthy or optional one none", () => {
    expect(healthCheckGuidance(checkRow("data_encryption", "down"))).toEqual({
      cause: "ENCRYPTION_KEY is missing, or is not a valid 32-byte key.",
      impact: "Admitto cannot read or save secrets such as mail and identity provider credentials.",
      nextStep:
        "Set ENCRYPTION_KEY in your deployment configuration (for example the output of openssl rand -base64 32) and restart Admitto. If secrets are already saved, use the key they were saved with.",
    });
    expect(healthCheckGuidance(checkRow("data_encryption", "ok"))).toBeNull();
    expect(healthCheckGuidance(checkRow("data_encryption", "not_configured"))).toBeNull();
  });

  it("gives address_lookup degraded (slow, no reason key) the slow guidance with a link", () => {
    const guidance = healthCheckGuidance(checkRow("address_lookup", "degraded"));
    expect(guidance).toEqual({
      cause: "The address service answered the last check slowly.",
      impact: "Address suggestions may be slow.",
      nextStep:
        "Check the geocoding address under Maps in External services and that this server can reach it. Then run live checks again.",
      link: { label: "Open External services", to: "/admin/settings?tab=external" },
    });
  });

  it("gives address_lookup down the unreachable guidance with the same link", () => {
    const guidance = healthCheckGuidance(
      checkRow("address_lookup", "down", [{ key: "live_check", value: "failed" }]),
    );
    expect(guidance?.impact).toBe("Address suggestions may not work.");
    expect(guidance?.link).toEqual({ label: "Open External services", to: "/admin/settings?tab=external" });
  });

  it.each(["failed", "timeout", "unavailable"])(
    "gives weather down/live_check=%s the unreachable guidance with a link",
    (liveCheck) => {
      const guidance = healthCheckGuidance(
        checkRow("weather", "down", [{ key: "live_check", value: liveCheck }]),
      );
      expect(guidance).toEqual({
        cause: "Admitto could not reach the weather provider.",
        impact: "Weather forecasts may be missing.",
        nextStep:
          "Check the weather provider in External services and that this server can reach it. Then run live checks again.",
        link: { label: "Open External services", to: "/admin/settings?tab=external" },
      });
    },
  );

  it("gives weather down/live_check=support_contact_required the support-contact guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("weather", "down", [{ key: "live_check", value: "support_contact_required" }]),
    );
    expect(guidance).toEqual({
      cause: "MET Norway requires a contact address in each request, and no support contact is set.",
      impact: "Weather forecasts are not available.",
      nextStep: "Add a support contact in General settings.",
      link: { label: "Open General settings", to: "/admin/settings?tab=general" },
    });
  });

  it("gives weather degraded with no live_check or reason key the same support-contact guidance", () => {
    // The passive "no geocoding contact configured" branch (MET Norway) - no live_check,
    // no reason, just a provider key.
    const guidance = healthCheckGuidance(
      checkRow("weather", "degraded", [{ key: "provider", value: "metno" }]),
    );
    expect(guidance).toEqual({
      cause: "MET Norway requires a contact address in each request, and no support contact is set.",
      impact: "Weather forecasts are not available.",
      nextStep: "Add a support contact in General settings.",
      link: { label: "Open General settings", to: "/admin/settings?tab=general" },
    });
  });

  it("gives weather degraded/live_check=ok the slow-forecast guidance", () => {
    // weatherLiveOkRow(): a successful but slow live probe (latency >= WEATHER_DEGRADED_MS)
    // is degraded with live_check=ok, not missing entirely - a different shape from both the
    // support-contact case (no live_check) and the unreachable case (live_check=failed/etc).
    const guidance = healthCheckGuidance(
      checkRow("weather", "degraded", [
        { key: "live_check", value: "ok" },
        { key: "latency_ms", value: "2000" },
      ]),
    );
    expect(guidance).toEqual({
      cause: "The weather provider answered the last check slowly.",
      impact: "Weather forecasts may be slow to load.",
      nextStep:
        "Check the weather provider in External services and that this server can reach it. Then run live checks again.",
      link: { label: "Open External services", to: "/admin/settings?tab=external" },
    });
  });

  it("gives bounce_ingest degraded with no reason key the shared bounce guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("bounce_ingest", "degraded", [
        { key: "enabled_events", value: "3" },
        { key: "problem_events", value: "1" },
      ]),
    );
    expect(guidance).toEqual({
      cause: "For some events, the last bounce check failed or is overdue.",
      impact: "Bounced emails may not be detected for those events.",
      nextStep:
        "Check the Background worker row first. Then open Event settings for events with bounce detection turned on.",
    });
  });

  it("gives email_sending not_configured with no provider the quiet no-provider note", () => {
    const guidance = healthCheckGuidance(
      checkRow("email_sending", "not_configured", [{ key: "configured", value: "no" }]),
    );
    expect(guidance).toEqual({
      impact: "No organisation mail provider is set.",
      nextStep: "To send emails from Admitto, choose a mail provider in Mail settings.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
      quiet: true,
    });
  });

  it("gives email_sending not_configured/provider=export_only the quiet export-only note", () => {
    const guidance = healthCheckGuidance(
      checkRow("email_sending", "not_configured", [{ key: "provider", value: "export_only" }]),
    );
    expect(guidance).toEqual({
      impact: "This provider does not send emails.",
      nextStep: "To send emails from Admitto, choose a mail provider in Mail settings.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
      quiet: true,
    });
  });

  it("points an env-locked export_only provider at deployment configuration, not Mail settings", () => {
    // EMAIL_PROVIDER=export_only: describeMailConfigForOrg() marks this field locked
    // (source: "env"), so the Mail settings link would land on a read-only field.
    const guidance = healthCheckGuidance(
      checkRow("email_sending", "not_configured", [
        { key: "provider", value: "export_only" },
        { key: "source", value: "env" },
      ]),
    );
    expect(guidance).toEqual({
      impact: "This provider does not send emails.",
      nextStep:
        "Set by the EMAIL_PROVIDER environment variable, not Mail settings. Change it in your deployment configuration to send emails from Admitto.",
      quiet: true,
    });
  });

  it.each(["address_lookup", "weather", "bounce_ingest"])(
    "gives %s degraded/reason=lookup_failed the shared could-not-read guidance, not its own",
    (id) => {
      const guidance = healthCheckGuidance(
        checkRow(id, "degraded", [{ key: "reason", value: "lookup_failed" }]),
      );
      expect(guidance).toEqual({
        cause: "An error occurred while Admitto was reading the data for this check.",
        impact: "Admitto cannot tell whether this part works.",
        nextStep:
          "Reload this page. If the Database row is also down, fix that first. If the problem stays, use Copy for GitHub Issue and open an issue.",
      });
    },
  );

  it("gives every problem guidance a cause that differs from its impact, and no quiet note one", () => {
    const problems: HealthCheckRowDto[] = [
      checkRow("database", "down"),
      checkRow("database", "down", [{ key: "migrations", value: "pending" }]),
      checkRow("database", "degraded", [{ key: "migrations", value: "current" }]),
      checkRow("instance_url", "degraded"),
      checkRow("instance_url", "down"),
      checkRow("rate_limit_storage", "down"),
      checkRow("background_worker", "degraded", [{ key: "reason", value: "never_ran" }]),
      checkRow("background_worker", "degraded", [{ key: "reason", value: "stale" }]),
      checkRow("mail_delivery_queue", "degraded", [{ key: "failed_retryable", value: "2" }]),
      checkRow("mail_delivery_queue", "degraded", [
        { key: "queued", value: "80" },
        { key: "degraded_threshold", value: "50" },
      ]),
      checkRow("email_sending", "down", [{ key: "live_check", value: "failed" }]),
      checkRow("email_sending", "degraded", [{ key: "reason", value: "mail_secret_decryption_failed" }]),
      checkRow("identity_provider_x", "down", [{ key: "live_check", value: "failed" }]),
      checkRow("cloudflare_access", "down", [{ key: "direct_identity_provider", value: "missing" }]),
      checkRow("cloudflare_access", "down", [{ key: "live_check", value: "failed" }]),
      checkRow("file_storage", "down", [{ key: "reason", value: "not_writable" }]),
      checkRow("address_lookup", "degraded"),
      checkRow("address_lookup", "down"),
      checkRow("weather", "degraded", [{ key: "live_check", value: "support_contact_required" }]),
      checkRow("weather", "degraded", [{ key: "live_check", value: "ok" }]),
      checkRow("weather", "down", [{ key: "live_check", value: "timeout" }]),
      checkRow("bounce_ingest", "degraded"),
      checkRow("database", "degraded", [{ key: "reason", value: "lookup_failed" }]),
      checkRow("data_encryption", "down"),
      checkRow("rate_limit_storage", "degraded"),
      checkRow("file_storage", "degraded", [{ key: "reason", value: "not_implemented" }]),
      checkRow("file_storage", "degraded", [{ key: "reason", value: "unknown_provider" }]),
      checkRow("map_tiles", "down"),
    ];
    for (const row of problems) {
      const guidance = healthCheckGuidance(row);
      expect(guidance, `${row.id} ${row.status}`).not.toBeNull();
      expect(guidance?.cause, `${row.id} ${row.status}`).toBeTruthy();
      expect(guidance?.cause).not.toBe(guidance?.impact);
      expect(guidance?.nextStep, `${row.id} ${row.status}`).toBeTruthy();
    }
    expect(healthCheckGuidance(checkRow("email_sending", "not_configured"))?.cause).toBeUndefined();
  });

  it("gives a row whose state could not be read the lookup-failed guidance whatever its id or status", () => {
    const unreadable: Array<[string, HealthRowStatus]> = [
      ["data_encryption", "down"],
      ["data_encryption", "degraded"],
      ["rate_limit_storage", "down"],
      ["rate_limit_storage", "degraded"],
      ["database", "degraded"],
      ["instance_url", "degraded"],
      ["file_storage", "degraded"],
    ];
    for (const [id, status] of unreadable) {
      const guidance = healthCheckGuidance(checkRow(id, status, [{ key: "reason", value: "lookup_failed" }]));
      expect(guidance?.cause, `${id} ${status}`).toBe(
        "An error occurred while Admitto was reading the data for this check.",
      );
      // In particular never the key, the Redis or the address advice.
      expect(JSON.stringify(guidance), `${id} ${status}`).not.toMatch(/ENCRYPTION_KEY|Redis|BASE_URL/);
    }
  });

  it("gives file_storage down with a provider reason, and degraded with no reason, no provider guidance", () => {
    expect(
      healthCheckGuidance(checkRow("file_storage", "down", [{ key: "reason", value: "not_implemented" }])),
    ).toBe(UNRECOGNISED_STATE_GUIDANCE);
    expect(healthCheckGuidance(checkRow("file_storage", "degraded"))).toBe(UNRECOGNISED_STATE_GUIDANCE);
  });
});
