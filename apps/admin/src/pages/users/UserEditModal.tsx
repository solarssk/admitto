import { useEffect, useId, useRef, useState } from "react";
import { Badge, Button, ModalBackdrop, Notice, Switch } from "@admitto/ui";
import { PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import {
  ApiError,
  deleteAdminUser,
  fetchAdminEvents,
  fetchAdminOrganizations,
  grantUserRole,
  patchAdminUser,
  resetUserMfa,
  resetUserPassword,
  revokeUserRole,
} from "../../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../../api/operator-api-error.js";
import type { EventDto, UserListItemDto } from "../../api/types.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../../components/useModalFocusTrap.js";
import { roleBadgeVariant, roleLabel } from "../../auth/role-labels.js";
import { useAuth } from "../../auth/AuthProvider.js";

type UserEditModalProps = {
  open: boolean;
  user: UserListItemDto | null;
  onClose: () => void;
  onUpdated: (user: UserListItemDto, message?: string) => void;
  onDeleted: (user: UserListItemDto) => void;
};

type AssignRole = "" | "superadmin" | "admin" | "operator";

export function UserEditModal({ open, user, onClose, onUpdated, onDeleted }: Readonly<UserEditModalProps>) {
  const { user: currentUser } = useAuth();
  const titleId = useId();
  const resetPasswordTitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [newRole, setNewRole] = useState<AssignRole>("");
  const [newOrgId, setNewOrgId] = useState("");
  const [newEventId, setNewEventId] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);
  const [resetMfaOpen, setResetMfaOpen] = useState(false);
  const [resetMfaBusy, setResetMfaBusy] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);
  const [deactivateConfirm, setDeactivateConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setEmail(user.email);
    setIsActive(user.is_active);
    setError(null);
    setNewRole("");
    setNewOrgId("");
    setNewEventId("");
    setResetMfaOpen(false);
    setResetPasswordOpen(false);
    setNewPassword("");
    setDeactivateConfirm(false);
    setDeleteConfirm(false);
    setDeleteError(null);
  }, [user]);

  useEffect(() => {
    if (open) return;
    setResetMfaOpen(false);
    setResetPasswordOpen(false);
    setNewPassword("");
    setDeactivateConfirm(false);
    setDeleteConfirm(false);
    setDeleteError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    Promise.all([
      fetchAdminEvents({ includeArchived: true, signal: controller.signal }),
      fetchAdminOrganizations(controller.signal),
    ])
      .then(([eventList, orgList]) => {
        if (controller.signal.aborted) return;
        setEvents(eventList);
        setOrganizations(orgList);
        setNewOrgId((current) => current || orgList[0]?.id || "");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEvents([]);
          setOrganizations([]);
        }
      });
    return () => controller.abort();
  }, [open]);

  const handleClose = () => {
    if (submitting || resetMfaBusy || resetPasswordBusy || roleBusy || deleteBusy) return;
    setResetMfaOpen(false);
    setResetPasswordOpen(false);
    setNewPassword("");
    setDeactivateConfirm(false);
    setDeleteConfirm(false);
    setDeleteError(null);
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  const handleSave = async () => {
    if (!user || submitting) return;
    if (!isActive && user.is_active) {
      setDeactivateConfirm(true);
      return;
    }
    await saveProfile(isActive);
  };

  const saveProfile = async (active: boolean) => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      const { user: updated } = await patchAdminUser(user.id, {
        display_name: displayName.trim() || null,
        email: email.trim(),
        is_active: active,
      });
      onUpdated(updated, "Profile updated");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && (hasApiErrorCode(err, "email_taken") || hasApiErrorCode(err, "email_conflict"))) {
        setError("A user with this email already exists.");
      } else {
        setError(operatorApiErrorMessage(err, "Failed to save changes."));
      }
    } finally {
      setSubmitting(false);
      setDeactivateConfirm(false);
    }
  };

  const handleDelete = async () => {
    if (!user || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAdminUser(user.id);
      setDeleteConfirm(false);
      onDeleted(user);
      onClose();
    } catch (err) {
      setDeleteError(operatorApiErrorMessage(err, "Failed to delete user."));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleAddRole = async () => {
    if (!user || !newRole || roleBusy) return;
    setRoleBusy(true);
    setError(null);
    try {
      if (newRole === "superadmin") {
        await grantUserRole(user.id, { role: "superadmin", scope_type: "instance" });
      } else if (newRole === "admin") {
        if (!newOrgId) {
          setError("Select an organization for the admin role.");
          return;
        }
        await grantUserRole(user.id, { role: "admin", scope_type: "organization", scope_id: newOrgId });
      } else if (newRole === "operator") {
        if (!newEventId) {
          setError("Select an event for the operator role.");
          return;
        }
        await grantUserRole(user.id, { role: "operator", scope_type: "event", scope_id: newEventId });
      }
      onUpdated(user, "Role assigned");
      setNewRole("");
      setNewEventId("");
      onClose();
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Failed to assign role."));
    } finally {
      setRoleBusy(false);
    }
  };

  const handleRemoveRole = async (assignmentId: string) => {
    if (!user || roleBusy) return;
    setRoleBusy(true);
    setError(null);
    try {
      await revokeUserRole(user.id, assignmentId);
      onClose();
      onUpdated(user, "Role removed");
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Failed to remove role."));
    } finally {
      setRoleBusy(false);
    }
  };

  const handleResetMfa = async () => {
    if (!user) return;
    setResetMfaBusy(true);
    try {
      await resetUserMfa(user.id);
      setResetMfaOpen(false);
      onUpdated(user, "2FA reset. User must sign in again.");
      onClose();
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Failed to reset 2FA."));
    } finally {
      setResetMfaBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user || newPassword.length < PASSWORD_MIN_LENGTH) return;
    setResetPasswordBusy(true);
    setError(null);
    try {
      await resetUserPassword(user.id, { new_password: newPassword });
      setResetPasswordOpen(false);
      setNewPassword("");
      onUpdated(user, "Password reset. Sessions revoked.");
      onClose();
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Failed to reset password."));
    } finally {
      setResetPasswordBusy(false);
    }
  };

  if (!open || !user) return null;

  const displayTitle = user.display_name?.trim() || user.email;
  const isSelf = user.id === currentUser.id;

  const adminOrAddRoleControl =
    newRole === "admin" ? (
      <select
        id="edit-user-org-scope"
        name="edit-user-org-scope"
        className="users-modal__select"
        aria-label="Organization scope for admin role"
        value={newOrgId}
        disabled={roleBusy || organizations.length === 0}
        onChange={(e) => setNewOrgId(e.target.value)}
      >
        {organizations.length === 0 ? (
          <option value="">No organizations available</option>
        ) : (
          organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))
        )}
      </select>
    ) : (
      <Button type="button" variant="secondary" disabled={!newRole || roleBusy} onClick={() => void handleAddRole()}>
        Add
      </Button>
    );
  const roleScopeControl =
    newRole === "operator" ? (
      <select
        id="edit-user-event-scope"
        name="edit-user-event-scope"
        className="users-modal__select"
        aria-label="Event scope for operator role"
        value={newEventId}
        disabled={roleBusy}
        onChange={(e) => setNewEventId(e.target.value)}
      >
        <option value="">Select event…</option>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title}
          </option>
        ))}
      </select>
    ) : (
      adminOrAddRoleControl
    );

  return (
    <>
      <dialog open className="users-modal" aria-modal="true" aria-labelledby={titleId}>
        <ModalBackdrop onClose={handleClose} />
        <div ref={panelRef} className="users-modal__panel">
          <h2 className="users-modal__title" id={titleId}>
            Edit {displayTitle}
          </h2>
          {error && (
            <Notice variant="error" role="alert">{error}</Notice>
          )}
          <div className="users-modal__field">
            <label htmlFor="edit-display-name">Display name</label>
            <input
              id="edit-display-name"
              className="users-modal__input"
              type="text"
              value={displayName}
              disabled={submitting}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="users-modal__field">
            <label htmlFor="edit-email">Email address</label>
            <input
              id="edit-email"
              className="users-modal__input"
              type="email"
              value={email}
              required
              disabled={submitting}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="users-modal__switch-row">
            <Switch
              label="Active account"
              checked={isActive}
              disabled={submitting}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          </div>

          <p className="users-modal__section-title">Roles</p>
          <div className="users-modal__roles">
            {user.roles.length === 0 && <p className="form-hint">No role assignments.</p>}
            {user.roles.map((role) => (
              <div key={role.id} className="users-modal__role-row">
                <div>
                  <Badge variant={roleBadgeVariant(role.role)}>{roleLabel(role.role)}</Badge>{" "}
                  <span className="form-hint">
                    {role.scope_type}
                    {role.scope_id ? ` · ${role.scope_id.slice(0, 8)}…` : ""}
                    {role.is_oidc ? " · IdP" : ""}
                  </span>
                </div>
                {!role.is_oidc && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={roleBusy}
                    onClick={() => void handleRemoveRole(role.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="users-modal__role-assign">
            <select
              id="edit-user-assign-role"
              name="edit-user-assign-role"
              className="users-modal__select"
              aria-label="Role to assign"
              value={newRole}
              disabled={roleBusy}
              onChange={(e) => setNewRole(e.target.value as AssignRole)}
            >
              <option value="">Assign role…</option>
              <option value="superadmin">{roleLabel("superadmin")}</option>
              <option value="admin">{roleLabel("admin")}</option>
              <option value="operator">{roleLabel("operator")}</option>
            </select>
            {roleScopeControl}
          </div>
          {newRole === "operator" && (
            <Button type="button" variant="secondary" disabled={!newEventId || roleBusy} onClick={() => void handleAddRole()}>
              Add operator role
            </Button>
          )}
          {newRole === "admin" && (
            <Button type="button" variant="secondary" disabled={!newOrgId || roleBusy} onClick={() => void handleAddRole()}>
              Add admin role
            </Button>
          )}

          <p className="users-modal__section-title">Security</p>
          {!resetPasswordOpen ? (
            <div className="users-modal__actions" style={{ justifyContent: "flex-start" }}>
              <Button type="button" variant="secondary" onClick={() => setResetMfaOpen(true)}>
                Reset 2FA
              </Button>
              <Button type="button" variant="secondary" onClick={() => setResetPasswordOpen(true)}>
                Reset password
              </Button>
            </div>
          ) : (
            <section className="users-modal__subsection" aria-labelledby={resetPasswordTitleId}>
              <h3 className="users-modal__section-title" id={resetPasswordTitleId}>
                Reset password
              </h3>
              <div className="users-modal__field">
                <label htmlFor="reset-password">New temporary password</label>
                <input
                  id="reset-password"
                  className="users-modal__input"
                  type="password"
                  minLength={PASSWORD_MIN_LENGTH}
                  value={newPassword}
                  disabled={resetPasswordBusy}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <span className="form-hint">At least {PASSWORD_MIN_LENGTH} characters.</span>
              </div>
              <p className="form-hint">User sessions will be revoked. They must log in with the new password.</p>
              <div className="users-modal__actions" style={{ justifyContent: "flex-start" }}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={resetPasswordBusy}
                  onClick={() => {
                    setResetPasswordOpen(false);
                    setNewPassword("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={resetPasswordBusy || newPassword.length < PASSWORD_MIN_LENGTH}
                  onClick={() => void handleResetPassword()}
                >
                  {resetPasswordBusy ? "Resetting…" : "Reset password"}
                </Button>
              </div>
            </section>
          )}

          <p className="users-modal__section-title">Danger zone</p>
          <div className="users-modal__actions" style={{ justifyContent: "flex-start" }}>
            <Button
              type="button"
              variant="danger"
              disabled={submitting || isSelf}
              title={isSelf ? "You cannot delete your own account." : undefined}
              onClick={() => setDeleteConfirm(true)}
            >
              Delete account
            </Button>
          </div>

          <div className="users-modal__actions">
            <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={submitting || !email.trim()} onClick={() => void handleSave()}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </dialog>

      <ConfirmDialog
        open={deleteConfirm}
        title="Delete account"
        message={`Permanently delete ${displayTitle}? This removes their account, sessions, roles, and 2FA. This cannot be undone.`}
        errorMessage={deleteError}
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleteBusy}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteConfirm(false);
            setDeleteError(null);
          }
        }}
      />

      <ConfirmDialog
        open={deactivateConfirm}
        title="Deactivate account"
        message="Deactivating this account will revoke all active sessions."
        confirmLabel="Deactivate"
        confirmVariant="danger"
        loading={submitting}
        onConfirm={() => void saveProfile(false)}
        onCancel={() => {
          if (!submitting) {
            setDeactivateConfirm(false);
            setIsActive(true);
          }
        }}
      />

      <ConfirmDialog
        open={resetMfaOpen}
        title="Reset 2FA"
        message="This will remove all 2FA methods and revoke all sessions for this user."
        confirmLabel="Reset"
        confirmVariant="danger"
        loading={resetMfaBusy}
        onConfirm={() => void handleResetMfa()}
        onCancel={() => {
          if (!resetMfaBusy) setResetMfaOpen(false);
        }}
      />

    </>
  );
}
