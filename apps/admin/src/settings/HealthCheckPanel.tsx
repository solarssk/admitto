import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Tooltip, useToast } from "@admitto/ui";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { fetchAdminHealth, runAdminHealthLive } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  HealthCheckRowDto,
  HealthGroupDto,
  HealthOverallStatus,
  HealthReportDto,
  HealthRowStatus,
} from "../api/types.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { formatEventDateTime, getBrowserTimeZone } from "../utils/event-dates.js";
import { formatHealthCheckMarkdown, formatHealthDetailLabel, formatHealthDetailValue } from "./healthCheckMarkdown.js";
import "./health-check.css";

const CHECK_ICONS: Record<string, string> = {
  database: "database",
  session_storage: "server-2",
  rate_limit_storage: "server-2",
  data_encryption: "lock",
  mail_delivery_queue: "mail-forward",
  instance_url: "link",
  file_storage: "folder",
  email_sending: "mail",
  wallet_passes: "wallet",
  address_lookup: "map-pin",
  map_tiles: "map-2",
  weather: "cloud",
  identity_providers: "shield-lock",
  cloudflare_access: "brand-cloudflare",
};

function checkIcon(id: string): string {
  if (id.startsWith("identity_provider_")) return "shield-lock";
  return CHECK_ICONS[id] ?? "circle-dot";
}

function rowDotClass(status: HealthRowStatus | HealthOverallStatus): string {
  if (status === "ok") return "health-check__dot--ok";
  if (status === "degraded") return "health-check__dot--warn";
  if (status === "down") return "health-check__dot--err";
  if (status === "planned") return "health-check__dot--planned";
  return "health-check__dot--muted";
}

