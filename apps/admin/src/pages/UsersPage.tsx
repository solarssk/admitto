import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  IconButton,
  PageHeader,
  Spinner,
  StatusBadge,
  Tabs,
} from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ApiError, fetchAdminUsers, revokeUserSessions } from "../api/client.js";
import type { UserListItemDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InviteUserModal } from "./users/InviteUserModal.js";
import { UserEditModal } from "./users/UserEditModal.js";
import { RoleAssignmentsTab } from "./users/RoleAssignmentsTab.js";
import "./users-page.css";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;

type UsersTab = "staff" | "roles";
type RoleFilter = "all" | "superadmin" | "admin" | "operator";
type StatusFilter = "all" | "active" | "disabled";

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function roleBadgeVariant(role: string): "error" | "warn" | "info" | "neutral" {
  if (role === "superadmin") return "error";
  if (role === "admin") return "warn";
  if (role === "operator") return "info";
  return "neutral";
}

function roleShort(role: string): string {
  if (role === "superadmin") return "SA";
  if (role === "admin") return "AD";
  if (role === "operator") return "OP";
  return role.slice(0, 2).toUpperCase();
}

function userMatchesRoleFilter(user: UserListItemDto, filter: RoleFilter): boolean {
  if (filter === "all") return true;
  return user.roles.some((r) => r.role === filter);
}

function userMatchesStatusFilter(user: UserListItemDto, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return user.is_active;
  return !user.is_active;
}

/** IAM page — staff users and role assignments (/admin/users). */
export function UsersPage() {
  const { assignments } = useAuth();
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

  const load = useCallback(async () => {
    if (!superadmin) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUsers({ q: searchQuery || undefined, page, pageSize: PAGE_SIZE });
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [superadmin, searchQuery, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredUsers = useMemo(
    () =>
      users.filter(
        (u) => userMatchesRoleFilter(u, roleFilter) && userMatchesStatusFilter(u, statusFilter),
      ),
    [users, roleFilter, statusFilter],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleRevokeSessions = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeUserSessions(revokeTarget.id);
      setRevokeTarget(null);
      await load();
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : "Failed to revoke sessions.");
    } finally {
      setRevoking(false);
    }
  };

  const tabs = [
    ...(superadmin
      ? [{ id: "staff" as const, label: "Staff users", count: total }]
      : []),
    { id: "roles" as const, label: "Role assignments" },
  ];

  return (
    <>
      <PageHeader
        title="Users & roles"
        subtitle="Manage staff accounts, roles, and access"
      />

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(id) => setTab(id as UsersTab)}
      />

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
                onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
              >
                <option value="all">All roles</option>
                <option value="superadmin">Superadmin</option>
                <option value="admin">Admin</option>
                <option value="operator">Operator</option>
              </select>
              <select
                className="at-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <Button type="button" variant="primary" onClick={() => setInviteOpen(true)}>
              Invite user
            </Button>
          </div>

          {loading && (
            <div className="users-page__status" role="status">
              <Spinner label="Loading users" />
            </div>
          )}

          {!loading && error && (
            <div className="users-page__status">
              <p>{error}</p>
              <Button type="button" variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          )}

          {!loading && !error && filteredUsers.length === 0 && (
            <p className="users-page__status">No users match your filters.</p>
          )}

          {!loading && !error && filteredUsers.length > 0 && (
            <>
              <div className="users-page__table-wrap">
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
                    {filteredUsers.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div className="users-page__user-cell">
                            <Avatar
                              name={user.display_name ?? user.email}
                              size="sm"
                            />
                            <div className="users-page__user-meta">
                              <div className="users-page__user-name">
                                {user.display_name ?? user.email}
                              </div>
                              <div className="users-page__user-email">{user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="users-page__roles">
                            {user.roles.length === 0 && "—"}
                            {user.roles.map((role) => (
                              <Badge
                                key={role.id}
                                variant={roleBadgeVariant(role.role)}
                                title={role.is_oidc ? "Managed by identity provider" : undefined}
                              >
                                {role.is_oidc && (
                                  <i className="ti ti-cloud" aria-hidden="true" />
                                )}{" "}
                                {roleShort(role.role)}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td>
                          <span className="users-page__mfa">
                            {user.has_mfa ? (
                              <>
                                <i
                                  className="ti ti-shield-check"
                                  style={{ color: "var(--status-ok)" }}
                                  aria-hidden="true"
                                />
                                TOTP
                              </>
                            ) : (
                              <>
                                <i
                                  className="ti ti-shield-off"
                                  style={{ color: "var(--text-disabled)" }}
                                  aria-hidden="true"
                                />
                                None
                              </>
                            )}
                          </span>
                        </td>
                        <td>{formatRelativeTime(user.last_login_at)}</td>
                        <td>
                          <span
                            className={`users-page__sessions-badge ${
                              user.active_sessions_count > 0
                                ? "users-page__sessions-badge--active"
                                : "users-page__sessions-badge--empty"
                            }`}
                          >
                            {user.active_sessions_count}
                          </span>
                        </td>
                        <td>
                          {user.is_active ? (
                            <StatusBadge status="ok" label="Active" />
                          ) : (
                            <StatusBadge status="neutral" label="Disabled" />
                          )}
                        </td>
                        <td>
                          <div className="users-page__actions">
                            <IconButton
                              icon="ti ti-pencil"
                              label="Edit user"
                              onClick={() => setEditUser(user)}
                            />
                            <IconButton
                              icon="ti ti-arrows-clockwise"
                              label="Reset sessions"
                              onClick={() => setRevokeTarget(user)}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="users-page__foot">
                <span>
                  Showing {filteredUsers.length} on this page · {total} total
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
          Staff user management is available to superadmins. You can review and revoke operator
          role assignments on the Role assignments tab.
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
        onCreated={() => void load()}
      />

      <UserEditModal
        open={!!editUser}
        user={editUser}
        onClose={() => setEditUser(null)}
        onUpdated={() => void load()}
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
