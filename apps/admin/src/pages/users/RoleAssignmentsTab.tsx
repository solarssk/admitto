import { useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState, Skeleton, useToast } from "@admitto/ui";
import { ApiError, fetchRoleAssignments, revokeUserRole } from "../../api/client.js";
import type { RoleAssignmentListItemDto } from "../../api/types.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { isSuperadmin } from "../../auth/capabilities.js";

const SKELETON_ROWS = 4;

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

type AssignmentRowProps = {
  row: RoleAssignmentListItemDto;
  canRevoke: boolean;
  onRevoke: (row: RoleAssignmentListItemDto) => void;
};

function AssignmentTableRow({ row, canRevoke, onRevoke }: AssignmentRowProps) {
  return (
    <tr>
      <td>{scopeLabel(row)}</td>
      <td>
        <div>{row.user_display_name ?? row.user_email}</div>
        {row.user_display_name && <div className="users-page__user-email">{row.user_email}</div>}
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
        {canRevoke ? (
          <Button type="button" variant="danger" onClick={() => onRevoke(row)}>
            Revoke
          </Button>
        ) : (
          <span className="form-hint">—</span>
        )}
      </td>
    </tr>
  );
}

function AssignmentCard({ row, canRevoke, onRevoke }: AssignmentRowProps) {
  return (
    <article className="users-page__card users-page__card--assignment">
      <div className="users-page__card-head">
        <div>
          <div className="users-page__user-name">{row.user_display_name ?? row.user_email}</div>
          {row.user_display_name && <div className="users-page__user-email">{row.user_email}</div>}
        </div>
        <Badge variant="neutral">{row.role}</Badge>
      </div>
      <dl className="users-page__card-meta">
        <div>
          <dt>Scope</dt>
          <dd>{scopeLabel(row)}</dd>
        </div>
        <div>
          <dt>Granted</dt>
          <dd>{new Date(row.granted_at).toLocaleDateString()}</dd>
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
      {canRevoke && (
        <Button type="button" variant="danger" className="users-page__card-revoke" onClick={() => onRevoke(row)}>
          Revoke assignment
        </Button>
      )}
    </article>
  );
}

/** Role assignments tab — per-event/org grants with revoke action. */
export function RoleAssignmentsTab() {
  const { assignments } = useAuth();
  const { addToast } = useToast();
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
      const label = confirmTarget.user_display_name ?? confirmTarget.user_email;
      setConfirmTarget(null);
      addToast(`Role revoked for ${label}`, "success");
      await load();
    } catch (err) {
      const message =
        err instanceof ApiError ? mapRevokeError(err.message) : "Failed to revoke role.";
      setRevokeError(message);
      addToast(message, "error");
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
      {loading && (
        <>
          <div className="users-page__table-wrap users-page__table-wrap--desktop" aria-hidden="true">
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

      {!loading && !error && rows.length === 0 && (
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
                  <th>Granted</th>
                  <th>Actions</th>
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
