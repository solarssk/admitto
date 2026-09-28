import { describe, expect, it } from "vitest";
import {
  formatHealthCheckMarkdown,
  formatHealthDetailLabel,
  formatHealthDetailValue,
} from "../../src/settings/healthCheckMarkdown.js";
import type { HealthReportDto } from "../../src/api/types.js";

const sample: HealthReportDto = {
  generated_at: "2026-08-03T12:54:24.000Z",
  version: "0.4.13",
  commit: "a955ac9",
  overall: "degraded",
  groups: [
    {
      id: "core",
      label: "Core infrastructure",
      subtitle: "Owned and run by this instance",
      status: "degraded",
      checks: [
        {
          id: "database",
          label: "Database",
          status: "ok",
          summary: "Connected",
          details: [
            { key: "status", value: "ok" },
            { key: "latency_ms", value: "4" },
            { key: "url", value: "https://secret.example.com" },
          ],
        },
        {
          id: "mail_delivery_queue",
          label: "Mail delivery queue",
          status: "degraded",
          summary: "Falling behind · 218 queued",
          details: [
            { key: "queued", value: "218" },
            { key: "failed_retryable", value: "0" },
          ],
        },
      ],
    },
    {
      id: "external",
      label: "External integrations",
      subtitle: "Third-party APIs this instance depends on",
      status: "ok",
      checks: [
        {
          id: "wallet_passes",
          label: "Wallet passes (PassCreator)",
          status: "planned",
          summary: "Coming in v0.6",
          details: [{ key: "availability", value: "later_release" }],
        },
      ],
    },
  ],
};

describe("formatHealthDetailLabel / formatHealthDetailValue", () => {
  it("uses friendly labels and units for known keys", () => {
    expect(formatHealthDetailLabel("latency_ms")).toBe("Latency");
    expect(formatHealthDetailLabel("failed_retryable")).toBe("Failed retryable");
    expect(formatHealthDetailLabel("custom_key")).toBe("custom key");
    expect(formatHealthDetailValue("latency_ms", "12")).toBe("12 ms");
    expect(formatHealthDetailValue("latency_ms", "slow")).toBe("slow");
    expect(formatHealthDetailValue("queued", "3")).toBe("3 messages");
    expect(formatHealthDetailValue("max_zoom", "19")).toBe("z19");
    expect(formatHealthDetailValue("max_zoom", "n/a")).toBe("n/a");
    expect(formatHealthDetailValue("provider", "smtp")).toBe("smtp");
    // Unlike the export (see the hostile-fixture describe block below), the UI-facing formatter
    // keeps the exact database patch version - the tab is Superadmin only.
    expect(formatHealthDetailValue("engine", "PostgreSQL 16.2")).toBe("PostgreSQL 16.2");
  });
});

describe("formatHealthCheckMarkdown", () => {
  it("emits grouped tables and omits instance URLs", () => {
    const md = formatHealthCheckMarkdown(sample);
    expect(md).toContain("### Admitto health snapshot");
    expect(md).toContain("Overall: Degraded");
    expect(md).toContain("#### Core infrastructure");
    expect(md).toContain("| Database | ok | Connected |");
    expect(md).toContain("#### External integrations");
    expect(md).not.toContain("secret.example.com");
    expect(md).toContain("Latency: 4 ms");
    expect(md).toContain("queued: 218 messages");
  });

  it("escapes Markdown and HTML control characters in values", () => {
    const md = formatHealthCheckMarkdown({
      ...sample,
      overall: "ok",
      groups: [
        {
          id: "core",
          label: "Core *infra*",
          subtitle: "Owned <by> this instance",
          status: "ok",
          checks: [
            {
              id: "database",
              label: "Database | primary",
              status: "ok",
              summary: "Line1\nLine2",
              details: [
                { key: "provider", value: "smtp_*x*` <script>" },
                { key: "status", value: "ok" },
              ],
            },
          ],
        },
      ],
    });
    expect(md).toContain("#### Core \\*infra\\*");
    expect(md).toContain("Owned &lt;by&gt; this instance");
    expect(md).toContain("| Database \\| primary | ok | Line1 Line2 |");
    expect(md).toContain("smtp\\_\\*x\\*\\` &lt;script&gt;");
    expect(md).not.toContain("<script>");
  });

  it("formats non-numeric detail values without units and labels all row statuses", () => {
    expect(formatHealthDetailValue("queued", "n/a")).toBe("n/a");
    expect(formatHealthDetailValue("failed_retryable", "n/a")).toBe("n/a");
    expect(formatHealthDetailValue("degraded_threshold", "n/a")).toBe("n/a");

    const md = formatHealthCheckMarkdown({
      ...sample,
      overall: "ok",
      groups: [
        {
          id: "core",
          label: "Core",
          subtitle: "Owned",
          status: "ok",
          checks: [
            {
              id: "a",
              label: "A",
              status: "degraded",
              summary: "Slow",
              details: [{ key: "status", value: "degraded" }],
            },
            {
              id: "b",
              label: "B",
              status: "down",
              summary: "Down",
              details: [{ key: "status", value: "down" }],
            },
            {
              id: "c",
              label: "C",
              status: "not_configured",
              summary: "Missing",
              details: [{ key: "status", value: "not_configured" }],
            },
          ],
        },
      ],
    });
    expect(md).toContain("Overall: Healthy");
    expect(md).toContain("| A | degraded | Slow |");
    expect(md).toContain("| B | down | Down |");
    expect(md).toContain("| C | not_configured | Missing |");
  });

  it("emits Outage overall and skips details blocks with only unsafe keys", () => {
    const md = formatHealthCheckMarkdown({
      ...sample,
      overall: "down",
      groups: [
        {
          id: "core",
          label: "Core infrastructure",
          subtitle: "Owned and run by this instance",
          status: "down",
          checks: [
            {
              id: "instance_url",
              label: "Instance URL",
              status: "down",
              summary: "Not configured",
              details: [{ key: "url", value: "https://tickets.example.com" }],
            },
          ],
        },
      ],
    });
    expect(md).toContain("Overall: Outage");
    expect(md).not.toContain("<details>");
    expect(md).not.toContain("tickets.example.com");
  });
});

