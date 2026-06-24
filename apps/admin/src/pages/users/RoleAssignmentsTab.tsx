import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "@admitto/ui";
import { ApiError, fetchRoleAssignments, revokeUserRole } from "../../api/client.js";
import type { RoleAssignmentListItemDto } from "../../api/types.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { isSuperadmin } from "../../auth/capabilities.js";

function scopeLabel(row: RoleAssignmentListItemDto): string {
  if (row.scope_type === "event" && row.event) return row.event.title;
  if (row.scope_type === "organization" && row.organization) return row.organization.name;
  return row.scope_id ?? "—";
}

function mapRevokeError(message: string): string {
  if (message.includes("managed_by_idp")) {
    return "This role is managed by an identity provider and cannot be removed.";
  }
  if (message.includes("last_superadmin")) {
    return "Cannot remove the last superadmin assignment.";
  }
  return message;
}

/** Role assignments tab — per-event/org grants with revoke action. */
export function RoleAssignmentsTab() {
  const { assignments } = useAuth();
  const canRevokeAll = isSuperadmin(assignments);
  const [rows, setRows] = useState<RoleAssignmentListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const [confirmTarget, setConfirmTarget] = useState<RoleAssignmentListItemDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRoleAssignments({ page, pageSize });
      setRows(data.assignments);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load role assignments.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleRevoke = async () => {
    if (!confirmTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeUserRole(confirmTarget.user_id, confirmTarget.id);
      setConfirmTarget(null);
      await load();
    } catch (err) {
      setRevokeError(err instanceof ApiError ? mapRevokeError(err.message) : "Failed to revoke role.");
    } finally {
      setRevoking(false);
    }
  };

  const canRevokeRow = (row: RoleAssignmentListItemDto) => {
    if (row.is_oidc) return false;
    if (canRevokeAll) return true;
    return row.role === "operator" && row.scope_type === "event";
  };

  return (
    <>
      {loading && <p className="users-page__status">Loading…</p>}
      {!loading && error && (
        <div className="users-page__status">
          <p>{error}</p>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="users-page__status">No role assignments yet.</p>
      )}
      {!loading && !error && rows.length > 0 && (
        <>
          <div className="users-page__table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Granted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{scopeLabel(row)}</td>
                    <td>
                      <div>{row.user_display_name ?? row.user_email}</div>
                      {row.user_display_name && (
                        <div className="users-page__user-email">{row.user_email}</div>
                      )}
                    </td>
                    <td>
                      <Badge variant="neutral">{row.role}</Badge>
                      {row.is_oidc && (
                        <span className="users-page__role-oidc" title="Managed by identity provider">
                          <i className="ti ti-cloud" aria-hidden="true" />
                        </span>
                      )}
                    </td>
                    <td>{new Date(row.granted_at).toLocaleDateString()}</td>
                    <td>
                      {canRevokeRow(row) ? (
                        <Button type="button" variant="danger" onClick={() => setConfirmTarget(row)}>
                          Revoke
                        </Button>
                      ) : (
                        <span className="form-hint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="users-page__foot">
            <span>
              Page {page} of {totalPages} · {total} assignment{total === 1 ? "" : "s"}
            </span>
            <div className="users-page__actions">
              <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
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

      <ConfirmDialog
        open={!!confirmTarget}
        title="Revoke role assignment"
        message={
          confirmTarget
            ? `Remove ${confirmTarget.role} access for ${confirmTarget.user_display_name ?? confirmTarget.user_email}?`
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
