import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Card, EmptyState, Notice, Tooltip, useToast } from "@admitto/ui";
import type { NoticeVariant } from "@admitto/ui";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { fetchAdminHealth, runAdminHealthLive } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  HealthCheckRowDto,
  HealthGroupDto,
  HealthReportDto,
  HealthRowStatus,
} from "../api/types.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { formatEventDateTime, getBrowserTimeZone } from "../utils/event-dates.js";
import {
  formatHealthDisplayLabel,
  formatHealthDisplayValue,
  visibleHealthDetails,
  workerLastSeenFact,
} from "./healthCheckDisplay.js";
import { healthCheckGuidance } from "./healthCheckGuidance.js";
import { formatHealthCheckMarkdown } from "./healthCheckMarkdown.js";
import "./health-check.css";

const CHECK_ICONS: Record<string, string> = {
  database: "database",
  rate_limit_storage: "server-2",
  data_encryption: "lock",
  background_worker: "activity-heartbeat",
  mail_delivery_queue: "mail-forward",
  instance_url: "link",
  file_storage: "folder",
  email_sending: "mail",
  bounce_ingest: "mail-exclamation",
  wallet_passes: "wallet",
  address_lookup: "map-pin",
  map_tiles: "map-2",
  weather: "cloud",
  identity_providers: "shield-lock",
  cloudflare_access: "brand-cloudflare",
};

/** Shared by the "Run live checks" tooltip and its mirror item in More actions (mobile). */
export const LIVE_CHECKS_HINT =
  "Adds tests for address lookup, weather, the mail connection, identity providers, Cloudflare Access, and writing to the upload folder.";

function checkIcon(id: string): string {
  if (id.startsWith("identity_provider_")) return "shield-lock";
  return CHECK_ICONS[id] ?? "circle-dot";
}

type RowStatusMeta = {
  /** Tabler icon suffix shown inside the status circle. */
  glyph: string;
  circleVariant: "ok" | "warn" | "error" | "neutral";
  /** Full word for the sr-only "Status: X" span, shown on every row including healthy ones. */
  srWord: string;
  /** Visible badge next to the label; omitted entirely for a healthy row. */
  badge: { variant: "warn" | "error" | "neutral"; word: string } | null;
  /** Row wrapper class: border tone for warn/err, a quiet label for not_configured, none for ok. */
  toneClass: string;
  /** Stable sort order within a group: down, degraded, ok, not_configured. */
  sortRank: number;
};

/** The server never emits `planned` (ADR 0037), so it has no entry here; `rowStatusMeta()`
 * below falls back to the `not_configured` treatment for it defensively. */
const ROW_STATUS_META: Record<Exclude<HealthRowStatus, "planned">, RowStatusMeta> = {
  down: {
    glyph: "x",
    circleVariant: "error",
    srWord: "Down",
    badge: { variant: "error", word: "Down" },
    toneClass: "health-check__row--err",
    sortRank: 0,
  },
  degraded: {
    glyph: "alert-triangle",
    circleVariant: "warn",
    srWord: "Degraded",
    badge: { variant: "warn", word: "Degraded" },
    toneClass: "health-check__row--warn",
    sortRank: 1,
  },
  ok: {
    glyph: "check",
    circleVariant: "ok",
    srWord: "Healthy",
    badge: null,
    toneClass: "",
    sortRank: 2,
  },
  not_configured: {
    glyph: "minus",
    circleVariant: "neutral",
    srWord: "Not configured",
    badge: { variant: "neutral", word: "Not configured" },
    toneClass: "health-check__row--quiet",
    sortRank: 3,
  },
};

function rowStatusMeta(status: HealthRowStatus): RowStatusMeta {
  if (status === "planned") return ROW_STATUS_META.not_configured;
  return ROW_STATUS_META[status];
}

/** Down and degraded rows default to open; everything else default-collapsed. */
function isProblemStatus(status: HealthRowStatus): boolean {
  return status === "down" || status === "degraded";
}

/** A user's manual expand/collapse choice for one row, pinned to the status it was made
 * against - ignored once a later report shows a different status for that row (see
 * `isRowExpanded` below), so a row collapsed while degraded re-opens once it goes down. */
type ExpandOverride = { status: HealthRowStatus; open: boolean };

