import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Avatar, Button, IconButton, Input, ModalBackdrop, Notice, Select } from "@admitto/ui";
import { PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import {
  ApiError,
  deleteAdminUser,
  fetchAdminEvents,
  fetchAdminOrganizations,
  fetchSecurityAuditLog,
  grantUserRole,
  patchAdminUser,
  resetUserMfa,
  resetUserPassword,
  revokeUserRole,
  revokeUserSessions,
  unlinkUserExternalIdentity,
} from "../../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../../api/operator-api-error.js";
import type {
  EventDto,
  GrantUserRoleBody,
  RoleAssignmentDto,
  SecurityAuditLogEntryDto,
  UserListItemDto,
} from "../../api/types.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { GeoCell } from "../../components/GeoCell.js";
import { MoreActionsMenuItem } from "../../components/MoreActionsMenuItem.js";
import { useDropdownMenu } from "../../components/useDropdownMenu.js";
import { useModalFocusTrap } from "../../components/useModalFocusTrap.js";
import { roleLabel } from "../../auth/role-labels.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { formatRelativeTime } from "../../utils/event-dates.js";
import { isValidEmailFormat } from "../../utils/email.js";
import { COUNTRY_CALLING_CODES } from "../../utils/countryCallingCodes.js";
import { NO_AUTOFILL_PROPS } from "../../settings/mailTransportFormParts.js";
import "../../attendees/add-attendee-modal.css";

type UserEditModalProps = {
  open: boolean;
  user: UserListItemDto | null;
  onClose: () => void;
  onUpdated: (user: UserListItemDto, message?: string) => void;
  onDeleted: (user: UserListItemDto) => void;
};

type AssignRole = "" | "superadmin" | "admin" | "operator";

/** Whether the currently-picked role type has everything it needs to be granted: an event for
 * operator, an organization for admin, nothing extra for superadmin - and never true for "no
 * role picked yet". */
function isRoleScopeReady(role: AssignRole, eventId: string, orgId: string): boolean {
  if (role === "operator") return !!eventId;
  if (role === "admin") return !!orgId;
  return role === "superadmin";
}

function mapSaveProfileError(err: unknown): string {
  if (err instanceof ApiError && (hasApiErrorCode(err, "email_taken") || hasApiErrorCode(err, "email_conflict"))) {
    return "A user with this email already exists.";
  }
  return operatorApiErrorMessage(err, "Failed to save changes.");
}

/** Resolves what the Add/Change button should actually send - an org for admin, an event for
 * operator, nothing extra for superadmin - or an error message when the required scope isn't
 * picked yet. Kept pure (no state writes) so handleAddRole's own try/catch stays simple. */
function resolveRoleGrantRequest(
  role: Exclude<AssignRole, "">,
  orgId: string,
  eventId: string,
): { body: GrantUserRoleBody } | { error: string } {
  if (role === "admin") {
    // The Add/Change button is already disabled whenever isRoleScopeReady's own identical
    // !orgId check fails, so this can't fire from a real click - kept as defense-in-depth
    // for handleAddRole's only other caller (none today, but this stays a pure function).
    /* v8 ignore if */
    if (!orgId) return { error: "Select an organization for the admin role." };
    return { body: { role: "admin", scope_type: "organization", scope_id: orgId } };
  }
  if (role === "operator") {
    /* v8 ignore if */
    if (!eventId) return { error: "Select an event for the operator role." };
    return { body: { role: "operator", scope_type: "event", scope_id: eventId } };
  }
  return { body: { role: "superadmin", scope_type: "instance" } };
}

function mapAddRoleError(err: unknown): string {
  if (err instanceof ApiError && hasApiErrorCode(err, "cannot_change_own_role")) {
    return "You cannot change your own role. Ask another superadmin.";
  }
  return operatorApiErrorMessage(err, "Failed to assign role.");
}

function mapResetPasswordError(err: unknown): string {
  if (err instanceof ApiError && hasApiErrorCode(err, "invalid_request")) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return operatorApiErrorMessage(err, "Failed to reset password.");
}

function mapUnlinkSsoError(err: unknown): string {
  if (err instanceof ApiError && hasApiErrorCode(err, "invalid_request")) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return operatorApiErrorMessage(err, "Failed to unlink SSO.");
}

function activeSessionsLabel(count: number): string {
  if (count === 0) return "None";
  return `${count} session${count === 1 ? "" : "s"}`;
}

/** Whose access the role-type-change warning is about to remove. isSelf can never be true in
 * practice: the Role select itself is disabled whenever isSelf is true, so a self-viewing
 * admin can never actually trigger isRoleTypeChange in the first place. */
function roleChangeOwnerLabel(isSelf: boolean, displayTitle: string): string {
  /* v8 ignore if */
  if (isSelf) return "your";
  return `${displayTitle}'s`;
}

/** The Add/Change button shared by the "granting superadmin" and "granting admin/operator with a
 * scope picker" layouts below - factored out so those two layouts don't repeat every prop. */
function RoleActionButton({
  icon,
  disabled,
  title,
  onClick,
  label,
}: Readonly<{ icon: string; disabled: boolean; title?: string; onClick: () => void; label: string }>) {
  return (
    <Button
      type="button"
      variant="secondary"
      icon={<i className={`ti ti-${icon}`} aria-hidden="true" />}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

/** The header's "More actions" kebab menu (Reset MFA / Reset password / Revoke sessions /
 * Disable-Enable / Delete account) - each item just closes the menu and opens its own confirm
 * dialog or inline form; the parent owns all of that state. */
function UserMoreActionsMenu({
  moreActions,
  disabled,
  user,
  isSelf,
  onResetMfa,
  onResetPassword,
  onRevokeSessions,
  onToggleActive,
  onDelete,
}: Readonly<{
  moreActions: ReturnType<typeof useDropdownMenu<HTMLButtonElement>>;
  disabled: boolean;
  user: UserListItemDto;
  isSelf: boolean;
  onResetMfa: () => void;
  onResetPassword: () => void;
  onRevokeSessions: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}>) {
  const pick = (action: () => void) => () => {
    moreActions.setOpen(false);
    action();
  };
  return (
    <div className="more-actions-menu" ref={moreActions.rootRef}>
      <Button
        ref={moreActions.triggerRef}
        type="button"
        variant="ghost"
        className="users-modal__more-btn"
        aria-label="More actions"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={moreActions.open}
        onClick={() => moreActions.setOpen((o) => !o)}
        icon={<i className="ti ti-dots-vertical" aria-hidden="true" />}
      />
      {moreActions.open && (
        <div className="more-actions-menu__panel" role="menu" ref={moreActions.panelRef}>
          <MoreActionsMenuItem
            icon="refresh"
            label="Reset MFA"
            hint="Clear two-factor authentication"
            onClick={pick(onResetMfa)}
          />
          <MoreActionsMenuItem
            icon="key"
            label="Reset password"
            hint="Set a new temporary password"
            onClick={pick(onResetPassword)}
          />
          <MoreActionsMenuItem
            icon="logout"
            label="Revoke sessions"
            hint="Sign out of every active session"
            disabled={user.active_sessions_count === 0}
            onClick={pick(onRevokeSessions)}
          />
          <MoreActionsMenuItem
            icon={user.is_active ? "ban" : "circle-check"}
            variant={user.is_active ? "danger" : undefined}
            label={user.is_active ? "Disable account" : "Enable account"}
            hint={user.is_active ? "Block sign-in for this account" : "Allow sign-in again"}
            disabled={user.is_active && isSelf}
            tooltip={user.is_active && isSelf ? "You cannot disable your own account." : undefined}
            onClick={pick(onToggleActive)}
          />
          <hr className="more-actions-menu__divider" />
          <MoreActionsMenuItem
            icon="trash"
            variant="danger"
            label="Delete account"
            hint="Permanently remove this account"
            disabled={isSelf}
            tooltip={isSelf ? "You cannot delete your own account." : undefined}
            onClick={pick(onDelete)}
          />
        </div>
      )}
    </div>
  );
}

/** The modal's "Role & access" section - current role select, the chip list of scopes already
 * granted (of the current role type), a warning when switching type, and the Add/Change area
 * (built by the parent as `roleAssignArea`, since it needs the event/organization picker state). */
function RoleAccessSection({
  user,
  newRole,
  setNewRole,
  roleBusy,
  isSelf,
  currentRoleType,
  isRoleTypeChange,
  displayTitle,
  scopeChipLabel,
  onRemoveRole,
  roleAssignArea,
}: Readonly<{
  user: UserListItemDto;
  newRole: AssignRole;
  setNewRole: (role: AssignRole) => void;
  roleBusy: boolean;
  isSelf: boolean;
  currentRoleType: AssignRole;
  isRoleTypeChange: boolean;
  displayTitle: string;
  scopeChipLabel: (assignment: RoleAssignmentDto) => string;
  onRemoveRole: (assignmentId: string) => void;
  roleAssignArea: ReactNode;
}>) {
  return (
    <section className="users-modal__section">
      <h3 className="users-modal__section-title">Role & access</h3>
      <div className="users-modal__field">
        <label htmlFor="edit-user-assign-role" className="users-modal__field-label">
          Role
        </label>
        <Select
          id="edit-user-assign-role"
          value={newRole}
          disabled={roleBusy || isSelf}
          title={isSelf ? "You cannot change your own role." : undefined}
          onChange={(e) => setNewRole(e.target.value as AssignRole)}
        >
          {currentRoleType === "" && <option value="">No role assigned</option>}
          <option value="superadmin">{roleLabel("superadmin")}</option>
          <option value="admin">{roleLabel("admin")}</option>
          <option value="operator">{roleLabel("operator")}</option>
        </Select>
      </div>

      {!isRoleTypeChange && currentRoleType !== "superadmin" && user.roles.length > 0 && (
        <div className="users-modal__chips">
          {user.roles.map((assignment) => (
            <span key={assignment.id} className="users-modal__chip">
              <i
                className={`ti ti-${assignment.scope_type === "event" ? "calendar-event" : "building"}`}
                aria-hidden="true"
              />
              {assignment.is_oidc && (
                <i className="ti ti-cloud" aria-hidden="true" title="Managed by identity provider" />
              )}
              {scopeChipLabel(assignment)}
              {!assignment.is_oidc && (
                <button
                  type="button"
                  className="users-modal__chip-remove"
                  disabled={roleBusy || isSelf}
                  title={isSelf ? "You cannot remove your own role assignment." : undefined}
                  onClick={() => onRemoveRole(assignment.id)}
                  aria-label={`Remove ${roleLabel(currentRoleType)} for ${scopeChipLabel(assignment)}`}
                >
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {isRoleTypeChange && (
        <Notice variant="warning">
          Changing to {roleLabel(newRole)} removes {roleChangeOwnerLabel(isSelf, displayTitle)} current{" "}
          {roleLabel(currentRoleType)} access.
        </Notice>
      )}

      {roleAssignArea}
    </section>
  );
}

/** The modal's "Sign-in security" section - sign-in method/MFA/active-sessions status chips, then
 * either the Recent logins list or (swapped in when resetPasswordOpen) the Reset password form. */
function SignInSecuritySection({
  user,
  isSelf,
  unlinkSsoBusy,
  onUnlinkClick,
  resetPasswordOpen,
  recentLoginsLoaded,
  recentLogins,
  resetPasswordTitleId,
  newPassword,
  setNewPassword,
  resetPasswordBusy,
  onCancelResetPassword,
  onResetPassword,
}: Readonly<{
  user: UserListItemDto;
  isSelf: boolean;
  unlinkSsoBusy: boolean;
  onUnlinkClick: () => void;
  resetPasswordOpen: boolean;
  recentLoginsLoaded: boolean;
  recentLogins: SecurityAuditLogEntryDto[];
  resetPasswordTitleId: string;
  newPassword: string;
  setNewPassword: (value: string) => void;
  resetPasswordBusy: boolean;
  onCancelResetPassword: () => void;
  onResetPassword: () => void;
}>) {
  return (
    <section className="users-modal__section">
      <h3 className="users-modal__section-title">Sign-in security</h3>
      <div className="users-modal__status-grid">
        <div className="users-modal__status-chip">
          <span className="users-modal__status-chip-icon users-modal__status-chip-icon--neutral">
            <i className={`ti ti-${user.has_sso ? "cloud-lock" : "key"}`} aria-hidden="true" />
          </span>
          <span className="users-modal__status-chip-body">
            <strong>Sign-in method</strong>
            <span>{user.has_sso ? "SSO" : "Local password"}</span>
          </span>
          {user.has_sso && (
            <button
              type="button"
              className="users-modal__unlink-btn"
              disabled={unlinkSsoBusy || isSelf}
              title={isSelf ? "You cannot unlink SSO from your own account." : "Unlink SSO"}
              onClick={onUnlinkClick}
            >
              Unlink
            </button>
          )}
        </div>
        <div className="users-modal__status-chip">
          <span
            className={`users-modal__status-chip-icon users-modal__status-chip-icon--${user.has_mfa ? "ok" : "warn"}`}
          >
            <i className={`ti ti-shield-${user.has_mfa ? "check" : "off"}`} aria-hidden="true" />
          </span>
          <span className="users-modal__status-chip-body">
            <strong>MFA</strong>
            <span>{user.has_mfa ? "TOTP enrolled" : "Not enrolled"}</span>
          </span>
        </div>
        <div className="users-modal__status-chip">
          <span
            className={`users-modal__status-chip-icon users-modal__status-chip-icon--${user.active_sessions_count > 0 ? "ok" : "neutral"}`}
          >
            <i
              className={`ti ti-plug-connected${user.active_sessions_count > 0 ? "" : "-x"}`}
              aria-hidden="true"
            />
          </span>
          <span className="users-modal__status-chip-body">
            <strong>Active sessions</strong>
            <span>{activeSessionsLabel(user.active_sessions_count)}</span>
          </span>
        </div>
      </div>

      {resetPasswordOpen ? (
        <section className="users-modal__subsection" aria-labelledby={resetPasswordTitleId}>
          <h3 className="users-modal__subsection-title" id={resetPasswordTitleId}>
            Reset password
          </h3>
          <Input
            id="reset-password"
            label="New temporary password"
            icon={<i className="ti ti-key" aria-hidden="true" />}
            type="password"
            minLength={PASSWORD_MIN_LENGTH}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            value={newPassword}
            disabled={resetPasswordBusy}
            onChange={(e) => setNewPassword(e.target.value)}
            {...NO_AUTOFILL_PROPS}
          />
          <p className="form-hint">User sessions will be revoked. They must log in with the new password.</p>
          <div className="users-modal__actions" style={{ justifyContent: "flex-start" }}>
            <Button type="button" variant="secondary" disabled={resetPasswordBusy} onClick={onCancelResetPassword}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={resetPasswordBusy || newPassword.length < PASSWORD_MIN_LENGTH}
              onClick={onResetPassword}
            >
              {resetPasswordBusy ? "Resetting…" : "Reset password"}
            </Button>
          </div>
        </section>
      ) : (
        recentLoginsLoaded && (
          <div className="users-modal__logins">
            <p className="users-modal__subsection-title" style={{ margin: "0 0 var(--space-1)" }}>
              Recent logins
            </p>
            {recentLogins.length === 0 && (
              <p className="users-modal__empty-line">
                <i className="ti ti-history" aria-hidden="true" /> No recent logins
              </p>
            )}
            {recentLogins.map((entry) => (
              <div key={entry.id} className="users-modal__login-row">
                <span className="users-modal__login-icon users-modal__login-icon--ok">
                  <i className="ti ti-circle-check" aria-hidden="true" />
                </span>
                <span className="users-modal__login-main">
                  <span className="users-modal__login-status">Signed in</span>
                  <span className="users-modal__login-geo">
                    <GeoCell location={entry.country} />
                    {entry.ip && <span className="users-modal__login-ip">{entry.ip}</span>}
                  </span>
                </span>
                <span className="users-modal__login-time">{formatRelativeTime(entry.created_at)}</span>
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}

export function UserEditModal({ open, user, onClose, onUpdated, onDeleted }: Readonly<UserEditModalProps>) {
  const { user: currentUser } = useAuth();
  const titleId = useId();
  const resetPasswordTitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [recentLogins, setRecentLogins] = useState<SecurityAuditLogEntryDto[]>([]);
  const [recentLoginsLoaded, setRecentLoginsLoaded] = useState(false);
  const [newRole, setNewRole] = useState<AssignRole>("");
  const [newOrgId, setNewOrgId] = useState("");
  const [newEventId, setNewEventId] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleChangeConfirmOpen, setRoleChangeConfirmOpen] = useState(false);
  const [resetMfaOpen, setResetMfaOpen] = useState(false);
  const [resetMfaBusy, setResetMfaBusy] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);
  const [revokeSessionsOpen, setRevokeSessionsOpen] = useState(false);
  const [revokeSessionsBusy, setRevokeSessionsBusy] = useState(false);
  const [unlinkSsoOpen, setUnlinkSsoOpen] = useState(false);
  const [unlinkSsoBusy, setUnlinkSsoBusy] = useState(false);
  const [unlinkSsoPassword, setUnlinkSsoPassword] = useState("");
  const [unlinkSsoError, setUnlinkSsoError] = useState<string | null>(null);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [toggleActiveBusy, setToggleActiveBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setEmail(user.email);
    setPhoneCountryCode(user.phone_country_code ?? "");
    setPhoneNumber(user.phone_number ?? "");
    setError(null);
    setNewRole((user.roles[0]?.role as AssignRole) ?? "");
    setNewOrgId("");
    setNewEventId("");
    setRoleChangeConfirmOpen(false);
    setResetMfaOpen(false);
    setResetPasswordOpen(false);
    setNewPassword("");
    setRevokeSessionsOpen(false);
    setUnlinkSsoOpen(false);
    setUnlinkSsoPassword("");
    setUnlinkSsoError(null);
    setDisableConfirmOpen(false);
    setDeleteConfirm(false);
    setDeleteError(null);
  }, [user]);

  useEffect(() => {
    if (open) return;
    setRoleChangeConfirmOpen(false);
    setResetMfaOpen(false);
    setResetPasswordOpen(false);
    setNewPassword("");
    setRevokeSessionsOpen(false);
    setUnlinkSsoOpen(false);
    setUnlinkSsoPassword("");
    setUnlinkSsoError(null);
    setDisableConfirmOpen(false);
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
        // Default to the first org this user isn't already assigned to - the picker only ever
        // renders pickableOrganizations (same filter below, in the render body), so seeding
        // newOrgId from the raw, unfiltered orgList could default it to a value with no matching
        // <option>.
        const assignedOrgIds = new Set(
          (user?.roles ?? []).filter((r) => r.scope_type === "organization").map((r) => r.scope_id),
        );
        setNewOrgId((current) => current || orgList.find((org) => !assignedOrgIds.has(org.id))?.id || "");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEvents([]);
          setOrganizations([]);
        }
      });
    return () => controller.abort();
  }, [open, user]);

  useEffect(() => {
    if (!open || !user) return;
    setRecentLoginsLoaded(false);
    const controller = new AbortController();
    fetchSecurityAuditLog(
      { eventType: "auth.login.success", userId: user.id, pageSize: 3 },
      controller.signal,
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        setRecentLogins(res.entries);
        setRecentLoginsLoaded(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setRecentLogins([]);
        setRecentLoginsLoaded(true);
      });
    return () => controller.abort();
  }, [open, user]);

  const headActionsDisabled =
    submitting ||
    resetMfaBusy ||
    resetPasswordBusy ||
    roleBusy ||
    deleteBusy ||
    revokeSessionsBusy ||
    toggleActiveBusy ||
    unlinkSsoBusy;

  const handleClose = () => {
    if (headActionsDisabled) return;
    setRoleChangeConfirmOpen(false);
    setResetMfaOpen(false);
    setResetPasswordOpen(false);
    setNewPassword("");
    setRevokeSessionsOpen(false);
    setUnlinkSsoOpen(false);
    setUnlinkSsoPassword("");
    setUnlinkSsoError(null);
    setDisableConfirmOpen(false);
    setDeleteConfirm(false);
    setDeleteError(null);
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);
  const moreActions = useDropdownMenu<HTMLButtonElement>();

  const saveProfile = async () => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      const { user: updated } = await patchAdminUser(user.id, {
        display_name: displayName.trim() || null,
        email: email.trim(),
        phone_country_code: phoneCountryCode || null,
        phone_number: phoneNumber.trim() || null,
      });
      onUpdated(updated, "Profile updated");
      onClose();
    } catch (err) {
      setError(mapSaveProfileError(err));
    } finally {
      setSubmitting(false);
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
    // Type-narrowing/defense-in-depth only: the Add/Change button is disabled whenever
    // !newRole, !scopeReady (which resolveRoleGrantRequest's own error case duplicates), or
    // roleBusy - none of these can fire from a real click. !user can't happen either: this
    // closure only exists once the render-body's `if (!open || !user) return null` guard
    // above has already passed for the current render.
    /* v8 ignore if */
    if (!user || !newRole || roleBusy) return;
    const request = resolveRoleGrantRequest(newRole, newOrgId, newEventId);
    /* v8 ignore if */
    if ("error" in request) {
      setError(request.error);
      return;
    }
    setRoleBusy(true);
    setError(null);
    try {
      await grantUserRole(user.id, request.body);
      onUpdated(user, "Role updated");
      setRoleChangeConfirmOpen(false);
      setNewEventId("");
      setNewOrgId("");
      // A same-type scope addition (e.g. a second event grant) keeps the modal open, same as
      // removing a scope chip does, so several can be added in one sitting - the still-open
      // modal picks up the fresh assignment through Staff users' own list refresh. A type change
      // is different: it replaces the whole role identity, and if Staff users is currently
      // filtered by the target's old role, the refreshed (filtered) list can drop the target
      // entirely, leaving nothing for the parent's user-sync effect to find - so the modal would
      // otherwise sit open showing the just-replaced role and scopes as if nothing happened.
      if (isRoleTypeChange) {
        onClose();
      }
    } catch (err) {
      setError(mapAddRoleError(err));
    } finally {
      setRoleBusy(false);
    }
  };

  const handleRemoveRole = async (assignmentId: string) => {
    // !user: see handleAddRole's own comment above - every action handler in this component
    // closes over the same guarantee. roleBusy: the chip's own remove button is disabled
    // while busy.
    /* v8 ignore if */
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
    // See handleAddRole's own comment above.
    /* v8 ignore if */
    if (!user) return;
    setResetMfaBusy(true);
    try {
      await resetUserMfa(user.id);
      setResetMfaOpen(false);
      onUpdated(user, "MFA reset. User must sign in again.");
      onClose();
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Failed to reset MFA."));
    } finally {
      setResetMfaBusy(false);
    }
  };

  const handleResetPassword = async () => {
    // !user: see handleAddRole's own comment above. newPassword.length: the Reset password
    // button's own disabled prop checks the same PASSWORD_MIN_LENGTH condition.
    /* v8 ignore if */
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
      setError(mapResetPasswordError(err));
    } finally {
      setResetPasswordBusy(false);
    }
  };

  const handleRevokeSessions = async () => {
    // See handleAddRole's own comment above.
    /* v8 ignore if */
    if (!user) return;
    setRevokeSessionsBusy(true);
    try {
      const { sessionsRevoked } = await revokeUserSessions(user.id);
      setRevokeSessionsOpen(false);
      onUpdated(user, `${sessionsRevoked} session${sessionsRevoked === 1 ? "" : "s"} revoked`);
      onClose();
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Failed to revoke sessions."));
    } finally {
      setRevokeSessionsBusy(false);
    }
  };

  const handleUnlinkSso = async () => {
    // !user: see handleAddRole's own comment above. unlinkSsoPassword.length: the confirm
    // dialog's own disableConfirm prop checks the same PASSWORD_MIN_LENGTH condition.
    /* v8 ignore if */
    if (!user || unlinkSsoPassword.length < PASSWORD_MIN_LENGTH) return;
    setUnlinkSsoBusy(true);
    setUnlinkSsoError(null);
    try {
      await unlinkUserExternalIdentity(user.id, { new_password: unlinkSsoPassword });
      setUnlinkSsoOpen(false);
      setUnlinkSsoPassword("");
      onUpdated(user, "SSO unlinked. User must sign in with the new local password.");
      onClose();
    } catch (err) {
      setUnlinkSsoError(mapUnlinkSsoError(err));
    } finally {
      setUnlinkSsoBusy(false);
    }
  };

  const applyActiveChange = async (nextActive: boolean) => {
    // See handleAddRole's own comment above.
    /* v8 ignore if */
    if (!user) return;
    setToggleActiveBusy(true);
    setError(null);
    try {
      const { user: updated } = await patchAdminUser(user.id, { is_active: nextActive });
      setDisableConfirmOpen(false);
      onUpdated(updated, nextActive ? "Account enabled" : "Account disabled. Sessions revoked.");
      onClose();
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Failed to update account status."));
    } finally {
      setToggleActiveBusy(false);
    }
  };

  const handleToggleActiveClick = () => {
    // See handleAddRole's own comment above.
    /* v8 ignore if */
    if (!user) return;
    if (user.is_active) {
      setDisableConfirmOpen(true);
    } else {
      void applyActiveChange(true);
    }
  };

  if (!open || !user) return null;

  const displayTitle = user.display_name?.trim() || user.email;
  const isSelf = user.id === currentUser.id;

  // Roles are exclusive by type (#401, resolved) - a person is a superadmin, or an admin over one
  // or more organizations, or an operator over one or more events, never a mix. user.roles can
  // therefore only ever hold assignments of one role type at a time; scopeChipLabel/groupRoles
  // below work over "the" current type, not several.
  const currentRoleType = (user.roles[0]?.role as AssignRole) ?? "";
  const isRoleTypeChange = newRole !== "" && currentRoleType !== "" && newRole !== currentRoleType;

  /** Resolves a role assignment's raw scope_id to the human label shown elsewhere in the admin
   * (event title / organization name) - this modal already fetches both lists for the "assign
   * role" controls below, so no extra request is needed. Falls back to the id when the scope
   * isn't in the fetched list (e.g. a since-deleted event). */
  function scopeChipLabel(assignment: RoleAssignmentDto): string {
    // A superadmin's own instance-wide assignment never reaches this function: the chip list
    // above is only rendered when currentRoleType !== "superadmin".
    /* v8 ignore if */
    if (assignment.scope_type === "instance") return "Instance-wide";
    // The final "Unknown ..." fallback in each branch below only fires for a null scope_id -
    // an event/organization-scoped assignment created with no scope at all, which the schema's
    // own constraints don't allow. The first fallback (the raw id) is the realistic case: a
    // scope_id that no longer matches anything in the fetched list (e.g. a deleted event) -
    // covered by its own test above.
    if (assignment.scope_type === "event") {
      return events.find((e) => e.id === assignment.scope_id)?.title ?? assignment.scope_id ?? "Unknown event";
    }
    if (assignment.scope_type === "organization") {
      return organizations.find((o) => o.id === assignment.scope_id)?.name ?? assignment.scope_id ?? "Unknown organization";
    }
    // scope_type is exhaustively instance/event/organization - this return only exists to
    // satisfy the function's own string return type, never actually reachable.
    /* v8 ignore next */
    return assignment.scope_id ?? assignment.scope_type;
  }

  // Scopes already granted (of the current role type) shouldn't also show up as pickable -
  // they're already a chip below, with their own remove control.
  const assignedEventIds = new Set(
    user.roles.filter((r) => r.scope_type === "event").map((r) => r.scope_id),
  );
  const assignedOrgIds = new Set(
    user.roles.filter((r) => r.scope_type === "organization").map((r) => r.scope_id),
  );
  const pickableEvents = events.filter((e) => !assignedEventIds.has(e.id));
  const pickableOrganizations = organizations.filter((org) => !assignedOrgIds.has(org.id));

  const scopePickerControl =
    newRole === "operator" ? (
      <Select
        id="edit-user-event-scope"
        aria-label="Event scope for operator role"
        value={newEventId}
        disabled={roleBusy}
        onChange={(e) => setNewEventId(e.target.value)}
      >
        <option value="">Select event…</option>
        {pickableEvents.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title}
          </option>
        ))}
      </Select>
    ) : (
      <Select
        id="edit-user-org-scope"
        aria-label="Organization scope for admin role"
        value={newOrgId}
        disabled={roleBusy || pickableOrganizations.length === 0}
        onChange={(e) => setNewOrgId(e.target.value)}
      >
        {pickableOrganizations.length === 0 ? (
          <option value="">No organizations available</option>
        ) : (
          pickableOrganizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))
        )}
      </Select>
    );

  const scopeReady = isRoleScopeReady(newRole, newEventId, newOrgId);
  const roleActionDisabled = roleBusy || !scopeReady || (isSelf && isRoleTypeChange);
  const roleActionLabel = isRoleTypeChange ? "Change" : "Add";
  const roleActionIcon = isRoleTypeChange ? "refresh" : "plus";
  const handleRoleActionClick = () => {
    if (isRoleTypeChange) {
      setRoleChangeConfirmOpen(true);
    } else {
      void handleAddRole();
    }
  };
  // isSelf && isRoleTypeChange can never both be true - see roleChangeOwnerLabel's own comment.
  /* v8 ignore next */
  const roleActionTitle = isSelf && isRoleTypeChange ? "You cannot change your own role." : undefined;
  const roleActionButton = (
    <RoleActionButton
      icon={roleActionIcon}
      disabled={roleActionDisabled}
      title={roleActionTitle}
      onClick={handleRoleActionClick}
      label={roleActionLabel}
    />
  );
  let roleAssignArea: ReactNode;
  if (newRole !== "superadmin") {
    roleAssignArea = (
      <div className="users-modal__role-assign">
        {scopePickerControl}
        {roleActionButton}
      </div>
    );
  } else if (currentRoleType === "superadmin") {
    roleAssignArea = (
      <Notice variant="info">
        Superadmin already covers every event and organization in this instance, so there are no scopes to add.
      </Notice>
    );
  } else {
    roleAssignArea = roleActionButton;
  }

  return (
    <>
      <dialog open className="add-attendee-modal" aria-modal="true" aria-labelledby={titleId}>
        {/* No onClose: a superadmin mid-edit shouldn't lose work to a stray click outside the
         * panel, matching the Identity providers modal's own backdrop (identity-modal.css). */}
        <ModalBackdrop />
        <div ref={panelRef} className="add-attendee-modal__panel add-attendee-modal__panel--wide">
          <div className="users-modal__head">
            <div className="users-modal__head-who">
              <Avatar name={displayTitle} size="sm" />
              <div className="users-modal__head-text">
                <h2 id={titleId}>{displayTitle}</h2>
                <span className="users-modal__head-email">{user.email}</span>
              </div>
            </div>
            <div className="users-modal__head-actions">
              <UserMoreActionsMenu
                moreActions={moreActions}
                disabled={headActionsDisabled || resetPasswordOpen}
                user={user}
                isSelf={isSelf}
                onResetMfa={() => setResetMfaOpen(true)}
                onResetPassword={() => setResetPasswordOpen(true)}
                onRevokeSessions={() => setRevokeSessionsOpen(true)}
                onToggleActive={handleToggleActiveClick}
                onDelete={() => setDeleteConfirm(true)}
              />
              <IconButton
                label="Close"
                disabled={headActionsDisabled}
                onClick={handleClose}
                icon={<i className="ti ti-x" aria-hidden="true" />}
              />
            </div>
          </div>
          {error && (
            <Notice variant="error" role="alert">{error}</Notice>
          )}

          <div className="add-attendee-modal__fields">
            <section className="users-modal__section">
              <h3 className="users-modal__section-title">Profile</h3>
              <div className="users-modal__profile-fields">
                <Input
                  id="edit-display-name"
                  label="Display name"
                  icon={<i className="ti ti-user" aria-hidden="true" />}
                  type="text"
                  value={displayName}
                  disabled={submitting}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <Input
                  id="edit-email"
                  label="Email address"
                  icon={<i className="ti ti-mail" aria-hidden="true" />}
                  type="text"
                  inputMode="email"
                  value={email}
                  required
                  disabled={submitting}
                  onChange={(e) => setEmail(e.target.value)}
                  {...NO_AUTOFILL_PROPS}
                />
                <div className="users-modal__field">
                  <label htmlFor="edit-phone-number" className="users-modal__field-label">
                    Phone number
                  </label>
                  <div className="users-modal__phone-row">
                    <Select
                      id="edit-phone-country-code"
                      aria-label="Phone country code"
                      value={phoneCountryCode}
                      disabled={submitting}
                      onChange={(e) => setPhoneCountryCode(e.target.value)}
                    >
                      <option value="">No code</option>
                      {COUNTRY_CALLING_CODES.map((c) => (
                        <option key={c.name} value={c.dialCode}>
                          {c.name} ({c.dialCode})
                        </option>
                      ))}
                    </Select>
                    <Input
                      id="edit-phone-number"
                      icon={<i className="ti ti-phone" aria-hidden="true" />}
                      type="tel"
                      value={phoneNumber}
                      disabled={submitting}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      {...NO_AUTOFILL_PROPS}
                    />
                  </div>
                  <p className="at-hint">For internal contact only - not shown on tickets.</p>
                </div>
              </div>
            </section>

            <RoleAccessSection
              user={user}
              newRole={newRole}
              setNewRole={setNewRole}
              roleBusy={roleBusy}
              isSelf={isSelf}
              currentRoleType={currentRoleType}
              isRoleTypeChange={isRoleTypeChange}
              displayTitle={displayTitle}
              scopeChipLabel={scopeChipLabel}
              onRemoveRole={(assignmentId) => void handleRemoveRole(assignmentId)}
              roleAssignArea={roleAssignArea}
            />

            <SignInSecuritySection
              user={user}
              isSelf={isSelf}
              unlinkSsoBusy={unlinkSsoBusy}
              onUnlinkClick={() => setUnlinkSsoOpen(true)}
              resetPasswordOpen={resetPasswordOpen}
              recentLoginsLoaded={recentLoginsLoaded}
              recentLogins={recentLogins}
              resetPasswordTitleId={resetPasswordTitleId}
              newPassword={newPassword}
              setNewPassword={setNewPassword}
              resetPasswordBusy={resetPasswordBusy}
              onCancelResetPassword={() => {
                setResetPasswordOpen(false);
                setNewPassword("");
              }}
              onResetPassword={() => void handleResetPassword()}
            />
          </div>

          <div className="add-attendee-modal__actions" style={{ justifyContent: "flex-end" }}>
            <div className="add-attendee-modal__actions-buttons">
              <Button
                type="button"
                variant="primary"
                disabled={headActionsDisabled || !isValidEmailFormat(email.trim())}
                onClick={() => void saveProfile()}
              >
                {submitting ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </dialog>

      <ConfirmDialog
        open={deleteConfirm}
        title="Delete account"
        message={`Permanently delete ${displayTitle}? This removes their account, sessions, roles, and MFA. This cannot be undone.`}
        errorMessage={deleteError}
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleteBusy}
        confirmationValue={user.email}
        confirmationLabel={`Type the email address to confirm: "${user.email}"`}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteConfirm(false);
            setDeleteError(null);
          }
        }}
      />

      <ConfirmDialog
        open={disableConfirmOpen}
        title="Disable account"
        message="Disabling this account will revoke all active sessions."
        confirmLabel="Disable"
        confirmVariant="danger"
        loading={toggleActiveBusy}
        onConfirm={() => void applyActiveChange(false)}
        onCancel={() => {
          if (!toggleActiveBusy) setDisableConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={resetMfaOpen}
        title="Reset MFA"
        message="This will remove all MFA methods and revoke all sessions for this user."
        confirmLabel="Reset"
        confirmVariant="danger"
        loading={resetMfaBusy}
        onConfirm={() => void handleResetMfa()}
        onCancel={() => {
          if (!resetMfaBusy) setResetMfaOpen(false);
        }}
      />

      <ConfirmDialog
        open={revokeSessionsOpen}
        title="Revoke all sessions"
        message={`End all active sessions for ${displayTitle}?`}
        confirmLabel="Revoke"
        confirmVariant="danger"
        loading={revokeSessionsBusy}
        onConfirm={() => void handleRevokeSessions()}
        onCancel={() => {
          if (!revokeSessionsBusy) setRevokeSessionsOpen(false);
        }}
      />

      <ConfirmDialog
        open={unlinkSsoOpen}
        title="Unlink SSO"
        message={`Unlink SSO for ${displayTitle}? Set the new local password they'll sign in with below - their SSO sign-in stops working immediately.`}
        errorMessage={unlinkSsoError}
        confirmLabel="Unlink"
        confirmVariant="danger"
        loading={unlinkSsoBusy}
        disableConfirm={unlinkSsoPassword.length < PASSWORD_MIN_LENGTH}
        onConfirm={() => void handleUnlinkSso()}
        onCancel={() => {
          if (unlinkSsoBusy) return;
          setUnlinkSsoOpen(false);
          setUnlinkSsoPassword("");
          setUnlinkSsoError(null);
        }}
      >
        <Input
          id="unlink-sso-password"
          label="New temporary password"
          icon={<i className="ti ti-key" aria-hidden="true" />}
          type="password"
          minLength={PASSWORD_MIN_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={unlinkSsoPassword}
          disabled={unlinkSsoBusy}
          onChange={(e) => setUnlinkSsoPassword(e.target.value)}
          {...NO_AUTOFILL_PROPS}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={roleChangeConfirmOpen}
        title="Change role"
        message={`Change ${displayTitle}'s role from ${roleLabel(currentRoleType)} to ${roleLabel(newRole)}? This removes their current access.`}
        confirmLabel="Change role"
        confirmVariant="danger"
        loading={roleBusy}
        onConfirm={() => void handleAddRole()}
        onCancel={() => {
          if (!roleBusy) setRoleChangeConfirmOpen(false);
        }}
      />
    </>
  );
}
