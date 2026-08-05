import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  useToast,
} from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { roleLabel } from "../auth/role-labels.js";
import { fetchAdminUsers, fetchUserStats, revokeUserSessions } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { UserListItemDto, UserStatsDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { paginationHandlers, PaginationFooter } from "../components/PaginationFooter.js";
import { ScrollFadeTabs } from "../components/ScrollFadeTabs.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { InviteUserModal } from "./users/InviteUserModal.js";
import { UserEditModal } from "./users/UserEditModal.js";
import { RoleAssignmentsTab } from "./users/RoleAssignmentsTab.js";
import { ActiveSessionsTab } from "./users/ActiveSessionsTab.js";
import { StaffUserCard, StaffUserTableRow } from "./users/StaffUserListItem.js";
import "./users-page.css";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const SKELETON_ROWS = 5;

type UsersTab = "staff" | "roles" | "sessions";
type RoleFilter = "all" | "superadmin" | "admin" | "operator";
type StatusFilter = "all" | "active" | "disabled";

/** Resolve the active tab from `?tab=`, gating superadmin-only tabs the same way the render already does. */
function usersTabFromSearch(params: URLSearchParams, superadmin: boolean): UsersTab {
  const raw = params.get("tab");
  if (raw === "sessions" && superadmin) return "sessions";
  if (raw === "staff" && superadmin) return "staff";
  if (raw === "roles") return "roles";
  return superadmin ? "staff" : "roles";
}

function StaffUsersSkeleton() {
  return (
    <>
      <div className="users-page__table-wrap users-page__table-wrap--desktop" aria-hidden="true">
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Roles</th>
              <th>Sign-in</th>
              <th>MFA</th>
              <th>Last login</th>
              <th>Sessions</th>
              <th>Status</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={i}>
                <td colSpan={8}>
                  <Skeleton variant="rect" height={52} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="users-page__cards users-page__cards--mobile" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} variant="rect" height={180} className="users-page__card-skeleton" />
        ))}
      </div>
    </>
  );
}