function isRowExpanded(check: HealthCheckRowDto, override: ExpandOverride | undefined): boolean {
  if (override && override.status === check.status) return override.open;
  return isProblemStatus(check.status);
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

/** Tallies down/degraded checks across every group. Not configured and planned rows never
 * count, matching `worstHealthStatus()` on the backend. */
function tallyHealthChecks(report: HealthReportDto): { down: number; degraded: number } {
  let down = 0;
  let degraded = 0;
  for (const group of report.groups) {
    for (const check of group.checks) {
      if (check.status === "down") down++;
      else if (check.status === "degraded") degraded++;
    }
  }
  return { down, degraded };
}

function pluralCheck(count: number): string {
  return count === 1 ? "check" : "checks";
}

function pluralVerb(count: number): string {
  return count === 1 ? "is" : "are";
}

/** One tally of `check.status` decides both wording and colour; no fallback to `report.overall`,
 * since with real API data both come from the same roll-up. */
function healthVerdictText(report: HealthReportDto): string {
  const { down, degraded } = tallyHealthChecks(report);
  if (down === 0 && degraded === 0) return "No problems found.";
  if (down > 0 && degraded > 0) {
    return `${down} ${pluralCheck(down)} ${pluralVerb(down)} down and ${degraded} ${pluralVerb(degraded)} degraded.`;
  }
  if (down > 0) return `${down} ${pluralCheck(down)} ${pluralVerb(down)} down.`;
  return `${degraded} ${pluralCheck(degraded)} ${pluralVerb(degraded)} degraded.`;
}

function healthVerdictVariant(report: HealthReportDto): NoticeVariant {
  const { down, degraded } = tallyHealthChecks(report);
  if (down > 0) return "error";
  if (degraded > 0) return "warning";
  return "success";
}

function HealthCheckRowView({
  check,
  expanded,
  onToggle,
  generatedAt,
  timezone,
}: Readonly<{
  check: HealthCheckRowDto;
  expanded: boolean;
  onToggle: () => void;
  generatedAt: string;
  timezone: string;
}>) {
  const icon = checkIcon(check.id);
  const meta = rowStatusMeta(check.status);
  const workerFact = workerLastSeenFact(check, generatedAt);
  const details = visibleHealthDetails(check, timezone, workerFact !== null);
  const guidance = healthCheckGuidance(check);
  return (
    <div
      className={[
        "health-check__row",
        meta.toneClass,
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
          className={`status-circle status-circle--sm status-circle--${meta.circleVariant}`}
          aria-hidden="true"
        >
          <i className={`ti ti-${meta.glyph}`} />
        </span>
        <span className="sr-only">{`Status: ${meta.srWord}`}</span>
        <span className="health-check__row-icon" aria-hidden="true">
          <i className={`ti ti-${icon}`} />
        </span>
        <span className="health-check__row-text">
          <strong>{check.label}</strong>
          {meta.badge && (
            <Badge
              variant={meta.badge.variant}
              dot={meta.badge.variant !== "neutral"}
              outline={meta.badge.variant === "neutral"}
              aria-hidden="true"
            >
              {meta.badge.word}
            </Badge>
          )}
          <span className="health-check__summary">{check.summary}</span>
          {workerFact && <span className="health-check__worker-fact">{workerFact}</span>}
        </span>
        <i
          className={`ti ti-chevron-${expanded ? "up" : "down"} health-check__chevron`}
          aria-hidden="true"
        />
      </button>
      {expanded && (guidance || details.length > 0) && (
        <div className="health-check__body">
          {guidance && (
            <div
              className={
                guidance.quiet ? "health-check__guidance health-check__guidance--quiet" : "health-check__guidance"
              }
            >
              <p>{guidance.impact}</p>
              <p>
                {guidance.nextStep}
                {guidance.link && (
                  <>
                    {" "}
                    <Link className="health-check__guidance-link" to={guidance.link.to}>
                      {guidance.link.label}
                      <i className="ti ti-arrow-right" aria-hidden="true" />
                    </Link>
                  </>
                )}
              </p>
            </div>
          )}
          {details.length > 0 && (
            <dl className="health-check__details">
              {details.map((d) => (
                <div key={d.key} className="health-check__detail">
                  <dt>{formatHealthDisplayLabel(d.key)}</dt>
                  <dd>{formatHealthDisplayValue(d.key, d.value, timezone)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
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
  isExpanded,
  onToggle,
  generatedAt,
  timezone,
}: Readonly<{
  group: HealthGroupDto;
  isExpanded: (check: HealthCheckRowDto) => boolean;
  onToggle: (check: HealthCheckRowDto) => void;
  generatedAt: string;
  timezone: string;
}>) {
  const icon = GROUP_ICONS[group.id] ?? "circle-dot";
  return (
    <section className="health-check__section" aria-labelledby={`health-group-${group.id}`}>
      <header className="health-check__section-header">
        <span className="health-check__section-icon" aria-hidden="true">
          <i className={`ti ti-${icon}`} />
        </span>
        <div className="health-check__section-text">
          <h2 id={`health-group-${group.id}`} className="health-check__section-title">
            {group.label}
          </h2>
          <p className="health-check__section-subtitle">{group.subtitle}</p>
        </div>
      </header>
      <ul className="health-check__list">
        {group.checks.map((check) => (
          <li key={check.id}>
            <HealthCheckRowView
              check={check}
              expanded={isExpanded(check)}
              onToggle={() => onToggle(check)}
              generatedAt={generatedAt}
              timezone={timezone}
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
        <div className="more-actions-menu__panel at-scroll" role="menu" ref={panelRef} style={panelStyle}>
          {/* Mirrors the standalone "Run live checks" button in the header — hidden there and
              shown only here below the header's mobile breakpoint (health-check.css), so the
              header stays one row instead of wrapping. */}
          <MoreActionsMenuItem
            className="health-check__live-menu-item"
            icon="refresh"
            label="Run live checks"
            hint={LIVE_CHECKS_HINT}
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

/** Organisation Settings → Health check (ADR 0037).
 *
 * `isActive` is whether this tab is the one showing. The Settings page keeps a visited tab mounted,
 * so without it the report loaded on the first visit would stay on screen after an operator
 * followed a guidance link to another tab, fixed the setting there, and came back. */
export function HealthCheckPanel({ isActive = true }: Readonly<{ isActive?: boolean }> = {}) {
  const { addToast } = useToast();
  const [report, setReport] = useState<HealthReportDto | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandOverride, setExpandOverride] = useState<Record<string, ExpandOverride>>({});
  // Bumped when an explicit load starts (first visit, Retry) and when live checks finish, so a plain
  // read that was still in flight cannot land afterwards and replace live results, or a report from
  // a load that started after it, with an older one. The quiet read on returning to the tab only
  // takes the current number and never bumps it: it must not discard a first load or a Retry that is
  // still running, which is the only source of a report while none is on screen yet.
  const reportGeneration = useRef(0);

  const sortedGroups = useMemo<HealthGroupDto[]>(() => {
    if (!report) return [];
    return report.groups.map((group) => ({
      ...group,
      checks: [...group.checks].sort(
        (a, b) => rowStatusMeta(a.status).sortRank - rowStatusMeta(b.status).sortRank,
      ),
    }));
  }, [report]);

  /** Drops (not just bypasses) any override whose pinned status no longer matches the row's
   * current one, every time a new report arrives. Without this, a row collapsed while degraded
   * that goes down and later reverts back to degraded would resurrect the stale collapse,
   * since its status would once again equal the override's own - the override must not survive
   * past the first status change, however many reports follow it. */
  useEffect(() => {
    if (!report) return;
    const statusById = new Map<string, HealthRowStatus>();
    for (const group of report.groups) {
      for (const check of group.checks) statusById.set(check.id, check.status);
    }
    setExpandOverride((prev) => {
      let changed = false;
      const next: Record<string, ExpandOverride> = {};
      for (const [id, override] of Object.entries(prev)) {
        if (statusById.get(id) === override.status) next[id] = override;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [report]);

  const loadPassive = useCallback(async (signal?: AbortSignal) => {
    const generation = ++reportGeneration.current;
    setInitialLoading(true);
    setError(null);
    try {
      const data = await fetchAdminHealth(signal);
      if (signal?.aborted || generation !== reportGeneration.current) return;
      setReport(data);
      setError(null);
    } catch (err) {
      if (signal?.aborted || generation !== reportGeneration.current) return;
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

  // Returning to this tab reads the report again, quietly: the previous report stays on screen
  // (no loading state, and a failed read keeps it) and is replaced when the new one arrives.
  const wasActive = useRef(isActive);
  useEffect(() => {
    const returned = isActive && !wasActive.current;
    wasActive.current = isActive;
    if (!returned) return;
    const ac = new AbortController();
    const generation = reportGeneration.current;
    fetchAdminHealth(ac.signal)
      .then((data) => {
        if (!ac.signal.aborted && generation === reportGeneration.current) setReport(data);
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [isActive]);

  const toggleExpanded = useCallback((check: HealthCheckRowDto) => {
    setExpandOverride((prev) => ({
      ...prev,
      [check.id]: { status: check.status, open: !isRowExpanded(check, prev[check.id]) },
    }));
  }, []);

  const isExpanded = useCallback(
    (check: HealthCheckRowDto) => isRowExpanded(check, expandOverride[check.id]),
    [expandOverride],
  );

  const handleLive = async () => {
    setLiveLoading(true);
    try {
      const data = await runAdminHealthLive();
      setReport(data);
      reportGeneration.current += 1;
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

  const timezone = getBrowserTimeZone();

  return (
    <div className="settings-sections health-check">
      <Card
        className="health-check__card"
        title="Overview"
        actions={
          <div className="health-check__actions">
            <Tooltip content={LIVE_CHECKS_HINT} className="health-check__run-live-trigger">
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
        <p className="settings-card-intro">
          Review whether this instance and its integrations are healthy before an event, or copy a
          sanitized snapshot when opening a support issue.
        </p>
        <p className="health-check__meta">
          Generated{" "}
          <time dateTime={report.generated_at}>
            {formatEventDateTime(report.generated_at, timezone)}
          </time>
          {runningBuildLabel()}
        </p>

        <Notice as="p" variant={healthVerdictVariant(report)} className="health-check__verdict">
          {healthVerdictText(report)}
        </Notice>

        <div className="health-check__groups">
          {sortedGroups.map((group) => (
            <HealthGroupSection
              key={group.id}
              group={group}
              isExpanded={isExpanded}
              onToggle={toggleExpanded}
              generatedAt={report.generated_at}
              timezone={timezone}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
