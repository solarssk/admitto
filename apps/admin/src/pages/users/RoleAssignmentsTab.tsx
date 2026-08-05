import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, EmptyState, HintLabel, IconButton, Skeleton, Tooltip, useToast } from "@admitto/ui";
import { useDelayedLoading } from "../../hooks/useDelayedLoading.js";
import { fetchAdminEvents, fetchRoleAssignments, revokeUserRole } from "../../api/client.js";
import { operatorApiErrorMessage } from "../../api/operator-api-error.js";
import type { EventDto, RoleAssignmentListItemDto } from "../../api/types.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { FiltersMenu } from "../../components/FiltersMenu.js";
import { paginationHandlers, PaginationFooter } from "../../components/PaginationFooter.js";
import { SearchableSelect } from "../../components/SearchableSelect.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { isSuperadmin } from "../../auth/capabilities.js";
import { roleBadgeVariant, roleLabel } from "../../auth/role-labels.js";
import { formatUtcDateTime, zonedTimeLabel } from "../../utils/event-dates.js";

const SKELETON_ROWS = 4;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const SEARCH_DEBOUNCE_MS = 300;

/** Cached per locale+zone, same shape as Active sessions' own "Logged in" column - this table
 * has no live-poll ticking it every render, so a per-render `new Map()` here would be needless. */
const hourMinuteFormatCache = new Map<string, Intl.DateTimeFormat>();

function hourMinuteFormat(timeZone: string): Intl.DateTimeFormat {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const key = `${locale}\0${timeZone}`;
  let format = hourMinuteFormatCache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    hourMinuteFormatCache.set(key, format);
  }
  return format;
}

/** The grant instant, converted to whoever is currently viewing the table's own browser
 * timezone - a role grant has no captured actor timezone (unlike Audit log entries), so this
 * matches Active sessions' own "no known actor zone" convention rather than fabricating one. */
function viewerLocalTime(iso: string): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hhmm = hourMinuteFormat(timeZone).format(new Date(iso));
  return `${hhmm} ${zonedTimeLabel(iso, timeZone)}`;
}

const GRANTED_HINT = "Top: when this role was granted, in UTC. Below: the same moment in your own local time.";

function scopeLabel(row: RoleAssignmentListItemDto): string {
  if (row.scope_type === "event" && row.event) return row.event.title;
  if (row.scope_type === "organization" && row.organization) return row.organization.name;
  return row.scope_id ?? "-";
}

/** Small icon-in-circle badge for the Scope column, same `.at-avatar` shape Staff users and
 * Active sessions already use for their own User column - event vs organization here instead
 * of a person's initials. */
function ScopeCell({ row }: Readonly<{ row: RoleAssignmentListItemDto }>) {
  const isOrg = row.scope_type === "organization";
  return (
    <div className="users-page__user-cell">
      <span className="at-avatar at-avatar--sm" title={isOrg ? "Organization scope" : "Event scope"}>
        <i className={`ti ti-${isOrg ? "building" : "calendar-event"}`} aria-hidden="true" />
      </span>
      {scopeLabel(row)}
    </div>
  );
}

type AssignmentRowProps = {
  row: RoleAssignmentListItemDto;
  canRevoke: boolean;
  onRevoke: (row: RoleAssignmentListItemDto) => void;
};

function AssignmentTableRow({ row, canRevoke, onRevoke }: Readonly<AssignmentRowProps>) {
  return (
    <tr>
      <td>
        <ScopeCell row={row} />
      </td>
      <td>
        <div>{row.user_display_name ?? row.user_email}</div>
        {row.user_display_name && <div className="users-page__user-email">{row.user_email}</div>}
      </td>
      <td>
        <Badge variant={roleBadgeVariant(row.role)}>{roleLabel(row.role)}</Badge>
        {row.is_oidc && (
          <span className="users-page__role-oidc" title="Managed by identity provider">
            <i className="ti ti-cloud" aria-hidden="true" />
          </span>
        )}
      </td>
      <td>
        {formatUtcDateTime(row.granted_at)}
        <div className="sessions-subdued">{viewerLocalTime(row.granted_at)}</div>
      </td>
      <td>
        {canRevoke ? (
          <Tooltip content="Revoke assignment">
            <IconButton
              icon={<i className="ti ti-trash" aria-hidden="true" />}
              label={`Revoke ${roleLabel(row.role)} for ${row.user_display_name ?? row.user_email}`}
              size="sm"
              className="users-page__icon-danger"
              onClick={() => onRevoke(row)}
            />
          </Tooltip>
        ) : (
          <span className="form-hint">-</span>
        )}
      </td>
    </tr>
  );
}

