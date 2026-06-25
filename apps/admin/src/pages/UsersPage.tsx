import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  useToast,
} from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ApiError, fetchAdminUsers, revokeUserSessions } from "../api/client.js";
import type { UserListItemDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InviteUserModal } from "./users/InviteUserModal.js";
import { UserEditModal } from "./users/UserEditModal.js";
import { RoleAssignmentsTab } from "./users/RoleAssignmentsTab.js";
import { StaffUserCard, StaffUserTableRow } from "./users/StaffUserListItem.js";
import "./users-page.css";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;
const SKELETON_ROWS = 5;

type UsersTab = "staff" | "roles";
type RoleFilter = "all" | "superadmin" | "admin" | "operator";
type StatusFilter = "all" | "active" | "disabled";

function StaffUsersSkeleton() {
  return (
    <>
      <div className="users-page__table-wrap users-page__table-wrap--desktop" aria-hidden="true">
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Roles</th>
              <th>MFA</th>
              <th>Last login</th>
              <th>Sessions</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={i}>
                <td colSpan={7}>
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
  const [tab, setTab] = useState<UsersTab>(superadmin ? "staff" : "roles");
  const [users, setUsers] = useState<UserListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!superadmin) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUsers(
        {
          q: searchQuery || undefined,
          page,
          pageSize: PAGE_SIZE,
          role: roleFilter,
          status: statusFilter,
        },
        signal,
      );
      if (signal?.aborted) return;
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      setError(err instanceof ApiError ? err.message : "Failed to load users.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [superadmin, searchQuery, page, roleFilter, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive =
    searchQuery.length > 0 || roleFilter !== "all" || statusFilter !== "all";
  const showInitialEmpty = !loading && !error && total === 0 && !filtersActive;

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
      const message = err instanceof ApiError ? err.message : "Failed to revoke sessions.";
      setRevokeError(message);
      addToast(message, "error");
    } finally {
      setRevoking(false);
    }
  };

  const tabs = [
    ...(superadmin ? [{ id: "staff" as const, label: "Staff users", count: total }] : []),
    { id: "roles" as const, label: "Role assignments" },
  ];

  return (
    <>
      <PageHeader title="Users & roles" subtitle="Manage staff accounts, roles, and access" />

      <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as UsersTab)} />

      {tab === "staff" && superadmin && (
        <Card>
          <div className="users-page__toolbar">
            <label className="users-page__search">
              <i className="ti ti-search" aria-hidden="true" />
              <input
                type="search"
                placeholder="Search name or email"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </label>
            <div className="users-page__filters">
              <select
                className="at-select"
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value as RoleFilter);
                  setPage(1);
                }}
              >
                <option value="all">All roles</option>
                <option value="superadmin">Superadmin</option>
                <option value="admin">Admin</option>
                <option value="operator">Operator</option>
              </select>
              <select
                className="at-select"
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
            <Button type="button" variant="primary" className="users-page__invite-btn" onClick={() => setInviteOpen(true)}>
              Invite user
            </Button>
          </div>

          {loading && <StaffUsersSkeleton />}

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
                      <th>MFA</th>
                      <th>Last login</th>
                      <th>Sessions</th>
                      <th>Status</th>
                      <th>Actions</th>
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

              <div className="users-page__foot">
                <span>
                  Showing {users.length} on this page · {total} total
                </span>
                <div className="users-page__actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
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
        <Card>
          <RoleAssignmentsTab />
        </Card>
      )}

      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={(user, message) => {
          void load();
          if (message) {
            addToast(message, "error");
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
        confirmLabel="Revoke sessions"
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
    </>
  );
}
