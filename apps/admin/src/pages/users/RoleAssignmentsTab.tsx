import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, EmptyState, HintLabel, IconButton, Tooltip, useToast } from "@admitto/ui";
import { useDelayedLoading, useLoadingGate } from "../../hooks/useDelayedLoading.js";
import { useBusyEndCount } from "../../hooks/useRetry.js";
import { useEventOptions } from "../../hooks/useEventOptions.js";
import { useListLoad } from "../../hooks/useListLoad.js";
import { fetchRoleAssignments, revokeUserRole } from "../../api/client.js";
import { operatorApiErrorMessage } from "../../api/operator-api-error.js";
import type { RoleAssignmentListItemDto } from "../../api/types.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { FiltersMenu } from "../../components/FiltersMenu.js";
import { paginationHandlers, PaginationFooter } from "../../components/PaginationFooter.js";
import { RefetchRegion } from "../../components/RefetchRegion.js";
import { ListFailure } from "../../components/ListFailure.js";
import { RetryHint } from "../../components/RetryHint.js";
import { SearchableSelect } from "../../components/SearchableSelect.js";
import { SLOW_NOTICE_MS } from "../../utils/loading-timing.js";
import { isPastTheEnd, withAssignmentRemoved, type RoleAssignmentsAnswer } from "./list-changes.js";
import { UsersListSkeleton, type SkeletonColumn } from "./UsersListSkeleton.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { isSuperadmin } from "../../auth/capabilities.js";
import { roleBadgeVariant, roleLabel } from "../../auth/role-labels.js";
import { formatUtcDateTime, viewerLocalTime } from "../../utils/event-dates.js";

// The placeholder of the list: four rows and three cards, each as tall as a real one.
const SKELETON_ROWS = 4;
const NO_ROWS: RoleAssignmentListItemDto[] = [];
const ROLE_COLUMNS: ReadonlyArray<SkeletonColumn> = [
  { id: "scope", label: "Scope" },
  { id: "user", label: "User" },
  { id: "role", label: "Role" },
  { id: "granted", label: "Granted" },
  { id: "actions", label: <span className="sr-only">Actions</span> },
];
// GET /api/admin/role-assignments caps pageSize server-side at 50 (role-assignments-routes.ts) -
// offering a larger value here would silently request more than the server delivers,
// understating totalPages and leaving the tail of the list unreachable.
const PAGE_SIZE_OPTIONS = [25, 50] as const;
const SEARCH_DEBOUNCE_MS = 300;

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
  const label = scopeLabel(row);
  return (
    <div className="users-page__user-cell">
      <span className="at-avatar at-avatar--sm" title={isOrg ? "Organization scope" : "Event scope"}>
        <i className={`ti ti-${isOrg ? "building" : "calendar-event"}`} aria-hidden="true" />
      </span>
      <span className="users-page__scope-label" title={label}>{label}</span>
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
  onAssignmentsChanged?: (revoked: RoleAssignmentListItemDto) => void;
  /** Reports the total row count so the parent can show it on the tab label, matching Staff
   * users and Active sessions. */
  onCountChange?: (count: number | undefined) => void;
};