describe("formatHealthCheckMarkdown - export-safe labels (ADR 0037)", () => {
  /** A hostile fixture: an org-set identity provider name and a self-hosted tile host, each
   * carrying content that would be a problem in a public GitHub issue on its own terms - a
   * GitHub @mention, a "#1" that GitHub would read as a cross-reference, and a Markdown link to
   * an attacker's URL - on top of just being the org's or the deployment's own identifying
   * detail. None of it should reach the exported text at all, not merely be escaped. */
  const hostileReport: HealthReportDto = {
    generated_at: "2026-08-03T12:54:24.000Z",
    version: "0.4.13",
    commit: "a955ac9",
    overall: "ok",
    groups: [
      {
        id: "core",
        label: "Core infrastructure",
        subtitle: "Owned and run by this instance",
        status: "ok",
        checks: [
          {
            id: "database",
            label: "Database",
            status: "ok",
            summary: "Connected",
            details: [{ key: "engine", value: "PostgreSQL 16.2" }],
          },
        ],
      },
      {
        id: "external",
        label: "External integrations",
        subtitle: "Third-party APIs this instance depends on",
        status: "ok",
        checks: [
          {
            id: "identity_provider_9f2c1e3a-0000-4000-8000-000000000000",
            label: 'Identity provider, OIDC - Acme Corp @user #1 [x](http://evil.example)',
            status: "ok",
            summary: "Configured · enabled",
            details: [
              { key: "protocol", value: "OIDC" },
              { key: "display_name", value: "Acme Corp @user #1 [x](http://evil.example)" },
            ],
          },
          {
            id: "map_tiles",
            label: "Map tiles, tiles.acme-corp-internal.example.com",
            status: "ok",
            summary: "Configured",
            details: [{ key: "max_zoom", value: "19" }],
          },
        ],
      },
    ],
  };

  it("replaces an identity provider's org-set display name with a generic protocol label", () => {
    const md = formatHealthCheckMarkdown(hostileReport);
    expect(md).toContain("| Identity provider, OIDC | ok | Configured · enabled |");
    expect(md).toContain("**Identity provider, OIDC**");
    expect(md).not.toContain("Acme Corp");
    expect(md).not.toContain("@user");
    expect(md).not.toContain("http://evil.example");
    expect(md).not.toContain("display_name");
  });

  it("replaces the map tiles hostname with a fixed generic label", () => {
    const md = formatHealthCheckMarkdown(hostileReport);
    expect(md).toContain("| Map tiles | ok | Configured |");
    expect(md).toContain("**Map tiles**");
    expect(md).not.toContain("tiles.acme-corp-internal");
  });

  it("coarsens the database engine to its major version", () => {
    const md = formatHealthCheckMarkdown(hostileReport);
    expect(md).toContain("engine: PostgreSQL 16");
    expect(md).not.toContain("16.2");
  });

  it("leaves an engine value unchanged when it has no digit run followed by a dot and digit", () => {
    const noVersion = { ...hostileReport, groups: [withEngine("PostgreSQL")] };
    expect(formatHealthCheckMarkdown(noVersion)).toContain("engine: PostgreSQL");

    const trailingDot = { ...hostileReport, groups: [withEngine("PostgreSQL 16.")] };
    expect(formatHealthCheckMarkdown(trailingDot)).toContain("engine: PostgreSQL 16.");

    function withEngine(engine: string) {
      return {
        id: "core" as const,
        label: "Core infrastructure",
        subtitle: "Owned and run by this instance",
        status: "ok" as const,
        checks: [
          {
            id: "database",
            label: "Database",
            status: "ok" as const,
            summary: "Connected",
            details: [{ key: "engine", value: engine }],
          },
        ],
      };
    }
  });

  it("falls back to a bare 'Identity provider' label when the protocol detail is missing", () => {
    const md = formatHealthCheckMarkdown({
      ...hostileReport,
      groups: [
        {
          id: "external",
          label: "External integrations",
          subtitle: "Third-party APIs this instance depends on",
          status: "ok",
          checks: [
            {
              id: "identity_provider_9f2c1e3a-0000-4000-8000-000000000000",
              label: "Identity provider, SAML - Acme Corp",
              status: "ok",
              summary: "Configured · enabled",
              details: [],
            },
          ],
        },
      ],
    });
    expect(md).toContain("| Identity provider | ok | Configured · enabled |");
    expect(md).not.toContain("Acme Corp");
  });
});
