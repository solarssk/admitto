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
