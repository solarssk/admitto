import type { HealthOverallStatus, HealthReportDto, HealthRowStatus } from "../api/types.js";

/** Detail keys safe to include in a public GitHub issue body (ADR 0037 whitelist). */
const MARKDOWN_SAFE_DETAIL_KEYS = new Set([
  "status",
  "latency_ms",
  "migrations",
  "queued",
  "failed_retryable",
  "degraded_threshold",
  "provider",
  "configured",
  "mode",
  "providers",
  "enabled",
  "live_check",
  "availability",
  "source",
  "engine",
  "algorithm",
  "endpoint",
  "max_zoom",
  "attribution",
  "protocol",
  "display_name",
  "audiences",
  "last_checked",
]);

const DETAIL_LABELS: Record<string, string> = {
  latency_ms: "Latency",
  failed_retryable: "Failed retryable",
  degraded_threshold: "Degraded threshold",
  live_check: "Live check",
  display_name: "Display name",
  max_zoom: "Max zoom",
  last_checked: "Last checked",
};

/** Operator-facing label for a detail key (avoids raw `latency_ms` → "Latency Ms"). */
export function formatHealthDetailLabel(key: string): string {
  return DETAIL_LABELS[key] ?? key.replaceAll("_", " ");
}

/** Append units to numeric detail values where helpful (`2` → `2 ms`). */
export function formatHealthDetailValue(key: string, value: string): string {
  switch (key) {
    case "latency_ms":
      return /^\d+$/.test(value) ? `${value} ms` : value;
    case "queued":
    case "failed_retryable":
    case "degraded_threshold":
      return /^\d+$/.test(value) ? `${value} messages` : value;
    case "max_zoom":
      return /^\d+$/.test(value) ? `z${value}` : value;
    default:
      return value;
  }
}

function overallLabel(status: HealthOverallStatus): string {
  if (status === "ok") return "Healthy";
  if (status === "degraded") return "Degraded";
  return "Outage";
}

function rowStatusLabel(status: HealthRowStatus): string {
  switch (status) {
    case "ok":
      return "ok";
    case "degraded":
      return "degraded";
    case "down":
      return "down";
    case "not_configured":
      return "not_configured";
    case "planned":
      return "planned";
  }
}

function escapeCell(value: string): string {
  return value.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");
}

function appendGroupTable(
  lines: string[],
  group: HealthReportDto["groups"][number],
): void {
  lines.push(
    `#### ${group.label}`,
    `_${group.subtitle}_`,
    "",
    "| Check | Status | Summary |",
    "| --- | --- | --- |",
  );
  for (const check of group.checks) {
    lines.push(
      `| ${escapeCell(check.label)} | ${rowStatusLabel(check.status)} | ${escapeCell(check.summary)} |`,
    );
  }
  lines.push("");
}

function appendGroupDetails(
  lines: string[],
  group: HealthReportDto["groups"][number],
): void {
  const expanded = group.checks.filter((c) =>
    c.details.some((d) => MARKDOWN_SAFE_DETAIL_KEYS.has(d.key) && d.key !== "last_checked"),
  );
  if (expanded.length === 0) return;

  lines.push("<details>", `<summary>${group.label} details</summary>`, "");
  for (const check of expanded) {
    const safe = check.details.filter(
      (d) => MARKDOWN_SAFE_DETAIL_KEYS.has(d.key) && d.key !== "url",
    );
    if (safe.length === 0) continue;
    lines.push(`**${check.label}**`);
    for (const d of safe) {
      lines.push(
        `- ${formatHealthDetailLabel(d.key)}: ${formatHealthDetailValue(d.key, d.value)}`,
      );
    }
    lines.push("");
  }
  lines.push("</details>", "");
}

/**
 * Build a GitHub-issue-safe Markdown snapshot from a health report.
 * Omits instance URLs and any detail keys outside the ADR 0037 whitelist.
 */
export function formatHealthCheckMarkdown(report: HealthReportDto): string {
  const lines: string[] = [
    "### Admitto health snapshot",
    `- Version: v${report.version} (${report.commit})`,
    `- Generated: ${report.generated_at}`,
    `- Overall: ${overallLabel(report.overall)}`,
    "",
  ];

  for (const group of report.groups) {
    appendGroupTable(lines, group);
    appendGroupDetails(lines, group);
  }

  return lines.join("\n").trimEnd() + "\n";
}
