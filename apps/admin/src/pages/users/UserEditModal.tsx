import { useEffect, useId, useRef, useState } from "react";
import { Avatar, Button, IconButton, Input, ModalBackdrop, Notice } from "@admitto/ui";
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
import type { EventDto, RoleAssignmentDto, SecurityAuditLogEntryDto, UserListItemDto } from "../../api/types.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { GeoCell } from "../../components/GeoCell.js";
import { MoreActionsMenuItem } from "../../components/MoreActionsMenuItem.js";
import { PhoneCountrySelect } from "../../components/PhoneCountrySelect.js";
import { SearchableSelect } from "../../components/SearchableSelect.js";
import { useDropdownMenu } from "../../components/useDropdownMenu.js";
import { useModalFocusTrap } from "../../components/useModalFocusTrap.js";
import { roleLabel } from "../../auth/role-labels.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { useOverscrollBounceGuard } from "../../hooks/useOverscrollBounceGuard.js";
import { formatRelativeTime } from "../../utils/event-dates.js";
import { isValidEmailFormat } from "../../utils/email.js";
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

export function UserEditModal({ open, user, onClose, onUpdated, onDeleted }: Readonly<UserEditModalProps>) {
  const { user: currentUser } = useAuth();
  const titleId = useId();
  const resetPasswordTitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef);
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
  const [pendingAdds, setPendingAdds] = useState<PendingRoleAdd[]>([]);
  const [pendingRemoveIds, setPendingRemoveIds] = useState<ReadonlySet<string>>(new Set());
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
  }, [user]);

  useEffect(() => {
    if (open) return;
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

  const userEmail = user?.email;
  useEffect(() => {
    // Keyed on email, not the whole user object: a role/scope add refreshes user with a new
    // object reference (so the chip list re-syncs, see the effect above), which doesn't change
    // who we're querying logins for - re-running this fetch anyway made the section
    // unmount/remount (a visible flash) on every single role change for no reason.
    if (!open || !userEmail) return;
    setRecentLoginsLoaded(false);
    const controller = new AbortController();
    fetchSecurityAuditLog(
      { eventType: "auth.login.success", search: userEmail, pageSize: 3 },
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
  }, [open, userEmail]);

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

  // Profile fields and staged Role & access edits (pendingAdds/pendingRemoveIds) all commit
  // together here, in one click - previously, Add/Remove each called the API immediately, which
  // refreshed the Staff users list behind this modal on every single click (visible as a
  // flicker) instead of once, on a deliberate save (PO review). Removes run before adds so
  // clearing a scope and re-adding it in the same sitting nets out correctly. Each item is
  // dropped from its pending list only once its own request succeeds, so a failure partway
  // through (e.g. the email PATCH rejected, or a scope deleted by someone else mid-edit) leaves
  // just the unfinished remainder staged for a retry instead of resubmitting everything.
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

      for (const assignmentId of pendingRemoveIds) {
        await revokeUserRole(user.id, assignmentId);
        setPendingRemoveIds((prev) => {
          const next = new Set(prev);
          next.delete(assignmentId);
          return next;
        });
      }
      for (const add of pendingAdds) {
        await grantUserRole(user.id, {
          role: add.role,
          scope_type: add.scopeType,
          scope_id: add.scopeId,
        });
        setPendingAdds((prev) => prev.filter((p) => p.key !== add.key));
      }

      onUpdated(updated, "Changes saved");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && (hasApiErrorCode(err, "email_taken") || hasApiErrorCode(err, "email_conflict"))) {
        setError("A user with this email already exists.");
      } else if (err instanceof ApiError && hasApiErrorCode(err, "cannot_change_own_role")) {
        setError("You cannot change your own role. Ask another superadmin.");
      } else {
        setError(operatorApiErrorMessage(err, "Failed to save changes."));
      }
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
      onUpdated(user, "Role updated");
      setRoleChangeConfirmOpen(false);
      setNewEventId("");
      setNewOrgId("");
    } catch (err) {
      if (err instanceof ApiError && hasApiErrorCode(err, "cannot_change_own_role")) {
        setError("You cannot change your own role. Ask another superadmin.");
      } else {
        setError(operatorApiErrorMessage(err, "Failed to assign role."));
      }
    } finally {
      setRoleBusy(false);
    }
  };

  /** Stages a same-type scope grant locally (Role & access "Add") - committed only by
   * saveProfile, on "Save changes". No confirm needed: unlike a type change, this can't destroy
   * anything, and it can still be undone for free by removing the chip before saving. */
  const handleAddClick = () => {
    if (!newRole) return;
    setError(null);
    if (newRole === "superadmin") {
      setPendingAdds((prev) => [
        ...prev,
        { key: crypto.randomUUID(), role: "superadmin", scopeType: "instance", scopeId: null, label: "Instance-wide", icon: "crown" },
      ]);
    } else if (newRole === "admin") {
      if (!newOrgId) {
        setError("Select an organization for the admin role.");
        return;
      }
      const org = organizations.find((o) => o.id === newOrgId);
      setPendingAdds((prev) => [
        ...prev,
        { key: crypto.randomUUID(), role: "admin", scopeType: "organization", scopeId: newOrgId, label: org?.name ?? newOrgId, icon: "building" },
      ]);
    } else if (newRole === "operator") {
      if (!newEventId) {
        setError("Select an event for the operator role.");
        return;
      }
      const ev = events.find((e) => e.id === newEventId);
      setPendingAdds((prev) => [
        ...prev,
        { key: crypto.randomUUID(), role: "operator", scopeType: "event", scopeId: newEventId, label: ev?.title ?? newEventId, icon: "calendar-event" },
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

  const handleResetMfa = async () => {
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
      if (err instanceof ApiError && hasApiErrorCode(err, "invalid_request")) {
        setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      } else {
        setError(operatorApiErrorMessage(err, "Failed to reset password."));
      }
    } finally {
      setResetPasswordBusy(false);
    }
  };

  const handleRevokeSessions = async () => {
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
      if (err instanceof ApiError && hasApiErrorCode(err, "invalid_request")) {
        setUnlinkSsoError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      } else {
        setUnlinkSsoError(operatorApiErrorMessage(err, "Failed to unlink SSO."));
      }
    } finally {
      setUnlinkSsoBusy(false);
    }
  };

  const applyActiveChange = async (nextActive: boolean) => {
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

  /** Resolves a role assignment's raw scope_id to the human label shown elsewhere in the admin
   * (event title / organization name) - this modal already fetches both lists for the "assign
   * role" controls below, so no extra request is needed. Falls back to the id when the scope
   * isn't in the fetched list (e.g. a since-deleted event). */
  function scopeChipLabel(assignment: RoleAssignmentDto): string {
    if (assignment.scope_type === "instance") return "Instance-wide";
    if (assignment.scope_type === "event") {
      return events.find((e) => e.id === assignment.scope_id)?.title ?? assignment.scope_id ?? "Unknown event";
    }
    if (assignment.scope_type === "organization") {
      return organizations.find((o) => o.id === assignment.scope_id)?.name ?? assignment.scope_id ?? "Unknown organization";
    }
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
  const pickableEvents = events.filter((e) => !assignedEventIds.has(e.id) && !pendingEventIds.has(e.id));
  const pickableOrganizations = organizations.filter(
    (org) => !assignedOrgIds.has(org.id) && !pendingOrgIds.has(org.id),
  );

  const roleOptions = [
    { id: "superadmin", label: roleLabel("superadmin"), icon: "crown" },
    { id: "admin", label: roleLabel("admin"), icon: "building" },
    { id: "operator", label: roleLabel("operator"), icon: "calendar-event" },
  ];

  const scopePickerControl =
    newRole === "operator" ? (
      <SearchableSelect
        id="edit-user-event-scope"
        label="Event scope for operator role"
        placeholder="Select event…"
        searchPlaceholder="Search events…"
        emptyLabel="No events found"
        value={newEventId}
        options={pickableEvents.map((e) => ({ id: e.id, label: e.title, icon: "calendar-event" }))}
        disabled={roleBusy}
        onChange={setNewEventId}
      />
    ) : (
      <SearchableSelect
        id="edit-user-org-scope"
        label="Organization scope for admin role"
        placeholder={pickableOrganizations.length === 0 ? "No organizations available" : "Select organization…"}
        searchPlaceholder="Search organizations…"
        emptyLabel="No organizations found"
        value={newOrgId}
        options={pickableOrganizations.map((org) => ({ id: org.id, label: org.name, icon: "building" }))}
        disabled={roleBusy || pickableOrganizations.length === 0}
        onChange={setNewOrgId}
      />
    );

  const scopeReady =
    newRole === "operator" ? !!newEventId : newRole === "admin" ? !!newOrgId : newRole === "superadmin";
  // A type change is immediate and destructive (see handleChangeRoleType's own comment) -
  // blocked while anything from the same-type Add/Remove flow is still only staged locally, so
  // the two can't tangle: saving afterwards would otherwise try to grant/revoke scopes for a
  // role type that no longer applies.
  const hasPendingRoleChanges = pendingAdds.length > 0 || pendingRemoveIds.size > 0;
  const roleActionDisabled =
    roleBusy || !scopeReady || (isSelf && isRoleTypeChange) || (isRoleTypeChange && hasPendingRoleChanges);
  const roleActionLabel = isRoleTypeChange ? "Change" : "Add";
  const roleActionIcon = isRoleTypeChange ? "refresh" : "plus";
  const roleActionTitle =
    isSelf && isRoleTypeChange
      ? "You cannot change your own role."
      : isRoleTypeChange && hasPendingRoleChanges
        ? "Save or discard your pending scope changes first."
        : undefined;
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
        <div ref={scrollRef} className="add-attendee-modal__scroll">
          <div className="users-modal__head">
            <div className="users-modal__head-who">
              <Avatar name={displayTitle} size="sm" />
              <div className="users-modal__head-text">
                <h2 id={titleId}>{displayTitle}</h2>
                <span className="users-modal__head-email">{user.email}</span>
              </div>
            </div>
            <div className="users-modal__head-actions">
              <div className="more-actions-menu" ref={moreActions.rootRef}>
                <Button
                  ref={moreActions.triggerRef}
                  type="button"
                  variant="ghost"
                  className="users-modal__more-btn"
                  aria-label="More actions"
                  disabled={headActionsDisabled || resetPasswordOpen}
                  aria-haspopup="menu"
                  aria-expanded={moreActions.open}
                  onClick={() => moreActions.setOpen((o) => !o)}
                  icon={<i className="ti ti-dots-vertical" aria-hidden="true" />}
                />
                {moreActions.open && (
                  <div
                    className={`more-actions-menu__panel${moreActions.openUpward ? " more-actions-menu__panel--up" : ""}`}
                    role="menu"
                    ref={moreActions.panelRef}
                  >
                    <MoreActionsMenuItem
                      icon="refresh"
                      label="Reset MFA"
                      hint="Clear two-factor authentication"
                      onClick={() => {
                        moreActions.setOpen(false);
                        setResetMfaOpen(true);
                      }}
                    />
                    <MoreActionsMenuItem
                      icon="key"
                      label="Reset password"
                      hint="Set a new temporary password"
                      onClick={() => {
                        moreActions.setOpen(false);
                        setResetPasswordOpen(true);
                      }}
                    />
                    <MoreActionsMenuItem
                      icon="unlink"
                      label="Unlink SSO"
                      hint="Require a local password to sign in"
                      disabled={!user.has_sso || isSelf}
                      tooltip={
                        !user.has_sso
                          ? "This account doesn't use SSO."
                          : isSelf
                            ? "You cannot unlink SSO from your own account."
                            : undefined
                      }
                      onClick={() => {
                        moreActions.setOpen(false);
                        setUnlinkSsoOpen(true);
                      }}
                    />
                    <MoreActionsMenuItem
                      icon="logout"
                      label="Revoke sessions"
                      hint="Sign out of every active session"
                      disabled={user.active_sessions_count === 0}
                      onClick={() => {
                        moreActions.setOpen(false);
                        setRevokeSessionsOpen(true);
                      }}
                    />
                    <MoreActionsMenuItem
                      icon={user.is_active ? "ban" : "circle-check"}
                      variant={user.is_active ? "danger" : undefined}
                      label={user.is_active ? "Disable account" : "Enable account"}
                      hint={user.is_active ? "Block sign-in for this account" : "Allow sign-in again"}
                      disabled={user.is_active && isSelf}
                      tooltip={user.is_active && isSelf ? "You cannot disable your own account." : undefined}
                      onClick={() => {
                        moreActions.setOpen(false);
                        handleToggleActiveClick();
                      }}
                    />
                    <hr className="more-actions-menu__divider" />
                    <MoreActionsMenuItem
                      icon="trash"
                      variant="danger"
                      label="Delete account"
                      hint="Permanently remove this account"
                      disabled={isSelf}
                      tooltip={isSelf ? "You cannot delete your own account." : undefined}
                      onClick={() => {
                        moreActions.setOpen(false);
                        setDeleteConfirm(true);
                      }}
                    />
                  </div>
                )}
              </div>
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

            <section className="users-modal__section">
              <h3 className="users-modal__section-title">Role & access</h3>
              <div
                className={`users-modal__role-assign${isSoloRole ? " users-modal__role-assign--solo" : ""}`}
              >
                <SearchableSelect
                  id="edit-user-assign-role"
                  label="Role"
                  placeholder="No role assigned"
                  searchPlaceholder="Search roles…"
                  emptyLabel="No roles found"
                  value={newRole}
                  options={roleOptions}
                  disabled={roleBusy || isSelf}
                  title={isSelf ? "You cannot change your own role." : undefined}
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
                          {scopeChipLabel(assignment)}
                          {!assignment.is_oidc && (
                            <button
                              type="button"
                              className="users-modal__chip-remove"
                              disabled={isSelf}
                              title={isSelf ? "You cannot remove your own role assignment." : undefined}
                              onClick={() => handleMarkForRemoval(assignment.id)}
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
                          onClick={() => handleCancelPendingAdd(add.key)}
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
                  Changing to {roleLabel(newRole)} removes {isSelf ? "your" : `${displayTitle}'s`} current{" "}
                  {roleLabel(currentRoleType)} access.
                </Notice>
              )}

              {newRole === "superadmin" && currentRoleType === "superadmin" && (
                <Notice variant="info">
                  Superadmin already covers every event and organization in this instance, so there are no scopes to add.
                </Notice>
              )}
            </section>

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
                    <span>
                      {user.active_sessions_count > 0
                        ? `${user.active_sessions_count} session${user.active_sessions_count === 1 ? "" : "s"}`
                        : "None"}
                    </span>
                  </span>
                </div>
              </div>

              {!resetPasswordOpen ? (
                <>
                  {recentLoginsLoaded && (
                    <div className="users-modal__logins">
                      <p className="users-modal__subsection-title" style={{ margin: "0 0 var(--space-1)" }}>
                        Recent logins
                      </p>
                      {recentLogins.length === 0 && (
                        <p className="users-modal__empty-line">
                          <i className="ti ti-history" aria-hidden="true" />
                          No recent logins
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
                  )}
                </>
              ) : (
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
            </section>
          </div>

          <div className="add-attendee-modal__actions" style={{ justifyContent: "flex-end" }}>
            <div className="add-attendee-modal__actions-buttons">
              <Button
                type="button"
                variant="primary"
                disabled={submitting || !isValidEmailFormat(email.trim())}
                onClick={() => void saveProfile()}
              >
                {submitting ? "Saving changes…" : "Save changes"}
              </Button>
            </div>
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
        onConfirm={() => void handleChangeRoleType()}
        onCancel={() => {
          if (!roleBusy) setRoleChangeConfirmOpen(false);
        }}
      />
    </>
  );
}
