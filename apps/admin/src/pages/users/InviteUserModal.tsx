import { useEffect, useId, useRef, useState } from "react";
import { Button, Switch } from "@admitto/ui";
import { ApiError, createAdminUser, fetchAdminEvents, grantUserRole } from "../../api/client.js";
import type { EventDto, UserListItemDto } from "../../api/types.js";
import { useModalFocusTrap } from "../../components/useModalFocusTrap.js";

type InviteUserModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (user: UserListItemDto) => void;
};

type InitialRole = "" | "superadmin" | "admin" | "operator";

export function InviteUserModal({ open, onClose, onCreated }: InviteUserModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [initialRole, setInitialRole] = useState<InitialRole>("");
  const [eventId, setEventId] = useState("");
  const [events, setEvents] = useState<EventDto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchAdminEvents({ includeArchived: false })
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [open]);

  const resetForm = () => {
    setEmail("");
    setDisplayName("");
    setPassword("");
    setMustChange(true);
    setInitialRole("");
    setEventId("");
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    resetForm();
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  const handleSubmit = async () => {
    if (submitting || !email.trim() || !password || password.length < 8) return;
    if (initialRole === "operator" && !eventId) {
      setError("Select an event for the operator role.");
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

      if (initialRole === "superadmin") {
        await grantUserRole(user.id, { role: "superadmin", scope_type: "instance" });
      } else if (initialRole === "admin") {
        const orgId = events[0]?.organization_id;
        if (!orgId) {
          setError("No organization available for admin role.");
          return;
        }
        await grantUserRole(user.id, { role: "admin", scope_type: "organization", scope_id: orgId });
      } else if (initialRole === "operator" && eventId) {
        await grantUserRole(user.id, { role: "operator", scope_type: "event", scope_id: eventId });
      }

      onCreated(user);
      resetForm();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.message.includes("email_taken")) {
        setError("A user with this email already exists.");
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to invite user.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="users-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="users-modal__backdrop" role="presentation" onClick={handleClose} />
      <div ref={panelRef} className="users-modal__panel">
        <h2 className="users-modal__title" id={titleId}>
          Invite a new team member
        </h2>
        {error && (
          <p className="users-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="users-modal__field">
          <label htmlFor="invite-email">Email address</label>
          <input
            id="invite-email"
            className="users-modal__input"
            type="email"
            value={email}
            required
            disabled={submitting}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="users-modal__field">
          <label htmlFor="invite-name">Display name</label>
          <input
            id="invite-name"
            className="users-modal__input"
            type="text"
            value={displayName}
            disabled={submitting}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="users-modal__field">
          <label htmlFor="invite-role">Initial role</label>
          <select
            id="invite-role"
            className="users-modal__select"
            value={initialRole}
            disabled={submitting}
            onChange={(e) => setInitialRole(e.target.value as InitialRole)}
          >
            <option value="">None</option>
            <option value="superadmin">Superadmin</option>
            <option value="admin">Admin</option>
            <option value="operator">Operator</option>
          </select>
        </div>
        {initialRole === "operator" && (
          <div className="users-modal__field">
            <label htmlFor="invite-event">Event scope</label>
            <select
              id="invite-event"
              className="users-modal__select"
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
            </select>
          </div>
        )}
        <div className="users-modal__field">
          <label htmlFor="invite-password">Temporary password</label>
          <input
            id="invite-password"
            className="users-modal__input"
            type="password"
            minLength={8}
            value={password}
            required
            disabled={submitting}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="users-modal__switch-row">
          <Switch
            label="Require password change on first login"
            checked={mustChange}
            disabled={submitting}
            onChange={(e) => setMustChange(e.target.checked)}
          />
        </div>
        <div className="users-modal__switch-row users-modal__disabled-switch">
          <div>
            <Switch label="Send invite email" checked={false} disabled />
            <span className="form-hint">Coming soon — share the password manually for now.</span>
          </div>
        </div>
        <div className="users-modal__actions">
          <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitting || !email.trim() || password.length < 8}
            onClick={() => void handleSubmit()}
          >
            {submitting ? "Sending…" : "Send invite"}
          </Button>
        </div>
      </div>
    </div>
  );
}
