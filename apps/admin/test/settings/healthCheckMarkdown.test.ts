import { describe, expect, it } from "vitest";
import { formatHealthCheckMarkdown } from "../../src/settings/healthCheckMarkdown.js";
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
});
