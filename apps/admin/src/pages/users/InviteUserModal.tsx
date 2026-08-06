import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, ModalBackdrop, Notice, Select, Switch } from "@admitto/ui";
import { PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import {
  ApiError,
  createAdminUser,
  fetchAdminEvents,
  fetchAdminOrganizations,
  grantUserRole,
} from "../../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../../api/operator-api-error.js";
import type { EventDto, UserListItemDto } from "../../api/types.js";
import { useModalFocusTrap } from "../../components/useModalFocusTrap.js";
import { roleLabel } from "../../auth/role-labels.js";
import { NO_AUTOFILL_PROPS } from "../../settings/mailTransportFormParts.js";
import { isValidEmailFormat } from "../../utils/email.js";
import "../../attendees/add-attendee-modal.css";

export type InviteUserCreatedResult = {
  user: UserListItemDto;
  warning?: string;
};

type InviteUserModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (result: InviteUserCreatedResult) => void;
};

type InitialRole = "" | "superadmin" | "admin" | "operator";

function mapRoleGrantError(err: unknown): string {
  return operatorApiErrorMessage(err, "Failed to assign role.");
}

/** Validation checked once the trivial "nothing to submit yet" guard (empty/short fields,
 * already submitting) has passed - each of these needs its own message shown to the operator. */
function inviteFormValidationError(
  email: string,
  initialRole: InitialRole,
  orgId: string,
  eventId: string,
): string | null {
  if (!isValidEmailFormat(email.trim())) return "Enter a valid email address.";
  if (initialRole === "operator" && !eventId) return "Select an event for the operator role.";
  if (initialRole === "admin" && !orgId) return "Select an organization for the admin role.";
  return null;
}

function mapCreateUserError(err: unknown): string {
  if (err instanceof ApiError && (hasApiErrorCode(err, "email_taken") || hasApiErrorCode(err, "email_conflict"))) {
    return "A user with this email already exists.";
  }
  if (err instanceof ApiError && hasApiErrorCode(err, "invalid_request")) {
    return `Check the email address and the temporary password (at least ${PASSWORD_MIN_LENGTH} characters).`;
  }
  return operatorApiErrorMessage(err, "Failed to invite user. Check the email address and password.");
}

export function InviteUserModal({ open, onClose, onCreated }: Readonly<InviteUserModalProps>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [initialRole, setInitialRole] = useState<InitialRole>("");
  const [orgId, setOrgId] = useState("");
  const [eventId, setEventId] = useState("");
  const [events, setEvents] = useState<EventDto[]>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    Promise.all([
      fetchAdminEvents({ includeArchived: false, signal: controller.signal }),
      fetchAdminOrganizations(controller.signal),
    ])
      .then(([eventList, orgList]) => {
        if (controller.signal.aborted) return;
        setEvents(eventList);
        setOrganizations(orgList);
        setOrgId((current) => current || orgList[0]?.id || "");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEvents([]);
          setOrganizations([]);
        }
      });
    return () => controller.abort();
  }, [open]);

  const resetForm = () => {
    setEmail("");
    setDisplayName("");
    setPassword("");
    setMustChange(true);
    setInitialRole("");
    setOrgId("");
    setEventId("");
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    resetForm();
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  const grantInitialRole = async (userId: string) => {
    if (initialRole === "superadmin") {
      await grantUserRole(userId, { role: "superadmin", scope_type: "instance" });
    } else if (initialRole === "admin") {
      if (!orgId) throw new Error("Select an organization for the admin role.");
      await grantUserRole(userId, { role: "admin", scope_type: "organization", scope_id: orgId });
    } else if (initialRole === "operator" && eventId) {
      await grantUserRole(userId, { role: "operator", scope_type: "event", scope_id: eventId });
    }
  };

  const handleSubmit = async () => {
    if (submitting || !email.trim() || !password || password.length < PASSWORD_MIN_LENGTH) return;
    const validationError = inviteFormValidationError(email, initialRole, orgId, eventId);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { user } = await createAdminUser({
        email: email.trim(),
        password,
        display_name: displayName.trim() || null,
        must_change_password: mustChange,
      });
      if (initialRole) {
        try {
          await grantInitialRole(user.id);
        } catch (roleErr) {
          onCreated({
            user,
            warning: `User created, but role assignment failed: ${mapRoleGrantError(roleErr)}`,
          });
          resetForm();
          onClose();
          return;
        }
      }

      onCreated({ user });
      resetForm();
      onClose();
    } catch (err) {
      setError(mapCreateUserError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <dialog className="add-attendee-modal" aria-modal="true" aria-labelledby={titleId} open>
      {/* No onClose: losing a half-typed invite to a stray click outside the panel is worse
       * than requiring Cancel/Escape, matching the Edit user modal's own backdrop. */}
      <ModalBackdrop />
      <div ref={panelRef} className="add-attendee-modal__panel">
        <h2 className="add-attendee-modal__title" id={titleId}>
          <i className="ti ti-user-plus" aria-hidden="true" /> Invite a new team member
        </h2>
        <p className="add-attendee-modal__subtitle">
          Enter their email and a temporary password. Everything else is optional.
        </p>
        {error && (
          <Notice variant="error" role="alert">{error}</Notice>
        )}
        <div className="add-attendee-modal__fields">
          <Input
            id="invite-email"
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
          <Input
            id="invite-name"
            label="Display name"
            icon={<i className="ti ti-user" aria-hidden="true" />}
            type="text"
            value={displayName}
            disabled={submitting}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Select
            id="invite-role"
            label="Initial role"
            value={initialRole}
            disabled={submitting}
            onChange={(e) => setInitialRole(e.target.value as InitialRole)}
          >
            <option value="">None</option>
            <option value="superadmin">{roleLabel("superadmin")}</option>
            <option value="admin">{roleLabel("admin")}</option>
            <option value="operator">{roleLabel("operator")}</option>
          </Select>
          {initialRole === "admin" && (
            <Select
              id="invite-org"
              label="Organization scope"
              value={orgId}
              disabled={submitting || organizations.length === 0}
              onChange={(e) => setOrgId(e.target.value)}
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
            </Select>
          )}
          {initialRole === "operator" && (
            <Select
              id="invite-event"
              label="Event scope"
              value={eventId}
              disabled={submitting}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">Select event…</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </Select>
          )}
          <Input
            id="invite-password"
            label="Temporary password"
            icon={<i className="ti ti-key" aria-hidden="true" />}
            type="password"
            minLength={PASSWORD_MIN_LENGTH}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            value={password}
            required
            disabled={submitting}
            onChange={(e) => setPassword(e.target.value)}
            {...NO_AUTOFILL_PROPS}
          />
          <Switch
            label="Require password change on first login"
            checked={mustChange}
            disabled={submitting}
            onChange={(e) => setMustChange(e.target.checked)}
          />
        </div>
        <div className="add-attendee-modal__actions" style={{ justifyContent: "flex-end" }}>
          <div className="add-attendee-modal__actions-buttons">
            <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={
                submitting ||
                !isValidEmailFormat(email.trim()) ||
                password.length < PASSWORD_MIN_LENGTH
              }
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
