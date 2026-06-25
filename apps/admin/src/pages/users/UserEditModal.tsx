import { useEffect, useId, useRef, useState } from "react";
import { Badge, Button, Switch } from "@admitto/ui";
import {
  ApiError,
  fetchAdminEvents,
  grantUserRole,
  patchAdminUser,
  resetUserMfa,
  resetUserPassword,
  revokeUserRole,
} from "../../api/client.js";
import type { EventDto, UserListItemDto } from "../../api/types.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../../components/useModalFocusTrap.js";

type UserEditModalProps = {
  open: boolean;
  user: UserListItemDto | null;
  onClose: () => void;
  onUpdated: (user: UserListItemDto, message?: string) => void;
};

type AssignRole = "" | "superadmin" | "admin" | "operator";

function roleLabel(role: string): string {
  if (role === "superadmin") return "Superadmin";
  if (role === "admin") return "Admin";
  if (role === "operator") return "Operator";
  return role;
}

function mapApiError(message: string): string {
  if (message.includes("cannot_deactivate_self")) return "You cannot deactivate your own account.";
  if (message.includes("last_superadmin")) return "Cannot remove or deactivate the last superadmin.";
  if (message.includes("managed_by_idp")) {
    return "This role is managed by an identity provider and cannot be removed.";
  }
  if (message.includes("already_assigned")) return "This role assignment already exists.";
  return message;
}

export function UserEditModal({ open, user, onClose, onUpdated }: UserEditModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [newRole, setNewRole] = useState<AssignRole>("");
  const [newEventId, setNewEventId] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);
  const [resetMfaOpen, setResetMfaOpen] = useState(false);
  const [resetMfaBusy, setResetMfaBusy] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);
  const [deactivateConfirm, setDeactivateConfirm] = useState(false);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setIsActive(user.is_active);
    setError(null);
    setNewRole("");
    setNewEventId("");
  }, [user]);

  useEffect(() => {
    if (!open) return;
    fetchAdminEvents({ includeArchived: true })
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [open]);

  const handleClose = () => {
    if (submitting || resetMfaBusy || resetPasswordBusy || roleBusy) return;
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
        is_active: active,
      });
      onUpdated(updated, "Profile updated");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? mapApiError(err.message) : "Failed to save changes.");
    } finally {
      setSubmitting(false);
      setDeactivateConfirm(false);
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
        const orgId = events[0]?.organization_id;
        if (!orgId) throw new Error("No organization available.");
        await grantUserRole(user.id, { role: "admin", scope_type: "organization", scope_id: orgId });
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
      setError(err instanceof ApiError ? mapApiError(err.message) : "Failed to assign role.");
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
      setError(err instanceof ApiError ? mapApiError(err.message) : "Failed to remove role.");
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
      onUpdated(user, "2FA reset — user must sign in again");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reset 2FA.");
    } finally {
      setResetMfaBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user || newPassword.length < 8) return;
    setResetPasswordBusy(true);
    setError(null);
    try {
      await resetUserPassword(user.id, { new_password: newPassword });
      setResetPasswordOpen(false);
      setNewPassword("");
      onUpdated(user, "Password reset — sessions revoked");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reset password.");
    } finally {
      setResetPasswordBusy(false);
    }
  };

  if (!open || !user) return null;

  const displayTitle = user.display_name?.trim() || user.email;

  return (
    <>
      <div className="users-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="users-modal__backdrop" role="presentation" onClick={handleClose} />
        <div ref={panelRef} className="users-modal__panel">
          <h2 className="users-modal__title" id={titleId}>
            Edit {displayTitle}
          </h2>
          {error && (
            <p className="users-modal__error" role="alert">
              {error}
            </p>
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
                  <Badge variant="neutral">{roleLabel(role.role)}</Badge>{" "}
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
              className="users-modal__select"
              value={newRole}
              disabled={roleBusy}
              onChange={(e) => setNewRole(e.target.value as AssignRole)}
            >
              <option value="">Assign role…</option>
              <option value="superadmin">Superadmin</option>
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
            </select>
            {newRole === "operator" ? (
              <select
                className="users-modal__select"
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
              <Button type="button" variant="secondary" disabled={!newRole || roleBusy} onClick={() => void handleAddRole()}>
                Add
              </Button>
            )}
          </div>
          {newRole === "operator" && (
            <Button type="button" variant="secondary" disabled={!newEventId || roleBusy} onClick={() => void handleAddRole()}>
              Add operator role
            </Button>
          )}

          <p className="users-modal__section-title">Security</p>
          <div className="users-modal__actions" style={{ justifyContent: "flex-start" }}>
            <Button type="button" variant="secondary" onClick={() => setResetMfaOpen(true)}>
              Reset 2FA
            </Button>
            <Button type="button" variant="secondary" onClick={() => setResetPasswordOpen(true)}>
              Reset password
            </Button>
          </div>

          <div className="users-modal__actions">
            <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={submitting} onClick={() => void handleSave()}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

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
        confirmLabel="Reset 2FA"
        confirmVariant="danger"
        loading={resetMfaBusy}
        onConfirm={() => void handleResetMfa()}
        onCancel={() => {
          if (!resetMfaBusy) setResetMfaOpen(false);
        }}
      />

      {resetPasswordOpen && (
        <div className="users-modal" role="dialog" aria-modal="true">
          <div className="users-modal__backdrop" role="presentation" onClick={() => setResetPasswordOpen(false)} />
          <div className="users-modal__panel">
            <h3 className="users-modal__title">Reset password</h3>
            <div className="users-modal__field">
              <label htmlFor="reset-password">New temporary password</label>
              <input
                id="reset-password"
                className="users-modal__input"
                type="password"
                minLength={8}
                value={newPassword}
                disabled={resetPasswordBusy}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <p className="form-hint">User sessions will be revoked. They must log in with the new password.</p>
            <div className="users-modal__actions">
              <Button type="button" variant="secondary" disabled={resetPasswordBusy} onClick={() => setResetPasswordOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={resetPasswordBusy || newPassword.length < 8}
                onClick={() => void handleResetPassword()}
              >
                {resetPasswordBusy ? "Resetting…" : "Reset password"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
