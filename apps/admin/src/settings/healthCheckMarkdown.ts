import type {
  HealthCheckRowDto,
  HealthOverallStatus,
  HealthReportDto,
  HealthRowStatus,
} from "../api/types.js";

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
  "max_zoom",
  "attribution",
  "protocol",
  "audiences",
  "last_checked",
  "reason",
]);
// "endpoint" (a tile server, identity provider, or Cloudflare Access hostname) and
// "display_name" (an org-set identity provider name) are deliberately NOT on this list: both
// can identify the instance or its organisation, and the ADR 0037 dump is a public GitHub issue
// body (see exportSafeLabel() below for how a check's own label is likewise generalised).

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

/**
 * Export-only value transform, layered on top of {@link formatHealthDetailValue}. The Superadmin
 * tab may show an exact detail value the public "Copy for GitHub Issue" dump should not: an
 * exact database patch version (e.g. "PostgreSQL 16.2") is a lookup key for known
 * vulnerabilities in that version, so the export coarsens it to the major version only
 * ("PostgreSQL 16"). formatHealthDetailValue() itself stays UI-safe for the tab.
 */
function exportSafeDetailValue(key: string, value: string): string {
  const formatted = formatHealthDetailValue(key, value);
  if (key === "engine") return formatted.replace(/^(\D*\d+)\.\d+.*$/, "$1");
  return formatted;
}

/**
 * A check's own label can carry identifying detail: an identity provider's label embeds its
 * org-set display name, and map tiles embeds the tile server's hostname (health-check-routes.ts
 * `identityProviderRowLabel`, `mapTilesServiceLabel`). Both are useful in the Superadmin-only
 * tab, but the "Copy for GitHub Issue" dump is public, so the export uses a fixed, generic label
 * per check id instead - removing the unsafe detail keys alone would not be enough, since the
 * label itself is emitted verbatim in both the table and the details heading.
 */
function exportSafeLabel(check: HealthCheckRowDto): string {
  if (check.id.startsWith("identity_provider_")) {
    const protocol = check.details.find((d) => d.key === "protocol")?.value;
    return protocol ? `Identity provider, ${protocol}` : "Identity provider";
  }
  if (check.id === "map_tiles") return "Map tiles";
  return check.label;
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
  return escapeMarkdownText(value);
}

/** Normalize line breaks and escape Markdown/HTML control characters for issue dumps. */
function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", String.raw`\|`)
    .replaceAll("\r\n", " ")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ")
    .replaceAll("`", String.raw`\``)
    .replaceAll("*", String.raw`\*`)
    .replaceAll("_", String.raw`\_`)
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function appendGroupTable(
  lines: string[],
  group: HealthReportDto["groups"][number],
): void {
  lines.push(
    `#### ${escapeMarkdownText(group.label)}`,
    `_${escapeMarkdownText(group.subtitle)}_`,
    "",
    "| Check | Status | Summary |",
    "| --- | --- | --- |",
  );
  for (const check of group.checks) {
    lines.push(
      `| ${escapeCell(exportSafeLabel(check))} | ${rowStatusLabel(check.status)} | ${escapeCell(check.summary)} |`,
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

  lines.push("<details>", `<summary>${escapeMarkdownText(group.label)} details</summary>`, "");
  for (const check of expanded) {
    const safe = check.details.filter(
      (d) => MARKDOWN_SAFE_DETAIL_KEYS.has(d.key) && d.key !== "url",
    );
    lines.push(`**${escapeMarkdownText(exportSafeLabel(check))}**`);
    for (const d of safe) {
      lines.push(
        `- ${formatHealthDetailLabel(d.key)}: ${escapeMarkdownText(exportSafeDetailValue(d.key, d.value))}`,
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