/** Role assignments tab — per-event/org grants with revoke action. */
export function RoleAssignmentsTab({ onAssignmentsChanged, onCountChange }: Readonly<RoleAssignmentsTabProps>) {
  const { assignments, user: currentUser } = useAuth();
  const { addToast } = useToast();
  const canRevokeAll = isSuperadmin(assignments);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [searchInput, setSearchInput] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const eventOptions = useEventOptions();
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

  // `filtersActive` is what this answer was asked with, so the empty states never describe a search still on its way.
  const fetchAssignments = useCallback(async (signal: AbortSignal): Promise<RoleAssignmentsAnswer> => {
    const data = await fetchRoleAssignments(
      { q: searchQuery || undefined, eventId: eventFilter || undefined, page, pageSize },
      signal,
    );
    return {
      rows: data.assignments,
      total: data.total,
      filtersActive: Boolean(searchQuery || eventFilter),
      pastTheEnd: isPastTheEnd(data.assignments.length, data.total, page),
    };
  }, [searchQuery, eventFilter, page, pageSize]);
  const list = useListLoad({
    fetcher: fetchAssignments,
    fallback: "Could not load role assignments.",
    onData: (data) => onCountChange?.(data.total),
  });
  const rows = list.data?.rows ?? NO_ROWS;
  // A list that gave way to an error no longer vouches for its number: the tab label shows none until it is back.
  useEffect(() => {
    if (list.error) onCountChange?.(undefined);
  }, [list.error, onCountChange]);
  const total = list.data?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // After a revoke the last page can be gone: step back to the one that is.
  useEffect(() => {
    if (list.data && page > totalPages) setPage(totalPages);
  }, [list.data, page, totalPages]);
  // The first load: a placeholder after 200ms (held before, so its room is in the page), kept at least 400ms,
  // "Taking longer than usual" after 8 seconds. A refetch never gets here: the rows stay.
  // The same wait when the answer says the page it was on is gone: it has no rows, but that is not "No role assignments".
  // The effect above steps back to the page that exists, and its answer replaces this one.
  const waiting = list.loading || (Boolean(list.data?.pastTheEnd) && !list.error);
  const gate = useLoadingGate(waiting);
  const slow = useDelayedLoading(waiting, SLOW_NOTICE_MS);
  const listReady = gate.showContent && !list.error && list.data !== null;
  const showNoMatch = listReady && rows.length === 0 && Boolean(list.data?.filtersActive);
  const showNone = listReady && rows.length === 0 && !list.data?.filtersActive;
  // An event filter that could not load its options: said out loud when it happens (the hint itself is inside the
  // Filters panel, which only exists while it is open), and again when a Retry ends with the same failure.
  const eventRetriesEnded = useBusyEndCount(eventOptions.retrying);

  const handleRevoke = async () => {
    if (!confirmTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeUserRole(confirmTarget.user_id, confirmTarget.id);
    } catch (err) {
      const message = operatorApiErrorMessage(err, "Failed to revoke role.");
      setRevokeError(message);
      addToast(message, "error");
      return;
    } finally {
      // The revoke is done (or failed): the dialog's busy state ends with it, not with the list refresh behind it.
      setRevoking(false);
    }
    const label = confirmTarget.user_display_name ?? confirmTarget.user_email;
    setConfirmTarget(null);
    addToast(`Role revoked for ${label}`, "success");
    list.update((answer) => withAssignmentRemoved(answer, confirmTarget.id, page));
    void list.reload();
    onAssignmentsChanged?.(confirmTarget);
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
                showLabel={false}
                placeholder="All events"
                searchPlaceholder="Search events…"
                emptyLabel="No events found"
                value={eventFilter}
                options={[
                  { id: "", label: "All events" },
                  ...eventOptions.events.map((e) => ({
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
              {eventOptions.error && (
                <RetryHint message={eventOptions.error} busy={eventOptions.retrying} onRetry={eventOptions.retry} />
              )}
            </div>
          </FiltersMenu>
        </Tooltip>
        <div key={eventRetriesEnded} className="sr-only" role="alert">
          {eventOptions.error}
        </div>
      </div>

      {!gate.showContent && (
        <UsersListSkeleton
          label="Loading role assignments"
          held={!gate.showIndicator}
          slow={slow}
          columns={ROLE_COLUMNS}
          rows={SKELETON_ROWS}
          rowHeight={40}
          cards={3}
          cardHeight={200}
        />
      )}

      {gate.showContent && (
        <ListFailure error={list.error} refreshError={list.refreshError} onRetry={list.reload} className="users-page__status" />
      )}

      {listReady && (
        <RefetchRegion refreshing={list.refreshing} label="Refreshing role assignments">
          {showNoMatch && (
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

          {showNone && (
            <EmptyState
              icon={<i className="ti ti-shield" aria-hidden="true" />}
              title="No role assignments yet"
              description="Event and organization role grants will appear here once users are assigned."
            />
          )}

          {rows.length > 0 && (
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
        </RefetchRegion>
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
