import { describe, expect, it } from "vitest";
import { healthCheckGuidance } from "../../src/settings/healthCheckGuidance.js";
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

  it("returns null for a not_configured row", () => {
    expect(healthCheckGuidance(checkRow("email_sending", "not_configured"))).toBeNull();
  });

  it("gives database down with no migrations key the missing-database-service guidance", () => {
    const guidance = healthCheckGuidance(checkRow("database", "down"));
    expect(guidance).toEqual({
      impact: "Admitto cannot read or save attendees, events or settings.",
      nextStep: "Check that the database service is running and that DATABASE_URL is correct.",
    });
  });

  it("gives database down with migrations=pending the pending-update guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("database", "down", [{ key: "migrations", value: "pending" }]),
    );
    expect(guidance).toEqual({
      impact: "The database has not been updated for this version of Admitto.",
      nextStep:
        "Run the pending database update. In Docker Compose that is the migrate service, so start it and read its log.",
    });
  });

  it("returns null for database down with an unrecognised migrations value", () => {
    const guidance = healthCheckGuidance(
      checkRow("database", "down", [{ key: "migrations", value: "something_new" }]),
    );
    expect(guidance).toBeNull();
  });

  it("gives database degraded with migrations=current the slow-pages guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("database", "degraded", [{ key: "migrations", value: "current" }]),
    );
    expect(guidance).toEqual({
      impact: "Pages may load slowly.",
      nextStep: "Reload this page to check again. If it stays slow, check how busy the database server is.",
    });
  });

  it("gives rate_limit_storage down the Redis guidance", () => {
    const guidance = healthCheckGuidance(checkRow("rate_limit_storage", "down"));
    expect(guidance).toEqual({
      impact: "Rate limits still apply, but each server counts on its own until Redis is running again.",
      nextStep: "Check that the Redis service is running and that REDIS_URL is correct.",
    });
  });

  it("returns null for rate_limit_storage degraded", () => {
    expect(healthCheckGuidance(checkRow("rate_limit_storage", "degraded"))).toBeNull();
  });

  it("gives background_worker degraded/never_ran the start-worker guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("background_worker", "degraded", [{ key: "reason", value: "never_ran" }]),
    );
    expect(guidance).toEqual({
      impact: "Queued emails, imports, exports and bounce checks may not run.",
      nextStep: "Start the worker service, then reload this page.",
    });
  });

  it("gives background_worker degraded/stale the restart-worker guidance", () => {
    const guidance = healthCheckGuidance(
      checkRow("background_worker", "degraded", [{ key: "reason", value: "stale" }]),
    );
    expect(guidance).toEqual({
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
      impact: "Emails are waiting to be sent. This is normal right after sending many emails at once.",
      nextStep: "If the number does not go down, check the Background worker, Email sending and Instance URL rows.",
    });
  });

  it("returns null for mail_delivery_queue degraded when queued is below the threshold", () => {
    const guidance = healthCheckGuidance(
      checkRow("mail_delivery_queue", "degraded", [
        { key: "failed_retryable", value: "0" },
        { key: "queued", value: "10" },
        { key: "degraded_threshold", value: "100" },
      ]),
    );
    expect(guidance).toBeNull();
  });

  it("gives email_sending down/live_check=failed the mail-connection guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("email_sending", "down", [{ key: "live_check", value: "failed" }]),
    );
    expect(guidance).toEqual({
      impact: "The mail connection test did not pass. Organisation emails may not be sent.",
      nextStep:
        "Check the mail settings and credentials, and that this server can reach the mail service. Then run live checks again.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
    });
  });

  it("returns null for email_sending down without a failed live_check", () => {
    expect(healthCheckGuidance(checkRow("email_sending", "down"))).toBeNull();
  });

  it("gives email_sending degraded/mail_secret_decryption_failed the credentials guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("email_sending", "degraded", [
        { key: "reason", value: "mail_secret_decryption_failed" },
      ]),
    );
    expect(guidance).toEqual({
      impact: "Admitto cannot read the saved mail credentials.",
      nextStep: "Enter the mail credentials again in Mail settings, or restore the previous ENCRYPTION_KEY.",
      link: { label: "Open Mail settings", to: "/admin/settings?tab=mail" },
    });
  });

  it("gives an identity_provider_* row down/live_check=failed the sign-in guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("identity_provider_idp-1", "down", [{ key: "live_check", value: "failed" }]),
    );
    expect(guidance).toEqual({
      impact: "Staff may not be able to sign in with this provider.",
      nextStep:
        "Check the provider's URLs in Identity settings and that this server can reach them. Then run live checks again.",
      link: { label: "Open Identity settings", to: "/admin/settings/identity/providers" },
    });
  });

  it("returns null for an identity_provider_* row down without a failed live_check", () => {
    expect(healthCheckGuidance(checkRow("identity_provider_idp-1", "down"))).toBeNull();
  });

  it("gives cloudflare_access down/direct_identity_provider=missing the choose-provider guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("cloudflare_access", "down", [
        { key: "direct_identity_provider", value: "missing" },
      ]),
    );
    expect(guidance).toEqual({
      impact: "Cloudflare Access is turned on but has no enabled direct identity provider.",
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
    expect(guidance?.impact).toBe(
      "Cloudflare Access is turned on but has no enabled direct identity provider.",
    );
  });

  it("gives cloudflare_access down/live_check=failed the connection-test guidance with a link", () => {
    const guidance = healthCheckGuidance(
      checkRow("cloudflare_access", "down", [{ key: "live_check", value: "failed" }]),
    );
    expect(guidance).toEqual({
      impact: "The Cloudflare Access connection test did not pass, so sign-ins through it may not work.",
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
        impact: "Admitto could not read the data for this check, so it cannot tell whether it works.",
        nextStep:
          "Reload this page. If the Database row is also down, fix that first. If the problem stays, use Copy for GitHub Issue and open an issue.",
      });
    },
  );

  it("returns null for an unrecognised check id with no lookup_failed reason", () => {
    expect(healthCheckGuidance(checkRow("map_tiles", "down"))).toBeNull();
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
      impact: "Admitto could not read the data for this check, so it cannot tell whether it works.",
      nextStep:
        "Reload this page. If the Database row is also down, fix that first. If the problem stays, use Copy for GitHub Issue and open an issue.",
    });
  });
});