function rowToneClass(status: HealthRowStatus): string {
  if (status === "degraded") return "health-check__row--warn";
  if (status === "down") return "health-check__row--err";
  return "";
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so Safari/other browsers can start the download from the blob URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Same build identity as the sidebar footer (`InstanceSidebarFoot`). */
function runningBuildMeta(): { version: string; commit: string } {
  return { version: __APP_VERSION__, commit: __APP_COMMIT__ };
}

function stampRunningBuild(report: HealthReportDto): HealthReportDto {
  const { version, commit } = runningBuildMeta();
  return { ...report, version, commit };
}

/** Label suffix for Overview meta / tests (` · vX.Y.Z · abcdef0`). */
export function formatRunningBuildLabel(version: string, commit: string): string {
  return commit !== "unknown" ? ` · v${version} · ${commit}` : ` · v${version}`;
}

function runningBuildLabel(): string {
  const { version, commit } = runningBuildMeta();
  return formatRunningBuildLabel(version, commit);
}

const ROW_STATUS_TEXT: Record<HealthRowStatus, string> = {
  ok: "Healthy",
  degraded: "Degraded",
  down: "Down",
  not_configured: "Not configured",
  planned: "Planned",
};

function HealthCheckRowView({
  check,
  expanded,
  onToggle,
}: Readonly<{
  check: HealthCheckRowDto;
  expanded: boolean;
  onToggle: () => void;
}>) {
  const icon = checkIcon(check.id);
  return (
    <div
      className={[
        "health-check__row",
        rowToneClass(check.status),
        expanded ? "health-check__row--expanded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="health-check__row-btn"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span
          className={`health-check__dot ${rowDotClass(check.status)}`}
          aria-hidden="true"
        />
        <span className="sr-only">{`Status: ${ROW_STATUS_TEXT[check.status]}`}</span>
        <span className="health-check__row-icon" aria-hidden="true">
          <i className={`ti ti-${icon}`} />
        </span>
        <span className="health-check__row-text">
          <strong>{check.label}</strong>
          <span>{check.summary}</span>
        </span>
        <i
          className={`ti ti-chevron-${expanded ? "up" : "down"} health-check__chevron`}
          aria-hidden="true"
        />
      </button>
      {expanded && check.details.length > 0 && (
        <dl className="health-check__details">
          {check.details.map((d) => (
            <div key={d.key} className="health-check__detail">
              <dt>{formatHealthDetailLabel(d.key)}</dt>
              <dd>{formatHealthDetailValue(d.key, d.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const GROUP_ICONS: Record<string, string> = {
  core: "server-2",
  external: "world",
};

function HealthGroupSection({
  group,
  expandedIds,
  onToggle,
}: Readonly<{
  group: HealthGroupDto;
  expandedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}>) {
  const icon = GROUP_ICONS[group.id] ?? "circle-dot";
  return (
    <section className="health-check__section" aria-labelledby={`health-group-${group.id}`}>
      <header className="health-check__section-header">
        <span className="health-check__section-icon" aria-hidden="true">
          <i className={`ti ti-${icon}`} />
        </span>
        <div className="health-check__section-text">
          <h3 id={`health-group-${group.id}`} className="health-check__section-title">
            {group.label}
          </h3>
          <p className="health-check__section-subtitle">{group.subtitle}</p>
        </div>
      </header>
      <ul className="health-check__list">
        {group.checks.map((check) => (
          <li key={check.id}>
            <HealthCheckRowView
              check={check}
              expanded={expandedIds.has(check.id)}
              onToggle={() => onToggle(check.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function HealthCheckMoreActions({
  onExport,
  onCopy,
  onRunLive,
  liveLoading,
}: Readonly<{
  onExport: () => void;
  onCopy: () => void;
  onRunLive: () => void;
  liveLoading: boolean;
}>) {
  const { open, setOpen, close, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
  });

  return (
    <div className="more-actions-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size="sm"
        icon={<i className="ti ti-dots-vertical" aria-hidden="true" />}
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        More actions
      </Button>
      {open && (
        <div className="more-actions-menu__panel" role="menu" ref={panelRef} style={panelStyle}>
          {/* Mirrors the standalone "Run live checks" button in the header — hidden there and
              shown only here below the header's mobile breakpoint (health-check.css), so the
              header stays one row instead of wrapping. */}
          <MoreActionsMenuItem
            className="health-check__live-menu-item"
            icon="refresh"
            label="Run live checks"
            hint="Re-check local status and probe address lookup, mail transport, identity providers, and Cloudflare Access"
            disabled={liveLoading}
            onClick={() => {
              close();
              onRunLive();
            }}
          />
          <MoreActionsMenuItem
            icon="download"
            label="Export"
            hint="Download this snapshot as Markdown"
            onClick={() => {
              close();
              onExport();
            }}
          />
          <MoreActionsMenuItem
            icon="clipboard"
            label="Copy for GitHub Issue"
            hint="Copy a sanitized Markdown dump to the clipboard"
            onClick={() => {
              close();
              onCopy();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Organisation Settings → Health check (ADR 0037). */
export function HealthCheckPanel() {
  const { addToast } = useToast();
  const [report, setReport] = useState<HealthReportDto | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());

  const loadPassive = useCallback(async (signal?: AbortSignal) => {
    setInitialLoading(true);
    setError(null);
    try {
      const data = await fetchAdminHealth(signal);
      if (signal?.aborted) return;
      setReport(data);
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(operatorApiErrorMessage(err, "Could not load health checks."));
      setReport(null);
    } finally {
      if (!signal?.aborted) setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void loadPassive(ac.signal);
    return () => ac.abort();
  }, [loadPassive]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleLive = async () => {
    setLiveLoading(true);
    try {
      const data = await runAdminHealthLive();
      setReport(data);
      if (data.overall === "down") {
        addToast("Live checks finished with outages", "error");
      } else if (data.overall === "degraded") {
        addToast("Live checks finished with warnings", "warning");
      } else {
        addToast("Live checks finished", "success");
      }
    } catch (err) {
      if (hasApiErrorCode(err, "health_live_rate_limited")) {
        addToast("Too many live checks right now. Wait a moment and try again.", "error");
      } else {
        addToast(operatorApiErrorMessage(err, "Live checks failed."), "error");
      }
    } finally {
      setLiveLoading(false);
    }
  };

  if (initialLoading && !report) {
    return (
      <div className="settings-sections">
        <Card title="Overview">
          <p className="settings-card-intro">Loading health checks…</p>
        </Card>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="settings-sections">
        <EmptyState
          title="Could not load health checks"
          description={error ?? "Could not load health checks."}
          action={
            <Button type="button" variant="secondary" onClick={() => void loadPassive()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatHealthCheckMarkdown(stampRunningBuild(report)));
      addToast("Health snapshot copied to clipboard", "success");
    } catch {
      addToast("Could not copy. Clipboard access was blocked.", "error");
    }
  };

  const handleExport = () => {
    const stamp = report.generated_at.replaceAll(":", "-").slice(0, 19);
    downloadTextFile(
      `admitto-health-${stamp}.md`,
      formatHealthCheckMarkdown(stampRunningBuild(report)),
    );
    addToast("Health snapshot downloaded", "success");
  };

  return (
    <div className="settings-sections health-check">
      <Card
        className="health-check__card"
        title="Overview"
        actions={
          <div className="health-check__actions">
            <Tooltip
              content="Re-check local status and probe address lookup, mail transport (SMTP/Graph), identity providers, and Cloudflare Access when configured"
              className="health-check__run-live-trigger"
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={
                  <i
                    className={`ti ti-refresh${liveLoading ? " at-spin" : ""}`}
                    aria-hidden="true"
                  />
                }
                onClick={() => void handleLive()}
                disabled={liveLoading}
                aria-busy={liveLoading}
              >
                Run live checks
              </Button>
            </Tooltip>
            <HealthCheckMoreActions
              onExport={handleExport}
              onCopy={() => void handleCopy()}
              onRunLive={() => void handleLive()}
              liveLoading={liveLoading}
            />
          </div>
        }
      >
        <div className="health-check__intro">
          <p className="settings-card-intro health-check__intro-copy">
            Review whether this instance and its integrations are healthy before an event, or copy
            a sanitized snapshot when opening a support issue.
          </p>
          <p className="health-check__meta">
            <i className="ti ti-clock" aria-hidden="true" />
            <span>
              Generated {formatEventDateTime(report.generated_at, getBrowserTimeZone())}
              {runningBuildLabel()}
            </span>
          </p>
        </div>

        <div className="health-check__groups">
          {report.groups.map((group) => (
            <HealthGroupSection
              key={group.id}
              group={group}
              expandedIds={expandedIds}
              onToggle={toggleExpanded}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
