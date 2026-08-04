import {
  Avatar,
  Badge,
  Button,
  StatusBadge,
} from "@admitto/ui";
import type { UserListItemDto } from "../../api/types.js";
import { roleBadgeVariant, roleLabel } from "../../auth/role-labels.js";
import { formatRelativeTime as formatRelativeTimeShared } from "../../utils/event-dates.js";

const SCOPE_TYPE_LABELS: Record<string, string> = {
  instance: "Instance-wide",
  organization: "Organization scope",
  event: "Event scope",
};

function roleScopeTitle(role: UserListItemDto["roles"][number]): string {
  const scope = SCOPE_TYPE_LABELS[role.scope_type] ?? role.scope_type;
  return role.is_oidc ? `${scope} · managed by identity provider` : scope;
}

/** Thin null handling wrapper ("Never" for a user who hasn't logged in) around the shared
 * canonical implementation in event-dates.ts (previously a full duplicate here). */
function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  return formatRelativeTimeShared(iso);
}

type StaffUserListItemProps = {
  user: UserListItemDto;
  onEdit: (user: UserListItemDto) => void;
  onRevokeSessions: (user: UserListItemDto) => void;
};

function UserRoles({ user }: Readonly<{ user: UserListItemDto }>) {
  if (user.roles.length === 0) return <>-</>;
  return (
    <div className="users-page__roles">
      {user.roles.map((role) => (
        <Badge
          key={role.id}
          variant={roleBadgeVariant(role.role)}
          title={roleScopeTitle(role)}
        >
          {role.is_oidc && <i className="ti ti-cloud" aria-hidden="true" />}{" "}
          {roleLabel(role.role)}
        </Badge>
      ))}
    </div>
  );
}

function UserMfa({ hasMfa }: Readonly<{ hasMfa: boolean }>) {
  return (
    <span className="users-page__mfa">
      {hasMfa ? (
        <>
          <i className="ti ti-shield-check" style={{ color: "var(--status-ok)" }} aria-hidden="true" />{" "}
          TOTP
        </>
      ) : (
        <>
          <i className="ti ti-shield-off" style={{ color: "var(--text-disabled)" }} aria-hidden="true" />{" "}
          None
        </>
      )}
    </span>
  );
}

function UserStatusBadge({ active }: Readonly<{ active: boolean }>) {
  return active ? (
    <StatusBadge status="ok" label="Active" dot />
  ) : (
    <StatusBadge status="neutral" label="Disabled" dot className="users-page__status-disabled" />
  );
}

function UserSessionsBadge({ count }: Readonly<{ count: number }>) {
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

function UserActions({ user, onEdit, onRevokeSessions }: Readonly<StaffUserListItemProps>) {
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
        <span className="sr-only"> profile for {label}</span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="users-page__action-btn"
        onClick={() => onRevokeSessions(user)}
      >
        <i className="ti ti-refresh" aria-hidden="true" />
        <span className="users-page__action-btn-label">Reset sessions</span>
        <span className="sr-only"> for {label}</span>
      </Button>
    </div>
  );
}

/** Desktop table row for a staff user. */
export function StaffUserTableRow({ user, onEdit, onRevokeSessions }: Readonly<StaffUserListItemProps>) {
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
        <UserStatusBadge active={user.is_active} />
      </td>
      <td>
        <UserActions user={user} onEdit={onEdit} onRevokeSessions={onRevokeSessions} />
      </td>
    </tr>
  );
}

/** Mobile card for a staff user. */
export function StaffUserCard({ user, onEdit, onRevokeSessions }: Readonly<StaffUserListItemProps>) {
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
        <UserStatusBadge active={user.is_active} />
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
