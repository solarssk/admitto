import {
  Avatar,
  Badge,
  Button,
  StatusBadge,
  type BadgeProps,
} from "@admitto/ui";
import type { UserListItemDto } from "../../api/types.js";

function roleBadgeVariant(role: string): BadgeProps["variant"] {
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

type StaffUserListItemProps = {
  user: UserListItemDto;
  onEdit: (user: UserListItemDto) => void;
  onRevokeSessions: (user: UserListItemDto) => void;
};

function UserRoles({ user }: { user: UserListItemDto }) {
  if (user.roles.length === 0) return <>—</>;
  return (
    <div className="users-page__roles">
      {user.roles.map((role) => (
        <Badge
          key={role.id}
          variant={roleBadgeVariant(role.role)}
          title={role.is_oidc ? "Managed by identity provider" : undefined}
        >
          {role.is_oidc && <i className="ti ti-cloud" aria-hidden="true" />}{" "}
          {roleShort(role.role)}
        </Badge>
      ))}
    </div>
  );
}

function UserMfa({ hasMfa }: { hasMfa: boolean }) {
  return (
    <span className="users-page__mfa">
      {hasMfa ? (
        <>
          <i className="ti ti-shield-check" style={{ color: "var(--status-ok)" }} aria-hidden="true" />
          TOTP
        </>
      ) : (
        <>
          <i className="ti ti-shield-off" style={{ color: "var(--text-disabled)" }} aria-hidden="true" />
          None
        </>
      )}
    </span>
  );
}

function UserSessionsBadge({ count }: { count: number }) {
  return (
    <span
      className={`users-page__sessions-badge ${
        count > 0 ? "users-page__sessions-badge--active" : "users-page__sessions-badge--empty"
      }`}
    >
      {count}
    </span>
  );
}

function UserActions({ user, onEdit, onRevokeSessions }: StaffUserListItemProps) {
  const label = user.display_name?.trim() || user.email;
  return (
    <div className="users-page__actions">
      <Button
        type="button"
        variant="secondary"
        className="users-page__action-btn"
        onClick={() => onEdit(user)}
      >
        <i className="ti ti-pencil" aria-hidden="true" />
        <span>Edit</span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="users-page__action-btn"
        onClick={() => onRevokeSessions(user)}
      >
        <i className="ti ti-arrows-clockwise" aria-hidden="true" />
        <span className="users-page__action-btn-label">Reset sessions</span>
        <span className="sr-only"> for {label}</span>
      </Button>
    </div>
  );
}

/** Desktop table row for a staff user. */
export function StaffUserTableRow({ user, onEdit, onRevokeSessions }: StaffUserListItemProps) {
  return (
    <tr>
      <td>
        <div className="users-page__user-cell">
          <Avatar name={user.display_name ?? user.email} size="sm" />
          <div className="users-page__user-meta">
            <div className="users-page__user-name">{user.display_name ?? user.email}</div>
            <div className="users-page__user-email">{user.email}</div>
          </div>
        </div>
      </td>
      <td>
        <UserRoles user={user} />
      </td>
      <td>
        <UserMfa hasMfa={user.has_mfa} />
      </td>
      <td>{formatRelativeTime(user.last_login_at)}</td>
      <td>
        <UserSessionsBadge count={user.active_sessions_count} />
      </td>
      <td>
        {user.is_active ? (
          <StatusBadge status="ok" label="Active" />
        ) : (
          <StatusBadge status="neutral" label="Disabled" />
        )}
      </td>
      <td>
        <UserActions user={user} onEdit={onEdit} onRevokeSessions={onRevokeSessions} />
      </td>
    </tr>
  );
}

/** Mobile card for a staff user. */
export function StaffUserCard({ user, onEdit, onRevokeSessions }: StaffUserListItemProps) {
  return (
    <article className="users-page__card">
      <div className="users-page__card-head">
        <div className="users-page__user-cell">
          <Avatar name={user.display_name ?? user.email} size="sm" />
          <div className="users-page__user-meta">
            <div className="users-page__user-name">{user.display_name ?? user.email}</div>
            <div className="users-page__user-email">{user.email}</div>
          </div>
        </div>
        {user.is_active ? (
          <StatusBadge status="ok" label="Active" />
        ) : (
          <StatusBadge status="neutral" label="Disabled" />
        )}
      </div>
      <dl className="users-page__card-meta">
        <div>
          <dt>Roles</dt>
          <dd>
            <UserRoles user={user} />
          </dd>
        </div>
        <div>
          <dt>MFA</dt>
          <dd>
            <UserMfa hasMfa={user.has_mfa} />
          </dd>
        </div>
        <div>
          <dt>Last login</dt>
          <dd>{formatRelativeTime(user.last_login_at)}</dd>
        </div>
        <div>
          <dt>Sessions</dt>
          <dd>
            <UserSessionsBadge count={user.active_sessions_count} />
          </dd>
        </div>
      </dl>
      <UserActions user={user} onEdit={onEdit} onRevokeSessions={onRevokeSessions} />
    </article>
  );
}