function AssignmentCard({ row, canRevoke, onRevoke }: Readonly<AssignmentRowProps>) {
  return (
    <article className="users-page__card users-page__card--assignment">
      <div className="users-page__card-head">
        <div>
          <div className="users-page__user-name">{row.user_display_name ?? row.user_email}</div>
          {row.user_display_name && <div className="users-page__user-email">{row.user_email}</div>}
        </div>
        <div className="sessions-card-head-end">
          <Badge variant={roleBadgeVariant(row.role)}>{roleLabel(row.role)}</Badge>
          {canRevoke && (
            <Tooltip content="Revoke assignment">
              <IconButton
                icon={<i className="ti ti-trash" aria-hidden="true" />}
                label={`Revoke ${roleLabel(row.role)} for ${row.user_display_name ?? row.user_email}`}
                size="sm"
                className="users-page__icon-danger"
                onClick={() => onRevoke(row)}
              />
            </Tooltip>
          )}
        </div>
      </div>
      <dl className="users-page__card-meta">
        <div>
          <dt>Scope</dt>
          <dd>
            <ScopeCell row={row} />
          </dd>
        </div>
        <div>
          <dt>Granted</dt>
          <dd>
            {formatUtcDateTime(row.granted_at)}
            <div className="sessions-subdued">{viewerLocalTime(row.granted_at)}</div>
          </dd>
        </div>
        {row.is_oidc && (
          <div>
            <dt>Source</dt>
            <dd>
              <span className="users-page__role-oidc" title="Managed by identity provider">
                <i className="ti ti-cloud" aria-hidden="true" /> Identity provider
              </span>
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}

type RoleAssignmentsTabProps = {
  /** Called after a successful revoke so the parent's Staff users list (and any open Edit
   * modal, which renders from that same list) picks up the change without a full page reload. */
  onAssignmentsChanged?: () => void;
  /** Reports the total row count so the parent can show it on the tab label, matching Staff
   * users and Active sessions. */
  onCountChange?: (count: number) => void;
};

/** Role assignments tab — per-event/org grants with revoke action. */
export function RoleAssignmentsTab({ onAssignmentsChanged, onCountChange }: Readonly<RoleAssignmentsTabProps>) {
  const { assignments, user: currentUser } = useAuth();
  const { addToast } = useToast();
  const canRevokeAll = isSuperadmin(assignments);
  const [rows, setRows] = useState<RoleAssignmentListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [searchInput, setSearchInput] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [events, setEvents] = useState<EventDto[]>([]);
  const [eventFilter, setEventFilter] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<RoleAssignmentListItemDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      if (trimmed === searchQuery) return;
      setSearchQuery(trimmed);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput, searchQuery]);

  useEffect(() => {
    fetchAdminEvents({ includeArchived: true })
      .then(setEvents)
      .catch(() => {});
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRoleAssignments(
        { q: searchQuery || undefined, eventId: eventFilter || undefined, page, pageSize },
        signal,
      );
      if (signal?.aborted) return;
      setRows(data.assignments);
      setTotal(data.total);
      onCountChange?.(data.total);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      setError(operatorApiErrorMessage(err, "Failed to load role assignments."));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [searchQuery, eventFilter, page, pageSize, onCountChange]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // the skeleton on and off faster than it can register as loading — show it only once
  // the fetch has genuinely taken a moment.
  const showLoadingSkeleton = useDelayedLoading(loading);

  const handleRevoke = async () => {
    if (!confirmTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeUserRole(confirmTarget.user_id, confirmTarget.id);
      const label = confirmTarget.user_display_name ?? confirmTarget.user_email;
      setConfirmTarget(null);
      addToast(`Role revoked for ${label}`, "success");
      await load();
      onAssignmentsChanged?.();
    } catch (err) {
      const message =
        operatorApiErrorMessage(err, "Failed to revoke role.");
      setRevokeError(message);
      addToast(message, "error");
    } finally {
      setRevoking(false);
    }
  };

  const canRevokeRow = (row: RoleAssignmentListItemDto) => {
    if (row.is_oidc || row.user_id === currentUser.id) return false;
    if (canRevokeAll) return true;
    return row.role === "operator" && row.scope_type === "event";
  };

  return (
    <>
      <div className="users-page__toolbar">
        <label className="users-page__search">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            ref={searchInputRef}
            id="role-assignments-search"
            name="role-assignments-search"
            type="text"
            aria-label="Search role assignments by user name or email"
            placeholder="Search name or email"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput.length > 0 && (
            <button
              type="button"
              className="users-page__search-clear"
              onClick={() => {
                setSearchInput("");
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          )}
        </label>
        <Tooltip content="Filter by event">
          <FiltersMenu activeCount={eventFilter ? 1 : 0} className="users-page-filters-menu">
            <div className="users-page-filters-menu__field">
              <label htmlFor="role-assignments-event-filter">Event</label>
              <SearchableSelect
                id="role-assignments-event-filter"
                label="Event"
                placeholder="All events"
                searchPlaceholder="Search events…"
                emptyLabel="No events found"
                value={eventFilter}
                options={[
                  { id: "", label: "All events" },
                  ...events.map((e) => ({
                    id: e.id,
                    label: `${e.title}${e.archived_at ? " (archived)" : ""}`,
                    icon: "calendar-event",
                  })),
                ]}
                onChange={(id) => {
                  setEventFilter(id);
                  setPage(1);
                }}
              />
            </div>
          </FiltersMenu>
        </Tooltip>
      </div>

      {loading && showLoadingSkeleton && (
        <>
          <div className="users-page__table-wrap users-page__table-wrap--desktop" aria-hidden="true">
            <table className="table">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Granted</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={5}>
                      <Skeleton variant="rect" height={48} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="users-page__cards users-page__cards--mobile" aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} variant="rect" height={140} className="users-page__card-skeleton" />
            ))}
          </div>
        </>
      )}

      {!loading && error && (
        <div className="users-page__status">
          <p>{error}</p>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (searchQuery || eventFilter) && (
        <EmptyState
          icon={<i className="ti ti-filter-off" aria-hidden="true" />}
          title="No role assignments match your filters"
          description="Try a different name, email, or event."
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSearchInput("");
                setEventFilter("");
              }}
            >
              Clear filters
            </Button>
          }
        />
      )}

      {!loading && !error && rows.length === 0 && !searchQuery && !eventFilter && (
        <EmptyState
          icon={<i className="ti ti-shield" aria-hidden="true" />}
          title="No role assignments yet"
          description="Event and organization role grants will appear here once users are assigned."
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="users-page__table-wrap users-page__table-wrap--desktop">
            <table className="table">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>User</th>
                  <th>Role</th>
                  <th><HintLabel hint={GRANTED_HINT}>Granted</HintLabel></th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <AssignmentTableRow
                    key={row.id}
                    row={row}
                    canRevoke={canRevokeRow(row)}
                    onRevoke={setConfirmTarget}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="users-page__cards users-page__cards--mobile">
            {rows.map((row) => (
              <AssignmentCard
                key={row.id}
                row={row}
                canRevoke={canRevokeRow(row)}
                onRevoke={setConfirmTarget}
              />
            ))}
          </div>

          <PaginationFooter
            idPrefix="role-assignments"
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            totalRows={total}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            {...paginationHandlers(setPage, setPageSize, totalPages)}
          />
        </>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Revoke role assignment"
        message={
          confirmTarget
            ? `Remove ${roleLabel(confirmTarget.role)} access for ${confirmTarget.user_display_name ?? confirmTarget.user_email}?`
            : ""
        }
        errorMessage={revokeError}
        confirmLabel="Revoke"
        confirmVariant="danger"
        loading={revoking}
        onConfirm={() => void handleRevoke()}
        onCancel={() => {
          if (!revoking) {
            setConfirmTarget(null);
            setRevokeError(null);
          }
        }}
      />
    </>
  );
}