/** IAM page — staff users and role assignments (/admin/users). */
export function UsersPage() {
  const { assignments } = useAuth();
  const { addToast } = useToast();
  const superadmin = isSuperadmin(assignments);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<UsersTab>(() => usersTabFromSearch(searchParams, superadmin));
  const [users, setUsers] = useState<UserListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserListItemDto | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<UserListItemDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [sessionsCount, setSessionsCount] = useState<number | undefined>(undefined);
  const [stats, setStats] = useState<UserStatsDto | null>(null);

  // The URL is the source of truth for the active tab (e.g. the Security tab's
  // "Manage individual sessions" link deep-links here with ?tab=sessions). Realign on
  // any external param change (Back navigation, a fresh deep link).
  useEffect(() => {
    const target = usersTabFromSearch(searchParams, superadmin);
    if (target !== tab) setTab(target);
  }, [searchParams, superadmin, tab]);

  // Lets the debounce timer below compare against the *currently committed* search value
  // without adding `searchQuery` itself as a dependency (which would reschedule this effect
  // on every unrelated re-render that changes it, e.g. a role/status filter reload).
  const committedSearchRef = useRef(searchQuery);
  useEffect(() => {
    committedSearchRef.current = searchQuery;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      // A no-op tick - mount with an empty search box, or typing back to the already-committed
      // value inside the debounce window - must not touch page/query: unconditionally calling
      // setPage(1) here fires once on every mount (nothing to debounce yet) and can reset the
      // page out from under an operator who paginates within SEARCH_DEBOUNCE_MS of opening the tab.
      if (trimmed === committedSearchRef.current) return;
      setSearchQuery(trimmed);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!superadmin) return;
    setLoading(true);
    setError(null);
    try {
      const [data, statsData] = await Promise.all([
        fetchAdminUsers(
          {
            q: searchQuery || undefined,
            page,
            pageSize,
            role: roleFilter,
            status: statusFilter,
          },
          signal,
        ),
        fetchUserStats(signal),
      ]);
      if (signal?.aborted) return;
      setUsers(data.users);
      setTotal(data.total);
      setStats(statsData);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      setError(operatorApiErrorMessage(err, "Failed to load users."));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [superadmin, searchQuery, page, pageSize, roleFilter, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtersActive =
    searchQuery.length > 0 || roleFilter !== "all" || statusFilter !== "all";
  const showInitialEmpty = !loading && !error && total === 0 && !filtersActive;
  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // the skeleton on and off faster than it can register as loading — show it only once
  // the fetch has genuinely taken a moment.
  const showLoadingSkeleton = useDelayedLoading(loading);

  const handleRevokeSessions = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeUserSessions(revokeTarget.id);
      const label = revokeTarget.display_name ?? revokeTarget.email;
      setRevokeTarget(null);
      addToast(`Sessions revoked for ${label}`, "success");
      await load();
    } catch (err) {
      const message = operatorApiErrorMessage(err, "Failed to revoke sessions.");
      setRevokeError(message);
      addToast(message, "error");
    } finally {
      setRevoking(false);
    }
  };

  const tabs = [
    ...(superadmin ? [{ id: "staff" as const, label: "Staff users", count: total }] : []),
    { id: "roles" as const, label: "Role assignments" },
    ...(superadmin ? [{ id: "sessions" as const, label: "Active sessions", count: sessionsCount }] : []),
  ];

  const mfaPct = stats && stats.total > 0 ? Math.round((stats.mfa / stats.total) * 100) : 0;

  return (
    <div className="screen">
      <PageHeader
        title="Users & roles"
        subtitle="Manage staff accounts, roles, and access"
        actions={
          superadmin && (
            <Button
              type="button"
              variant="primary"
              icon={<i className="ti ti-user-plus" aria-hidden="true" />}
              onClick={() => setInviteOpen(true)}
            >
              Invite user
            </Button>
          )
        }
      />

      {superadmin && stats && (
        <div className="users-page__stats">
          <Card className="users-page__stat-card">
            <div className="users-page__stat">
              <div className="users-page__stat-icon users-page__stat-icon--neutral">
                <i className="ti ti-users" aria-hidden="true" />
              </div>
              <div className="users-page__stat-body">
                <span className="users-page__stat-value">{stats.total}</span>
                <span className="users-page__stat-label">Staff users</span>
                <span className="users-page__stat-sub">{stats.active} active</span>
              </div>
            </div>
          </Card>
          <Card className="users-page__stat-card">
            <div className="users-page__stat">
              <div className="users-page__stat-icon users-page__stat-icon--info">
                <i className="ti ti-cloud-lock" aria-hidden="true" />
              </div>
              <div className="users-page__stat-body">
                <span className="users-page__stat-value">{stats.sso}</span>
                <span className="users-page__stat-label">Via SSO</span>
                <span className="users-page__stat-sub">of {stats.total} total</span>
              </div>
            </div>
          </Card>
          <Card className="users-page__stat-card">
            <div className="users-page__stat">
              <div
                className={`users-page__stat-icon users-page__stat-icon--${mfaPct === 100 ? "ok" : "warn"}`}
              >
                <i className="ti ti-shield-check" aria-hidden="true" />
              </div>
              <div className="users-page__stat-body">
                <span className="users-page__stat-value">{mfaPct}%</span>
                <span className="users-page__stat-label">MFA coverage</span>
                <span className="users-page__stat-sub">{stats.mfa} of {stats.total} enrolled</span>
              </div>
            </div>
          </Card>
          <Card className="users-page__stat-card">
            <div className="users-page__stat">
              <div className="users-page__stat-icon users-page__stat-icon--ok">
                <i className="ti ti-plug-connected" aria-hidden="true" />
              </div>
              <div className="users-page__stat-body">
                <span className="users-page__stat-value">{stats.active_sessions}</span>
                <span className="users-page__stat-label">Active sessions</span>
                <span className="users-page__stat-sub">across {stats.active_sessions_users} users</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      <ScrollFadeTabs
        tabs={tabs}
        value={tab}
        onChange={(id) => setSearchParams({ tab: id }, { replace: true })}
      />

      {tab === "staff" && superadmin && (
        <Card title="Staff users">
          <div className="users-page__toolbar">
            <label className="users-page__search">
              <i className="ti ti-search" aria-hidden="true" />
              <input
                id="users-search"
                name="users-search"
                type="search"
                aria-label="Search users by name or email"
                placeholder="Search name or email"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </label>
            <div className="users-page__filters">
              <select
                id="users-role-filter"
                name="users-role-filter"
                className="at-select"
                aria-label="Filter users by role"
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value as RoleFilter);
                  setPage(1);
                }}
              >
                <option value="all">All roles</option>
                <option value="superadmin">{roleLabel("superadmin")}</option>
                <option value="admin">{roleLabel("admin")}</option>
                <option value="operator">{roleLabel("operator")}</option>
              </select>
              <select
                id="users-status-filter"
                name="users-status-filter"
                className="at-select"
                aria-label="Filter users by status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilter);
                  setPage(1);
                }}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          </div>

          {loading && showLoadingSkeleton && <StaffUsersSkeleton />}

          {!loading && error && (
            <div className="users-page__status">
              <p>{error}</p>
              <Button type="button" variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          )}

          {!loading && !error && showInitialEmpty && (
            <EmptyState
              icon={<i className="ti ti-users-group" aria-hidden="true" />}
              title="No users yet"
              description="Invite your first team member to get started."
              action={
                <Button type="button" variant="primary" onClick={() => setInviteOpen(true)}>
                  Invite user
                </Button>
              }
            />
          )}

          {!loading && !error && !showInitialEmpty && users.length === 0 && (
            <EmptyState
              icon={<i className="ti ti-filter-off" aria-hidden="true" />}
              title="No users match your filters"
              description="Try a different search term or clear the role and status filters."
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSearchInput("");
                    setRoleFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          )}

          {!loading && !error && users.length > 0 && (
            <>
              <div className="users-page__table-wrap users-page__table-wrap--desktop">
                <table className="table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Roles</th>
                      <th>Sign-in</th>
                      <th>MFA</th>
                      <th>Last login</th>
                      <th>Sessions</th>
                      <th>Status</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <StaffUserTableRow
                        key={user.id}
                        user={user}
                        onEdit={setEditUser}
                        onRevokeSessions={setRevokeTarget}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="users-page__cards users-page__cards--mobile">
                {users.map((user) => (
                  <StaffUserCard
                    key={user.id}
                    user={user}
                    onEdit={setEditUser}
                    onRevokeSessions={setRevokeTarget}
                  />
                ))}
              </div>

              <PaginationFooter
                idPrefix="staff-users"
                page={page}
                pageSize={pageSize}
                totalPages={totalPages}
                totalRows={total}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                {...paginationHandlers(setPage, setPageSize, totalPages)}
              />
            </>
          )}
        </Card>
      )}

      {tab === "staff" && !superadmin && (
        <p className="users-page__admin-note">
          Staff user management is available to superadmins. You can review and revoke operator role
          assignments on the Role assignments tab.
        </p>
      )}

      {tab === "roles" && (
        <Card title="Role assignments">
          <RoleAssignmentsTab onAssignmentsChanged={() => void load()} />
        </Card>
      )}

      {superadmin && (
        // Always mounted (not just once "sessions" becomes active) so its session count is
        // ready for the tab label immediately on page load, matching how "Staff users"'s own
        // count is already fetched regardless of which tab is initially active - only visibility
        // is gated on the active tab, same convention as SettingsPage's own tab panels.
        // className="screen" (not a plain div) so ActiveSessionsTab's two Cards (Sessions, Bulk
        // revoke operator sessions) keep the same 18px gap between them as every other top-level
        // section on this page - a bare wrapper div here would have flattened them in as its own
        // un-gapped children instead of the outer .screen's.
        <div className="screen" hidden={tab !== "sessions"}>
          <ActiveSessionsTab onCountChange={setSessionsCount} />
        </div>
      )}

      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={({ user, warning }) => {
          void load();
          if (warning) {
            addToast(warning, "error");
          } else {
            addToast(`${user.email} invited successfully`, "success");
          }
        }}
      />

      <UserEditModal
        open={!!editUser}
        user={editUser}
        onClose={() => setEditUser(null)}
        onUpdated={(user, message) => {
          addToast(message ?? `${user.display_name ?? user.email} updated`, "success");
          void load();
        }}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke all sessions"
        message={
          revokeTarget
            ? `End all active sessions for ${revokeTarget.display_name ?? revokeTarget.email}?`
            : ""
        }
        errorMessage={revokeError}
        confirmLabel="Revoke"
        confirmVariant="danger"
        loading={revoking}
        onConfirm={() => void handleRevokeSessions()}
        onCancel={() => {
          if (!revoking) {
            setRevokeTarget(null);
            setRevokeError(null);
          }
        }}
      />
    </div>
  );
}
