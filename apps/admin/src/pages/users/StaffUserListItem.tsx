import {
  Avatar,
  Badge,
  Button,
  IconButton,
  Tooltip,
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

/** Roles are exclusive by type (#401) - every entry in user.roles shares the same `role`, just
 * with different scopes, so one badge for the type is enough here. Per-scope detail (which
 * events/orgs, OIDC-managed or not) lives on the Role assignments tab, not this summary table. */
function UserRoles({ user }: Readonly<{ user: UserListItemDto }>) {
  const [primary] = user.roles;
  if (!primary) return <>-</>;
  return (
    <div className="users-page__roles">
      <Badge variant={roleBadgeVariant(primary.role)} title={roleScopeTitle(primary)}>
        {user.roles.some((role) => role.is_oidc) && (
          <>
            <i className="ti ti-cloud" aria-hidden="true" />
            <span className="sr-only">Managed by identity provider</span>
          </>
        )}{" "}
        {roleLabel(primary.role)}
      </Badge>
    </div>
  );
}

function UserAuthMethod({ hasSso }: Readonly<{ hasSso: boolean }>) {
  return hasSso ? (
    <span className="users-page__auth">
      <i className="ti ti-cloud-lock" aria-hidden="true" /> SSO
    </span>
  ) : (
    <span className="users-page__auth">
      <i className="ti ti-key" aria-hidden="true" /> Local
    </span>
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

// Badge (not StatusBadge): "ok"/"neutral" here are literal BadgeVariant names, not domain
// status keys - resolveStatusMeta only knows entries like "sent"/"admitted", so status="ok"
// missed the lookup and silently fell back to the neutral variant, rendering Active gray.
function UserStatusBadge({ active }: Readonly<{ active: boolean }>) {
  return active ? (
    <Badge variant="ok">Active</Badge>
  ) : (
    <Badge variant="neutral" className="users-page__status-disabled">
      Disabled
    </Badge>
  );
}

function UserSessionsBadge({ count }: Readonly<{ count: number }>) {
  return count > 0 ? (
    <Badge variant="info">{count}</Badge>
  ) : (
    <span style={{ color: "var(--text-disabled)" }}>—</span>
  );
}

/** Compact icon-only actions for the desktop table row - a bare icon (especially the reset/
 * refresh glyph, easy to mistake for "revoke all sessions") doesn't self-explain, so each gets
 * the app's standard hover/focus Tooltip in addition to its aria-label. */
function UserActionsRow({ user, onEdit, onRevokeSessions }: Readonly<StaffUserListItemProps>) {
  const label = user.display_name?.trim() || user.email;
  return (
    <div className="users-page__actions">
      <Tooltip content="Edit profile">
        <IconButton
          icon={<i className="ti ti-pencil" aria-hidden="true" />}
          label={`Edit profile for ${label}`}
          size="sm"
          onClick={() => onEdit(user)}
        />
      </Tooltip>
      <Tooltip content="Reset sessions">
        <IconButton
          icon={<i className="ti ti-refresh" aria-hidden="true" />}
          label={`Reset sessions for ${label}`}
          size="sm"
          className="users-page__icon-danger"
          onClick={() => onRevokeSessions(user)}
        />
      </Tooltip>
    </div>
  );
}

/** Full-width labeled actions for the mobile card - touch targets stay easy to hit and legible
 * without a table row's horizontal space constraints. */
function UserActionsCard({ user, onEdit, onRevokeSessions }: Readonly<StaffUserListItemProps>) {
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
        className="users-page__action-btn users-page__icon-danger"
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
        <UserAuthMethod hasSso={user.has_sso} />
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
        <UserActionsRow user={user} onEdit={onEdit} onRevokeSessions={onRevokeSessions} />
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
          <dt>Sign-in</dt>
          <dd>
            <UserAuthMethod hasSso={user.has_sso} />
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
      <UserActionsCard user={user} onEdit={onEdit} onRevokeSessions={onRevokeSessions} />
    </article>
  );
}
