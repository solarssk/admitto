import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Avatar, Button, IconButton, Input, ModalBackdrop, Notice, Skeleton } from "@admitto/ui";
import { PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import {
  ApiError,
  deleteAdminUser,
  grantUserRole,
  patchAdminUser,
  resetUserMfa,
  resetUserPassword,
  revokeUserRole,
  revokeUserSessions,
  unlinkUserExternalIdentity,
} from "../../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../../api/operator-api-error.js";
import type { RoleAssignmentDto, SecurityAuditLogEntryDto, StepUpProofBody, UserListItemDto } from "../../api/types.js";
import { WebauthnStepUpButton } from "../../account/WebauthnStepUpButton.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { MoreActionsMenuItem } from "../../components/MoreActionsMenuItem.js";
import { PhoneCountrySelect } from "../../components/PhoneCountrySelect.js";
import { RetryHint } from "../../components/RetryHint.js";
import { SearchableSelect } from "../../components/SearchableSelect.js";
import { useDropdownMenu } from "../../components/useDropdownMenu.js";
import { useModalFocusTrap } from "../../components/useModalFocusTrap.js";
import { roleLabel } from "../../auth/role-labels.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { useEventOptions } from "../../hooks/useEventOptions.js";
import { lookupReady, type OptionsLoad } from "../../hooks/useOptionsLoad.js";
import { useOrganizationOptions } from "../../hooks/useOrganizationOptions.js";
import { useOverscrollBounceGuard } from "../../hooks/useOverscrollBounceGuard.js";
import { isValidEmailFormat } from "../../utils/email.js";
import { NO_AUTOFILL_PROPS } from "../../settings/mailTransportFormParts.js";
import { rolesAfterStagedChanges } from "./list-changes.js";
import { LookupSlot } from "./LookupSlot.js";
import { organizationPlaceholder } from "./lookup-copy.js";
import { RecentLogins, useRecentLogins } from "./RecentLogins.js";
import "../../attendees/add-attendee-modal.css";

type UserEditModalProps = {
  open: boolean;
  user: UserListItemDto | null;
  onClose: () => void;
  /**
   * `saved` is the person as the server has them after the action, when the action can tell (a saved profile with its
   * staged role changes, an enabled or disabled account): the list shows it before it is refreshed. The other
   * actions leave it out, and the list has only its refresh to go by.
   */
  onUpdated: (user: UserListItemDto, message?: string, saved?: UserListItemDto) => void;
  onDeleted: (user: UserListItemDto) => void;
};

type AssignRole = "" | "superadmin" | "admin" | "operator";

/** A role grant staged locally by "Add" but not yet sent to the server - only "Save changes"
 * actually calls grantUserRole, see the section comment above handleAddClick. */
interface PendingRoleAdd {
  key: string;
  role: "superadmin" | "admin" | "operator";
  scopeType: "instance" | "organization" | "event";
  scopeId: string | null;
  label: string;
  icon: string;
}

/** Whether the currently-picked role type has everything it needs to be granted: an event for
 * operator, an organization for admin, nothing extra for superadmin - and never true for "no
 * role picked yet". */
function isRoleScopeReady(role: AssignRole, eventId: string, orgId: string): boolean {
  if (role === "operator") return !!eventId;
  if (role === "admin") return !!orgId;
  return role === "superadmin";
}

/** isSelf && isRoleTypeChange can never both be true: the Role select itself is disabled
 * whenever isSelf is true (see RoleAccessSection's own disabled prop below), so a self-viewing
 * admin can never actually set newRole away from their current type in the first place. */
function resolveRoleActionTitle(
  isSelf: boolean,
  isRoleTypeChange: boolean,
  hasPendingRoleChanges: boolean,
): string | undefined {
  /* v8 ignore if */
  if (isSelf && isRoleTypeChange) return "You cannot change your own role.";
  if (isRoleTypeChange && hasPendingRoleChanges) return "Save or discard your pending scope changes first.";
  return undefined;
}

/** The Role select is locked once a scope grant is staged - switching type here would leave that
 * staged grant pointing at a role that's about to change, and saveProfile submits staged adds in
 * whatever order they were queued, not filtered by the type currently shown in the picker. */
function roleSelectTitle(isSelf: boolean, hasPendingAdds: boolean): string | undefined {
  if (isSelf) return "You cannot change your own role.";
  if (hasPendingAdds) return "Save or cancel your pending scope changes first.";
  return undefined;
}

function unlinkSsoTooltip(hasSso: boolean, isSelf: boolean): string | undefined {
  if (!hasSso) return "This account doesn't use an identity provider.";
  if (isSelf) return "You cannot unlink an identity provider from your own account.";
  return undefined;
}

/** Reset password and Reset two-factor both act on local sign-in, which an SSO-managed account
 * doesn't have - see "Unlink identity provider" above for the flow that actually applies here. */
function ssoManagedTooltip(hasSso: boolean): string | undefined {
  if (hasSso) return "Managed by your identity provider.";
  return undefined;
}

/** Whose access the role-type-change warning is about to remove. isSelf can never be true in
 * practice: this label only renders while isRoleTypeChange is true, and the Role select itself
 * is disabled whenever isSelf is true - see resolveRoleActionTitle's own comment above. */
function roleChangeOwnerLabel(isSelf: boolean, displayTitle: string): string {
  /* v8 ignore if */
  if (isSelf) return "your";
  return `${displayTitle}'s`;
}

function activeSessionsLabel(count: number): string {
  if (count === 0) return "None";
  return `${count} session${count === 1 ? "" : "s"}`;
}

/** Real provider name(s) for the Sign-in method tile - e.g. "Authentik", or
 * "Authentik + Cloudflare Access" when also ZTNA-linked (both are just rows in the same
 * external_identities relation). Same join style as AccountTypeField on My Account. */
function signInMethodLabel(user: UserListItemDto): string {
  if (!user.has_sso) return "Local password";
  return user.external_identities.map((ei) => ei.provider_display_name).join(" + ");
}

/** The header's "More actions" kebab menu (Reset MFA / Reset password / Unlink SSO / Revoke
 * sessions / Disable-Enable / Delete account) - each item just closes the menu and opens its own
 * confirm dialog or inline form; the parent owns all of that state. */
function UserMoreActionsMenu({
  moreActions,
  disabled,
  busy,
  user,
  isSelf,
  onResetMfa,
  onResetPassword,
  onUnlinkSso,
  onRevokeSessions,
  onToggleActive,
  onDelete,
}: Readonly<{
  moreActions: ReturnType<typeof useDropdownMenu<HTMLButtonElement>>;
  disabled: boolean;
  /** An action that has no dialog of its own is running (Enable account): the trigger shows it, as the menu has closed. */
  busy: boolean;
  user: UserListItemDto;
  isSelf: boolean;
  onResetMfa: () => void;
  onResetPassword: () => void;
  onUnlinkSso: () => void;
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
        loading={busy}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={moreActions.open}
        onClick={() => moreActions.setOpen((o) => !o)}
        icon={<i className="ti ti-dots-vertical" aria-hidden="true" />}
      />
      {moreActions.open && (
        <div
          className="more-actions-menu__panel at-scroll"
          role="menu"
          ref={moreActions.panelRef}
          style={moreActions.panelStyle}
        >
          <MoreActionsMenuItem
            icon="refresh"
            label="Reset two-factor"
            hint="Clear two-factor authentication"
            disabled={user.has_sso}
            tooltip={ssoManagedTooltip(user.has_sso)}
            onClick={pick(onResetMfa)}
          />
          <MoreActionsMenuItem
            icon="key"
            label="Reset password"
            hint="Set a new temporary password"
            disabled={user.has_sso}
            tooltip={ssoManagedTooltip(user.has_sso)}
            onClick={pick(onResetPassword)}
          />
          <MoreActionsMenuItem
            icon="unlink"
            label="Unlink identity provider"
            hint="Require a local password and sign them out everywhere"
            disabled={!user.has_sso || isSelf}
            tooltip={unlinkSsoTooltip(user.has_sso, isSelf)}
            onClick={pick(onUnlinkSso)}
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
 * granted (of the current role type) plus any not-yet-saved staged adds, a warning when
 * switching type, and the Add/Change area (built by the parent as `roleAssignArea`, since it
 * needs the event/organization picker state). */
function RoleAccessSection({
  user,
  newRole,
  setNewRole,
  roleBusy,
  submitting,
  isSelf,
  currentRoleType,
  isRoleTypeChange,
  displayTitle,
  scopeChipLabel,
  scopeChipText,
  scopeNameKnown,
  scopeLookupHints,
  pendingAdds,
  pendingRemoveIds,
  onRemoveRole,
  onCancelPendingAdd,
  roleOptions,
  isSoloRole,
  scopePickerControl,
  roleActionButton,
}: Readonly<{
  user: UserListItemDto;
  newRole: AssignRole;
  setNewRole: (role: AssignRole) => void;
  roleBusy: boolean;
  submitting: boolean;
  isSelf: boolean;
  currentRoleType: string;
  isRoleTypeChange: boolean;
  displayTitle: string;
  scopeChipLabel: (assignment: RoleAssignmentDto) => string;
  scopeChipText: (assignment: RoleAssignmentDto) => ReactNode;
  /** Whether the chip can say which scope it is: until then the chips of a kind look alike, and removing one is off. */
  scopeNameKnown: (assignment: RoleAssignmentDto) => boolean;
  /** One hint with a Retry per lookup (events, organizations) that failed and that this person's scopes or the picker need. */
  scopeLookupHints: ReactNode;
  pendingAdds: PendingRoleAdd[];
  pendingRemoveIds: ReadonlySet<string>;
  onRemoveRole: (assignmentId: string) => void;
  onCancelPendingAdd: (key: string) => void;
  roleOptions: Array<{ id: string; label: string; icon: string }>;
  isSoloRole: boolean;
  scopePickerControl: ReactNode;
  roleActionButton: ReactNode;
}>) {
  return (
    <section className="users-modal__section">
      <h3 className="users-modal__section-title">Role & access</h3>
      <div className={`users-modal__role-assign${isSoloRole ? " users-modal__role-assign--solo" : ""}`}>
        <SearchableSelect
          id="edit-user-assign-role"
          label="Role"
          placeholder="No role assigned"
          searchPlaceholder="Search roles…"
          emptyLabel="No roles found"
          value={newRole}
          options={roleOptions}
          disabled={roleBusy || isSelf || pendingAdds.length > 0}
          title={roleSelectTitle(isSelf, pendingAdds.length > 0)}
          onChange={(id) => setNewRole(id as AssignRole)}
        />
        {newRole === "superadmin"
          ? currentRoleType !== "superadmin" && roleActionButton
          : (
            <>
              {scopePickerControl}
              {roleActionButton}
            </>
          )}
      </div>

      {scopeLookupHints}

      {!isRoleTypeChange &&
        currentRoleType !== "superadmin" &&
        (user.roles.length > 0 || pendingAdds.length > 0) && (
          <div className="users-modal__chips">
            {user.roles
              .filter((assignment) => !pendingRemoveIds.has(assignment.id))
              .map((assignment) => (
                <span key={assignment.id} className="users-modal__chip">
                  <i
                    className={`ti ti-${assignment.scope_type === "event" ? "calendar-event" : "building"}`}
                    aria-hidden="true"
                  />
                  {assignment.is_oidc && (
                    <i className="ti ti-cloud" aria-hidden="true" title="Managed by identity provider" />
                  )}
                  {scopeChipText(assignment)}
                  {!assignment.is_oidc && (
                    <button
                      type="button"
                      className="users-modal__chip-remove"
                      disabled={isSelf || submitting || !scopeNameKnown(assignment)}
                      title={chipRemoveTitle(isSelf, scopeNameKnown(assignment))}
                      onClick={() => onRemoveRole(assignment.id)}
                      aria-label={`Remove ${roleLabel(currentRoleType)} for ${scopeChipLabel(assignment)}`}
                    >
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                  )}
                </span>
              ))}
            {pendingAdds.map((add) => (
              <span
                key={add.key}
                className="users-modal__chip users-modal__chip--pending"
                title="Not saved yet - click Save changes to apply."
              >
                <i className={`ti ti-${add.icon}`} aria-hidden="true" />
                {add.label}
                <button
                  type="button"
                  className="users-modal__chip-remove"
                  disabled={submitting}
                  onClick={() => onCancelPendingAdd(add.key)}
                  aria-label={`Cancel adding ${roleLabel(add.role)} for ${add.label}`}
                >
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
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

      {newRole === "superadmin" && currentRoleType === "superadmin" && (
        <Notice variant="info">
          Superadmin already covers every event and organization in this instance, so there are no scopes to add.
        </Notice>
      )}
    </section>
  );
}

/** The modal's "Sign-in security" section - sign-in method/MFA/active-sessions status chips, then
 * either the Recent logins list or (swapped in when resetPasswordOpen) the Reset password form. */
function SignInSecuritySection({
  user,
  resetPasswordOpen,
  recentLogins,
  resetPasswordTitleId,
  newPassword,
  setNewPassword,
  requiresActorStepUp,
  resetPasswordCode,
  setResetPasswordCode,
  resetPasswordBusy,
  setResetPasswordBusy,
  onCancelResetPassword,
  onResetPassword,
  setError,
}: Readonly<{
  user: UserListItemDto;
  resetPasswordOpen: boolean;
  recentLogins: OptionsLoad<SecurityAuditLogEntryDto>;
  resetPasswordTitleId: string;
  newPassword: string;
  setNewPassword: (value: string) => void;
  requiresActorStepUp: boolean;
  resetPasswordCode: string;
  setResetPasswordCode: (value: string) => void;
  resetPasswordBusy: boolean;
  setResetPasswordBusy: (busy: boolean) => void;
  onCancelResetPassword: () => void;
  onResetPassword: (proof?: StepUpProofBody) => Promise<void>;
  setError: (message: string | null) => void;
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
            {/* Real provider name(s) (e.g. "Authentik", or "Authentik + Cloudflare Access" when
             * also ZTNA-linked) instead of the generic "Identity provider" - both are just rows
             * in the same external_identities relation, so a Cloudflare Access link shows up
             * here automatically rather than being invisible (PO report). Same join style as
             * AccountTypeField on My Account. */}
            <span title={signInMethodLabel(user)}>{signInMethodLabel(user)}</span>
          </span>
        </div>
        <div className="users-modal__status-chip">
          <span
            className={`users-modal__status-chip-icon users-modal__status-chip-icon--${user.has_mfa ? "ok" : "warn"}`}
          >
            <i className={`ti ti-shield-${user.has_mfa ? "check" : "off"}`} aria-hidden="true" />
          </span>
          <span className="users-modal__status-chip-body">
            <strong>Two-factor</strong>
            <span title={user.has_mfa ? "Authenticator app enrolled" : "Not set up"}>
              {user.has_mfa ? "Authenticator app enrolled" : "Not set up"}
            </span>
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
            <span title={activeSessionsLabel(user.active_sessions_count)}>
              {activeSessionsLabel(user.active_sessions_count)}
            </span>
          </span>
        </div>
      </div>

      {resetPasswordOpen && (
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
          {requiresActorStepUp && (
            <div className="mail-field-row">
              <Input
                id="reset-password-actor-code"
                name="reset-password-actor-code"
                label="Your authenticator or backup code"
                type="text"
                autoCapitalize="off"
                spellCheck={false}
                value={resetPasswordCode}
                disabled={resetPasswordBusy}
                onChange={(e) => setResetPasswordCode(e.target.value)}
                {...NO_AUTOFILL_PROPS}
                autoComplete="one-time-code"
              />
              <WebauthnStepUpButton
                busy={resetPasswordBusy}
                onBusyChange={setResetPasswordBusy}
                onError={setError}
                onSubmit={onResetPassword}
              />
            </div>
          )}
          <p className="form-hint">
            User sessions will be revoked. They must log in with the new password.
            {requiresActorStepUp &&
              " Resetting another superadmin's password requires your own authenticator or backup code."}
          </p>
          <div className="users-modal__actions" style={{ justifyContent: "flex-start" }}>
            <Button type="button" variant="secondary" disabled={resetPasswordBusy} onClick={onCancelResetPassword}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={resetPasswordBusy}
              disabled={newPassword.length < PASSWORD_MIN_LENGTH || (requiresActorStepUp && resetPasswordCode.trim().length === 0)}
              onClick={() => void onResetPassword()}
            >
              Reset password
            </Button>
          </div>
        </section>
      )}
      {/* Kept mounted while the Reset password form is open (hidden): a failure hint that is mounted again when the form is
          cancelled would be announced as a new failure. */}
      <div hidden={resetPasswordOpen}>
        <RecentLogins logins={recentLogins} />
      </div>
    </section>
  );
}

/** Why a scope chip's remove button is off, when it is: your own role, or a name that has not loaded (so which scope it removes is not known). */
function chipRemoveTitle(isSelf: boolean, nameKnown: boolean): string | undefined {
  if (isSelf) return "You cannot remove your own role assignment.";
  return nameKnown ? undefined : "Available once the names of the scopes have loaded.";
}

/** The person as the server has them after a profile save and the role changes that went through, when that is known. */
function savedPerson(profile: UserListItemDto, revokedIds: ReadonlySet<string>, granted: RoleAssignmentDto[]): UserListItemDto | undefined {
  const roles = rolesAfterStagedChanges(profile.roles, revokedIds, granted);
  return roles ? { ...profile, roles } : undefined;
}

/** What the dialog says when saving the profile or its staged role changes failed. */
function saveProfileError(err: unknown): string {
  if (err instanceof ApiError && (hasApiErrorCode(err, "email_taken") || hasApiErrorCode(err, "email_conflict"))) {
    return "A user with this email already exists. Use a different email address.";
  }
  if (err instanceof ApiError && hasApiErrorCode(err, "cannot_change_own_role")) {
    return "You cannot change your own role. Ask another superadmin.";
  }
  return operatorApiErrorMessage(err, "Failed to save changes.");
}

export function UserEditModal({ open, user, onClose, onUpdated, onDeleted }: Readonly<UserEditModalProps>) {
  const { user: currentUser } = useAuth();
  const titleId = useId();
  const resetPasswordTitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef, open);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partialSave = useRef<{ profile: UserListItemDto; saved: UserListItemDto | undefined } | null>(null);
  // The failure of an action that runs from a confirmation dialog (disable, reset two-factor, revoke sessions, change
  // role). It is said inside that dialog, which sits above this one: a message on the modal behind it is hidden by the
  // dialog's own backdrop, and the operator would see a dialog that did nothing.
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // The three things this dialog reads besides the person: the events (for the scope names and the Operator picker),
  // the organizations (the same for Admin) and the last sign-ins. Each has its own placeholder, error and Retry, and
  // one failing does not touch the others, nor what has been typed.
  const events = useEventOptions({ includeArchived: true, enabled: open });
  const organizations = useOrganizationOptions(open);
  const recentLogins = useRecentLogins(open, user?.id);
  const [newRole, setNewRole] = useState<AssignRole>("");
  const [newOrgId, setNewOrgId] = useState("");
  const [newEventId, setNewEventId] = useState("");
  const [pendingAdds, setPendingAdds] = useState<PendingRoleAdd[]>([]);
  const [pendingRemoveIds, setPendingRemoveIds] = useState<ReadonlySet<string>>(new Set());
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleChangeConfirmOpen, setRoleChangeConfirmOpen] = useState(false);
  const [resetMfaOpen, setResetMfaOpen] = useState(false);
  const [resetMfaBusy, setResetMfaBusy] = useState(false);
  const [resetMfaCode, setResetMfaCode] = useState("");
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetPasswordCode, setResetPasswordCode] = useState("");
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);
  const [revokeSessionsOpen, setRevokeSessionsOpen] = useState(false);
  const [revokeSessionsBusy, setRevokeSessionsBusy] = useState(false);
  const [revokeSessionsCode, setRevokeSessionsCode] = useState("");
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
    setPendingAdds([]);
    setPendingRemoveIds(new Set());
    setRoleChangeConfirmOpen(false);
    setResetMfaOpen(false);
    setResetPasswordOpen(false);
    setNewPassword("");
    setRevokeSessionsOpen(false);
    setUnlinkSsoOpen(false);
    setUnlinkSsoPassword("");
    setUnlinkSsoError(null);
    setDisableConfirmOpen(false);
    setConfirmError(null);
    setDeleteConfirm(false);
    setDeleteError(null);
  }, [user]);

  useEffect(() => {
    if (open) return;
    partialSave.current = null;
    setPendingAdds([]);
    setPendingRemoveIds(new Set());
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

  // Default the Admin scope picker to the first organization this person is not already assigned to. The picker only
  // ever renders pickableOrganizations (same filter in the render body), so seeding from the raw list could default it
  // to a value with no matching option.
  useEffect(() => {
    const assignedOrgIds = new Set(
      (user?.roles ?? []).filter((r) => r.scope_type === "organization").map((r) => r.scope_id),
    );
    const first = organizations.organizations.find((org) => !assignedOrgIds.has(org.id));
    if (first) setNewOrgId((current) => current || first.id);
  }, [organizations.organizations, user]);

  // Some other action is running (so Save is off, and the head's menu and Close with it). The one that is running is
  // never in here: its own button is busy, not disabled.
  const otherActionBusy =
    resetMfaBusy ||
    resetPasswordBusy ||
    roleBusy ||
    deleteBusy ||
    revokeSessionsBusy ||
    toggleActiveBusy ||
    unlinkSsoBusy;
  const headActionsDisabled = submitting || otherActionBusy;

  const handleClose = () => {
    if (headActionsDisabled) return;
    // A save that went through only in part: the list hears of what is saved now that the dialog is done with it.
    const partial = partialSave.current;
    partialSave.current = null;
    if (partial) onUpdated(partial.profile, "Changes partly saved", partial.saved);
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

  // Every ConfirmDialog below is itself useModalFocusTrap'd once open, with its own Escape
  // handler - both listeners live on `document`, so without this, this modal's own handler
  // (registered first, since it mounts before any child dialog opens) fires first and closes
  // the whole editor - discarding unsaved profile edits - instead of leaving the topmost
  // dialog to handle Escape alone (bot review finding; same pattern as EventItemDrawer's own
  // `!deleteConfirmOpen`).
  const anyConfirmDialogOpen =
    deleteConfirm ||
    disableConfirmOpen ||
    resetMfaOpen ||
    revokeSessionsOpen ||
    unlinkSsoOpen ||
    roleChangeConfirmOpen;
  // A confirmation always opens without the failure of an earlier one: that failure can arrive after its dialog was
  // closed (the person was replaced while the request was in flight), and would otherwise be shown by the next one.
  useEffect(() => {
    if (anyConfirmDialogOpen) setConfirmError(null);
  }, [anyConfirmDialogOpen]);
  useModalFocusTrap(panelRef, open && !anyConfirmDialogOpen, handleClose);
  const moreActions = useDropdownMenu<HTMLButtonElement>({ align: "end" });

  // Profile fields and staged Role & access edits (pendingAdds/pendingRemoveIds) all commit
  // together here, in one click - previously, Add/Remove each called the API immediately, which
  // refreshed the Staff users list behind this modal on every single click (visible as a
  // flicker) instead of once, on a deliberate save (PO review). Removes run before adds so
  // clearing a scope and re-adding it in the same sitting nets out correctly. Each item is
  // dropped from its pending list only once its own request succeeds, so a failure partway
  // through (e.g. the email PATCH rejected, or a scope deleted by someone else mid-edit) leaves
  // just the unfinished remainder staged for a retry instead of resubmitting everything.
  const saveProfile = async () => {
    // Save is only rendered once the render gate below (`if (!open || !user) return null`) has
    // passed, so user is always set here.
    /* v8 ignore if */
    if (!user) return;
    setSubmitting(true);
    setError(null);
    // What the server holds once the profile is saved, and which of the staged role changes have gone through: when a
    // later step fails, the profile (and some roles) are saved all the same, and the list must hear about it.
    let patched: UserListItemDto | null = null;
    const revokedIds = new Set<string>();
    const grantedRoles: RoleAssignmentDto[] = [];
    try {
      const { user: updated } = await patchAdminUser(user.id, {
        display_name: displayName.trim() || null,
        email: email.trim(),
        phone_country_code: phoneCountryCode || null,
        phone_number: phoneNumber.trim() || null,
      });
      patched = updated;

      for (const assignmentId of pendingRemoveIds) {
        await revokeUserRole(user.id, assignmentId);
        revokedIds.add(assignmentId);
        setPendingRemoveIds((prev) => {
          const next = new Set(prev);
          next.delete(assignmentId);
          return next;
        });
      }
      for (const add of pendingAdds) {
        // The grants run one after the other on purpose: each is dropped from the staged list only once it has
        // succeeded, and the first failure stops the rest.
        const { assignment } = await grantUserRole(user.id, { // NOSONAR - sequential by design (S9382)
          role: add.role,
          scope_type: add.scopeType,
          scope_id: add.scopeId,
        });
        grantedRoles.push({ ...assignment, is_oidc: false });
        setPendingAdds((prev) => prev.filter((p) => p.key !== add.key));
      }

      // The profile as the PATCH answered it, with the role changes that were made after it (when they are all known).
      partialSave.current = null;
      onUpdated(updated, "Changes saved", savedPerson(updated, revokedIds, grantedRoles));
      onClose();
    } catch (err) {
      setError(saveProfileError(err));
      // The profile was saved but a role change was not: the dialog stays open for a retry, and the list hears of what
      // did go through when the dialog closes (a refresh now would hand this dialog a new person and reset its staging).
      if (patched) partialSave.current = { profile: patched, saved: savedPerson(patched, revokedIds, grantedRoles) };
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

  // Switching role TYPE (e.g. Operator -> Admin) is destructive - it drops every current
  // assignment of the old type server-side - and already has its own explicit confirm dialog
  // below (roleChangeConfirmOpen), the same "one deliberate, immediately-committed action"
  // pattern as Reset password/Disable/Delete elsewhere in this modal. Unlike a same-type
  // scope Add/Remove (handleAddClick/handleMarkForRemoval below), it stays immediate rather
  // than staged - mixing a destructive type swap with a batch of not-yet-saved scope edits for
  // the type it's about to replace would leave those edits pointing at a role that no longer
  // applies. roleActionDisabled below guards this by disabling "Change" while anything is
  // pending, so the two flows can't overlap in the first place.
  const handleChangeRoleType = async () => {
    if (!user || !newRole || roleBusy) return;
    setRoleBusy(true);
    setConfirmError(null);
    try {
      if (newRole === "superadmin") {
        await grantUserRole(user.id, { role: "superadmin", scope_type: "instance" });
      } else if (newRole === "admin") {
        // roleActionDisabled (below) already requires isRoleScopeReady, which for "admin" means
        // newOrgId is set - this dialog can only open once that already held true.
        /* v8 ignore if */
        if (!newOrgId) {
          setConfirmError("Select an organization for the admin role.");
          return;
        }
        await grantUserRole(user.id, { role: "admin", scope_type: "organization", scope_id: newOrgId });
      } else if (newRole === "operator") {
        // Same reasoning as the admin branch above, for newEventId.
        /* v8 ignore if */
        if (!newEventId) {
          setConfirmError("Select an event for the operator role.");
          return;
        }
        await grantUserRole(user.id, { role: "operator", scope_type: "event", scope_id: newEventId });
      }
      onUpdated(user, "Role updated");
      setRoleChangeConfirmOpen(false);
      setNewEventId("");
      setNewOrgId("");
      // A type change replaces the whole role identity - unlike a same-type scope add/remove
      // (staged, doesn't close), the modal's own `user` prop is now stale (still showing the
      // old role/chips) until the parent's next list refresh finds this user again. If Staff
      // users is currently filtered by the old role, that refresh can drop the target entirely,
      // leaving nothing for the modal to pick fresh data up from - so it closes here instead of
      // risking sitting open indefinitely showing the just-replaced role as if nothing happened.
      onClose();
    } catch (err) {
      if (err instanceof ApiError && hasApiErrorCode(err, "cannot_change_own_role")) {
        setConfirmError("You cannot change your own role. Ask another superadmin.");
      } else {
        setConfirmError(operatorApiErrorMessage(err, "Failed to assign role."));
      }
    } finally {
      setRoleBusy(false);
    }
  };

  /** Stages a same-type scope grant locally (Role & access "Add") - committed only by
   * saveProfile, on "Save changes". No confirm needed: unlike a type change, this can't destroy
   * anything, and it can still be undone for free by removing the chip before saving. */
  const handleAddClick = () => {
    // roleActionDisabled (below) already requires isRoleScopeReady, which is false for an empty
    // newRole - the Add button this handler is wired to can't be clicked to reach this point.
    /* v8 ignore if */
    if (!newRole) return;
    setError(null);
    if (newRole === "superadmin") {
      setPendingAdds((prev) => [
        ...prev,
        { key: crypto.randomUUID(), role: "superadmin", scopeType: "instance", scopeId: null, label: "Instance-wide", icon: "crown" },
      ]);
    } else if (newRole === "admin") {
      // Same isRoleScopeReady reasoning as above, for newOrgId.
      /* v8 ignore if */
      if (!newOrgId) {
        setError("Select an organization for the admin role.");
        return;
      }
      const org = organizations.organizations.find((o) => o.id === newOrgId);
      // newOrgId only ever comes from picking an option built off `organizations` itself, so
      // this lookup always succeeds - the `?? newOrgId` fallback is defense-in-depth only.
      /* v8 ignore next */
      const orgLabel = org?.name ?? newOrgId;
      setPendingAdds((prev) => [
        ...prev,
        { key: crypto.randomUUID(), role: "admin", scopeType: "organization", scopeId: newOrgId, label: orgLabel, icon: "building" },
      ]);
    } else if (newRole === "operator") {
      // Same isRoleScopeReady reasoning as above, for newEventId.
      /* v8 ignore if */
      if (!newEventId) {
        setError("Select an event for the operator role.");
        return;
      }
      const ev = events.events.find((e) => e.id === newEventId);
      // Same reasoning as the admin branch's orgLabel above, for newEventId/events.
      /* v8 ignore next */
      const eventLabel = ev?.title ?? newEventId;
      setPendingAdds((prev) => [
        ...prev,
        { key: crypto.randomUUID(), role: "operator", scopeType: "event", scopeId: newEventId, label: eventLabel, icon: "calendar-event" },
      ]);
    }
    setNewEventId("");
    setNewOrgId("");
  };

  /** Stages an existing (already-granted) assignment for removal - the chip below hides it
   * immediately, but revokeUserRole only runs once saveProfile actually saves. */
  const handleMarkForRemoval = (assignmentId: string) => {
    setError(null);
    setPendingRemoveIds((prev) => new Set(prev).add(assignmentId));
  };

  /** Un-stages a not-yet-saved pending add - nothing was ever sent to the server, so this is a
   * plain local removal from the list, no confirmation or request involved. */
  const handleCancelPendingAdd = (key: string) => {
    setPendingAdds((prev) => prev.filter((p) => p.key !== key));
  };

  // Each of these three step-up-gated handlers doubles as the WebauthnStepUpButton's onSubmit
  // below (which always supplies a proof) and as its own dialog's plain Confirm handler (which
  // doesn't - falls back to whatever's in the matching code field, if anything).

  const handleResetMfa = async (proof?: StepUpProofBody) => {
    // Only reachable from the More actions menu, itself only rendered once the render gate
    // below (`if (!open || !user) return null`) has passed.
    /* v8 ignore if */
    if (!user) return;
    setResetMfaBusy(true);
    setConfirmError(null);
    try {
      await resetUserMfa(user.id, proof ?? (resetMfaCode ? { code: resetMfaCode } : undefined));
      setResetMfaOpen(false);
      setResetMfaCode("");
      onUpdated(user, "Two-factor reset. User must sign in again.");
      onClose();
    } catch (err) {
      setConfirmError(operatorApiErrorMessage(err, "Failed to reset two-factor."));
    } finally {
      setResetMfaBusy(false);
    }
  };

  const handleResetPassword = async (proof?: StepUpProofBody) => {
    if (!user || newPassword.length < PASSWORD_MIN_LENGTH) return;
    setResetPasswordBusy(true);
    setError(null);
    try {
      await resetUserPassword(user.id, {
        new_password: newPassword,
        ...(proof ?? (resetPasswordCode ? { code: resetPasswordCode } : {})),
      });
      setResetPasswordOpen(false);
      setNewPassword("");
      setResetPasswordCode("");
      onUpdated(user, "Password reset. Sessions revoked.");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && hasApiErrorCode(err, "invalid_request")) {
        setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      } else {
        setError(operatorApiErrorMessage(err, "Failed to reset password."));
      }
    } finally {
      setResetPasswordBusy(false);
    }
  };

  const handleRevokeSessions = async (proof?: StepUpProofBody) => {
    // Same render-gate reasoning as handleResetMfa above.
    /* v8 ignore if */
    if (!user) return;
    setRevokeSessionsBusy(true);
    setConfirmError(null);
    try {
      const { sessionsRevoked } = await revokeUserSessions(
        user.id,
        proof ?? (revokeSessionsCode ? { code: revokeSessionsCode } : undefined),
      );
      setRevokeSessionsOpen(false);
      setRevokeSessionsCode("");
      onUpdated(user, `${sessionsRevoked} session${sessionsRevoked === 1 ? "" : "s"} revoked`);
      onClose();
    } catch (err) {
      setConfirmError(operatorApiErrorMessage(err, "Failed to revoke sessions."));
    } finally {
      setRevokeSessionsBusy(false);
    }
  };

  const handleUnlinkSso = async () => {
    if (!user || unlinkSsoPassword.length < PASSWORD_MIN_LENGTH) return;
    setUnlinkSsoBusy(true);
    setUnlinkSsoError(null);
    try {
      await unlinkUserExternalIdentity(user.id, { new_password: unlinkSsoPassword });
      setUnlinkSsoOpen(false);
      setUnlinkSsoPassword("");
      onUpdated(user, "Identity provider unlinked. User must sign in with the new local password.");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && hasApiErrorCode(err, "invalid_request")) {
        setUnlinkSsoError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      } else {
        setUnlinkSsoError(operatorApiErrorMessage(err, "Failed to unlink identity provider."));
      }
    } finally {
      setUnlinkSsoBusy(false);
    }
  };

  const applyActiveChange = async (nextActive: boolean) => {
    // Same render-gate reasoning as handleResetMfa above.
    /* v8 ignore if */
    if (!user) return;
    setToggleActiveBusy(true);
    setError(null);
    setConfirmError(null);
    try {
      const { user: updated } = await patchAdminUser(user.id, { is_active: nextActive });
      setDisableConfirmOpen(false);
      onUpdated(updated, nextActive ? "Account enabled" : "Account disabled. Sessions revoked.", updated);
      onClose();
    } catch (err) {
      // Enabling has no dialog (the failure goes on the modal); disabling does (the failure goes inside it).
      (nextActive ? setError : setConfirmError)(operatorApiErrorMessage(err, "Failed to update account status."));
    } finally {
      setToggleActiveBusy(false);
    }
  };

  const handleToggleActiveClick = () => {
    // Same render-gate reasoning as handleResetMfa above.
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
  const currentRoleType = user.roles[0]?.role ?? "";
  const isRoleTypeChange = newRole !== "" && currentRoleType !== "" && newRole !== currentRoleType;

  // Mirrors the server's actorMustStepUpForReset (apps/web/src/admin/users-routes.ts): resetting
  // another superadmin's 2FA/password requires the acting superadmin to prove themselves with
  // their own TOTP/recovery code first, so the reset dialogs below show that field only then.
  const requiresActorStepUp = !isSelf && currentRoleType === "superadmin";

  /** What a chip shows: the name, or a placeholder of its width while the lookup that has it is on its way. */
  function scopeChipText(assignment: RoleAssignmentDto): ReactNode {
    const lookup = assignment.scope_type === "event" ? events : organizations;
    if (assignment.scope_type !== "instance" && lookup.loading) return <Skeleton variant="rect" width={88} height={19} />;
    return scopeChipLabel(assignment);
  }

  /** Resolves a role assignment's raw scope_id to the human label shown elsewhere in the admin
   * (event title / organization name) - this modal already fetches both lists for the "assign
   * role" controls below, so no extra request is needed. While a lookup is on its way, or failed, it says what kind of
   * scope it is; it falls back to the id only when the answer does not hold the scope (e.g. a since-deleted event). */
  function scopeNameKnown(assignment: RoleAssignmentDto): boolean {
    if (assignment.scope_type === "event") return lookupReady(events);
    return assignment.scope_type !== "organization" || lookupReady(organizations);
  }

  function scopeChipLabel(assignment: RoleAssignmentDto): string {
    // Only ever called for assignments in the chip list below, which is itself hidden whenever
    // currentRoleType === "superadmin" - and roles are exclusive by type (see the comment above
    // currentRoleType), so an assignment reaching this function can never be instance-scoped.
    /* v8 ignore if */
    if (assignment.scope_type === "instance") return "Instance-wide";
    // While the lookup is on its way, or failed, the name is not known: say what kind of scope it is, not its id.
    if (assignment.scope_type === "event") {
      if (!lookupReady(events)) return "Event";
      return events.events.find((e) => e.id === assignment.scope_id)?.title ?? assignment.scope_id ?? "Unknown event";
    }
    if (assignment.scope_type === "organization") {
      if (!lookupReady(organizations)) return "Organization";
      return organizations.organizations.find((o) => o.id === assignment.scope_id)?.name ?? assignment.scope_id ?? "Unknown organization";
    }
    // scope_type is a closed union already exhausted by the three checks above.
    /* v8 ignore next */
    return assignment.scope_id ?? assignment.scope_type;
  }

  // Scopes already granted (of the current role type), minus any staged for removal, plus any
  // staged as a not-yet-saved pending add, shouldn't also show up as pickable - they're already
  // a chip below, with their own remove control.
  const assignedEventIds = new Set(
    user.roles.filter((r) => r.scope_type === "event" && !pendingRemoveIds.has(r.id)).map((r) => r.scope_id),
  );
  const assignedOrgIds = new Set(
    user.roles.filter((r) => r.scope_type === "organization" && !pendingRemoveIds.has(r.id)).map((r) => r.scope_id),
  );
  const pendingEventIds = new Set(pendingAdds.filter((p) => p.scopeType === "event").map((p) => p.scopeId));
  const pendingOrgIds = new Set(pendingAdds.filter((p) => p.scopeType === "organization").map((p) => p.scopeId));
  const pickableEvents = events.events.filter((e) => !assignedEventIds.has(e.id) && !pendingEventIds.has(e.id));
  const pickableOrganizations = organizations.organizations.filter(
    (org) => !assignedOrgIds.has(org.id) && !pendingOrgIds.has(org.id),
  );

  const roleOptions = [
    { id: "superadmin", label: roleLabel("superadmin"), icon: "crown" },
    { id: "admin", label: roleLabel("admin"), icon: "building" },
    { id: "operator", label: roleLabel("operator"), icon: "calendar-event" },
  ];

  const scopePickerControl =
    newRole === "operator" ? (
      <LookupSlot lookup={events} label="events" showHint={false}>
        <SearchableSelect
          id="edit-user-event-scope"
          label="Event scope for operator role"
          placeholder={events.error ? "Could not load events" : "Select event…"}
          searchPlaceholder="Search events…"
          emptyLabel="No events found"
          value={newEventId}
          options={pickableEvents.map((e) => ({ id: e.id, label: e.title, icon: "calendar-event" }))}
          disabled={roleBusy || events.error !== null}
          onChange={setNewEventId}
        />
      </LookupSlot>
    ) : (
      <LookupSlot lookup={organizations} label="organizations" showHint={false}>
        <SearchableSelect
          id="edit-user-org-scope"
          label="Organization scope for admin role"
          placeholder={organizationPlaceholder(organizations.error, pickableOrganizations.length)}
          searchPlaceholder="Search organizations…"
          emptyLabel="No organizations found"
          value={newOrgId}
          options={pickableOrganizations.map((org) => ({ id: org.id, label: org.name, icon: "building" }))}
          disabled={roleBusy || organizations.error !== null || pickableOrganizations.length === 0}
          onChange={setNewOrgId}
        />
      </LookupSlot>
    );
  // A failed lookup is said once, under the section, with its own Retry: the picker is off, and the chips show what
  // kind of scope they are instead of a name. Only the lookups this person's scopes or the picker use are shown.
  const needsEvents = newRole === "operator" || currentRoleType === "operator";
  // The organization picker is the one shown for every role but Operator and Superadmin, a person with no role included.
  const needsOrganizations = (newRole !== "operator" && newRole !== "superadmin") || currentRoleType === "admin";
  const scopeLookupHints = (
    <>
      {needsEvents && events.error && (
        <RetryHint message={events.error} busy={events.retrying} onRetry={events.retry} retryLabel="Retry loading events" />
      )}
      {needsOrganizations && organizations.error && (
        <RetryHint message={organizations.error} busy={organizations.retrying} onRetry={organizations.retry} retryLabel="Retry loading organizations" />
      )}
    </>
  );

  const scopeReady = isRoleScopeReady(newRole, newEventId, newOrgId);
  // A type change is immediate and destructive (see handleChangeRoleType's own comment) -
  // blocked while anything from the same-type Add/Remove flow is still only staged locally, so
  // the two can't tangle: saving afterwards would otherwise try to grant/revoke scopes for a
  // role type that no longer applies.
  const hasPendingRoleChanges = pendingAdds.length > 0 || pendingRemoveIds.size > 0;
  // isSelf && isRoleTypeChange can never both be true - see resolveRoleActionTitle's own
  // comment above. Computed on its own line (rather than inline below) so the whole expression,
  // including its nested `isRoleTypeChange` branch, is covered by a single ignore.
  /* v8 ignore next */
  const selfChangingOwnRoleType = isSelf && isRoleTypeChange;
  const roleActionDisabled =
    roleBusy ||
    submitting ||
    !scopeReady ||
    selfChangingOwnRoleType ||
    (isRoleTypeChange && hasPendingRoleChanges);
  const roleActionLabel = isRoleTypeChange ? "Change" : "Add";
  const roleActionIcon = isRoleTypeChange ? "refresh" : "plus";
  const roleActionTitle = resolveRoleActionTitle(isSelf, isRoleTypeChange, hasPendingRoleChanges);
  const handleRoleActionClick = () => {
    if (isRoleTypeChange) {
      setRoleChangeConfirmOpen(true);
    } else {
      handleAddClick();
    }
  };
  const roleActionButton = (
    <Button
      type="button"
      variant="secondary"
      icon={<i className={`ti ti-${roleActionIcon}`} aria-hidden="true" />}
      disabled={roleActionDisabled}
      title={roleActionTitle}
      onClick={handleRoleActionClick}
    >
      {roleActionLabel}
    </Button>
  );
  // Superadmin already covering everything means there's no scope picker or button to sit
  // beside the Role field - let it take the full row instead of sitting stranded at 10rem.
  const isSoloRole = newRole === "superadmin" && currentRoleType === "superadmin";

  return (
    <>
      <dialog open className="add-attendee-modal" aria-modal="true" aria-labelledby={titleId}>
        {/* No onClose: a superadmin mid-edit shouldn't lose work to a stray click outside the
         * panel, matching the Identity providers modal's own backdrop (identity-modal.css). */}
        <ModalBackdrop />
        <div ref={panelRef} className="add-attendee-modal__panel add-attendee-modal__panel--wide">
        <div ref={scrollRef} className="add-attendee-modal__scroll at-scroll">
          <div className="users-modal__head">
            <div className="users-modal__head-who">
              {/* Default (md, 36px) to match .identity-row-icon's size - the standard other
               * modal headers use for their leading icon (identity-editor__header-title). */}
              <Avatar name={displayTitle} />
              <div className="users-modal__head-text">
                <h2 id={titleId}>{displayTitle}</h2>
                {/* displayTitle already falls back to user.email when there's no display_name -
                 * showing this line too would repeat the exact same string right under itself
                 * (PO report), on top of the Email address field further down the form. */}
                {user.display_name?.trim() && (
                  <span className="users-modal__head-email">{user.email}</span>
                )}
              </div>
            </div>
            <div className="users-modal__head-actions">
              <UserMoreActionsMenu
                moreActions={moreActions}
                disabled={headActionsDisabled || resetPasswordOpen}
                busy={toggleActiveBusy && !disableConfirmOpen}
                user={user}
                isSelf={isSelf}
                onResetMfa={() => setResetMfaOpen(true)}
                onResetPassword={() => setResetPasswordOpen(true)}
                onUnlinkSso={() => setUnlinkSsoOpen(true)}
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
                    <PhoneCountrySelect
                      id="edit-phone-country-code"
                      label="Phone country code"
                      value={phoneCountryCode}
                      disabled={submitting}
                      onChange={setPhoneCountryCode}
                    />
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
              submitting={submitting}
              isSelf={isSelf}
              currentRoleType={currentRoleType}
              isRoleTypeChange={isRoleTypeChange}
              displayTitle={displayTitle}
              scopeChipLabel={scopeChipLabel}
              scopeChipText={scopeChipText}
              scopeNameKnown={scopeNameKnown}
              scopeLookupHints={scopeLookupHints}
              pendingAdds={pendingAdds}
              pendingRemoveIds={pendingRemoveIds}
              onRemoveRole={handleMarkForRemoval}
              onCancelPendingAdd={handleCancelPendingAdd}
              roleOptions={roleOptions}
              isSoloRole={isSoloRole}
              scopePickerControl={scopePickerControl}
              roleActionButton={roleActionButton}
            />

            <SignInSecuritySection
              user={user}
              resetPasswordOpen={resetPasswordOpen}
              recentLogins={recentLogins}
              resetPasswordTitleId={resetPasswordTitleId}
              newPassword={newPassword}
              setNewPassword={setNewPassword}
              requiresActorStepUp={requiresActorStepUp}
              resetPasswordCode={resetPasswordCode}
              setResetPasswordCode={setResetPasswordCode}
              resetPasswordBusy={resetPasswordBusy}
              setResetPasswordBusy={setResetPasswordBusy}
              onCancelResetPassword={() => {
                setResetPasswordOpen(false);
                setNewPassword("");
                setResetPasswordCode("");
              }}
              onResetPassword={handleResetPassword}
              setError={setError}
            />
          </div>

          <div className="add-attendee-modal__actions" style={{ justifyContent: "flex-end" }}>
            <div className="add-attendee-modal__actions-buttons">
              <Button
                type="button"
                variant="primary"
                loading={submitting}
                disabled={otherActionBusy || !isValidEmailFormat(email.trim())}
                onClick={() => void saveProfile()}
              >
                Save changes
              </Button>
            </div>
          </div>
        </div>
        </div>
      </dialog>

      <ConfirmDialog
        open={deleteConfirm}
        title="Delete account"
        message={`Permanently delete ${displayTitle}? This removes their account, sessions, roles, and two-factor authentication. This cannot be undone.`}
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
        errorMessage={confirmError}
        confirmLabel="Disable"
        confirmVariant="danger"
        loading={toggleActiveBusy}
        onConfirm={() => void applyActiveChange(false)}
        onCancel={() => {
          if (toggleActiveBusy) return;
          setDisableConfirmOpen(false);
          setConfirmError(null);
        }}
      />

      <ConfirmDialog
        open={resetMfaOpen}
        title="Reset two-factor"
        message={
          requiresActorStepUp
            ? "This will remove all two-factor methods and revoke all sessions for this user. Resetting another superadmin's two-factor requires your own authenticator or backup code."
            : "This will remove all two-factor methods and revoke all sessions for this user."
        }
        errorMessage={confirmError}
        confirmLabel="Reset"
        confirmVariant="danger"
        loading={resetMfaBusy}
        disableConfirm={requiresActorStepUp && resetMfaCode.trim().length === 0}
        onConfirm={() => void handleResetMfa()}
        onCancel={() => {
          if (resetMfaBusy) return;
          setResetMfaOpen(false);
          setResetMfaCode("");
          setConfirmError(null);
        }}
      >
        {requiresActorStepUp && (
          <div className="mail-field-row">
            <Input
              id="reset-mfa-actor-code"
              name="reset-mfa-actor-code"
              label="Your authenticator or backup code"
              type="text"
              autoCapitalize="off"
              spellCheck={false}
              value={resetMfaCode}
              disabled={resetMfaBusy}
              onChange={(e) => setResetMfaCode(e.target.value)}
              {...NO_AUTOFILL_PROPS}
              autoComplete="one-time-code"
            />
            <WebauthnStepUpButton
              busy={resetMfaBusy}
              onBusyChange={setResetMfaBusy}
              onError={setConfirmError}
              onSubmit={handleResetMfa}
            />
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={revokeSessionsOpen}
        title="Revoke all sessions"
        message={
          requiresActorStepUp
            ? `End all active sessions for ${displayTitle}? Revoking another superadmin's sessions requires your own authenticator or backup code.`
            : `End all active sessions for ${displayTitle}?`
        }
        errorMessage={confirmError}
        confirmLabel="Revoke"
        confirmVariant="danger"
        loading={revokeSessionsBusy}
        disableConfirm={requiresActorStepUp && revokeSessionsCode.trim().length === 0}
        onConfirm={() => void handleRevokeSessions()}
        onCancel={() => {
          if (revokeSessionsBusy) return;
          setRevokeSessionsOpen(false);
          setRevokeSessionsCode("");
          setConfirmError(null);
        }}
      >
        {requiresActorStepUp && (
          <div className="mail-field-row">
            <Input
              id="revoke-sessions-actor-code"
              name="revoke-sessions-actor-code"
              label="Your authenticator or backup code"
              type="text"
              autoCapitalize="off"
              spellCheck={false}
              value={revokeSessionsCode}
              disabled={revokeSessionsBusy}
              onChange={(e) => setRevokeSessionsCode(e.target.value)}
              {...NO_AUTOFILL_PROPS}
              autoComplete="one-time-code"
            />
            <WebauthnStepUpButton
              busy={revokeSessionsBusy}
              onBusyChange={setRevokeSessionsBusy}
              onError={setConfirmError}
              onSubmit={handleRevokeSessions}
            />
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={unlinkSsoOpen}
        title="Unlink identity provider"
        message={`Unlink the identity provider for ${displayTitle}? Set the new local password they'll sign in with below - their identity-provider sign-in stops working immediately, and this also signs them out of every active session and trusted device.`}
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
        errorMessage={confirmError}
        confirmLabel="Change role"
        confirmVariant="danger"
        loading={roleBusy}
        onConfirm={() => void handleChangeRoleType()}
        onCancel={() => {
          if (roleBusy) return;
          setRoleChangeConfirmOpen(false);
          setConfirmError(null);
        }}
      />
    </>
  );
}
