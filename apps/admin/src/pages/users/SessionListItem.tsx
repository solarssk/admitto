import type { ReactNode } from "react";
import { Avatar, Badge, IconButton, Tooltip } from "@admitto/ui";
import type { SessionListDto } from "../../api/types.js";
import { roleBadgeVariant, roleLabel } from "../../auth/role-labels.js";
import { formatRelativeTime, formatZonedClockTime, viewerLocalTime } from "../../utils/event-dates.js";
import { parseUserAgent } from "../../utils/parseUserAgent.js";
import { GeoCell } from "../../components/GeoCell.js";

/** "2026-01-01 12:00:00" - matches the Audit/Security log's own UTC-primary convention. */
function formatPrimaryTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

export const LOGGED_IN_HINT =
  "UTC on top. Below (user icon): the signer's local time at login. Missing for older sessions - then your browser timezone (desktop icon).";

/** Secondary line under Logged in: actor zone when known, otherwise the viewer's browser zone. */
function SessionLocalTimeLine({ session }: Readonly<{ session: SessionListDto }>): ReactNode {
  if (session.timezone) {
    return (
      <div className="sessions-subdued audit-log-time__local">
        <i className="ti ti-user" aria-hidden="true" title="Signer's local time" />
        <span className="sr-only">Signer's local time: </span>
        {formatZonedClockTime(session.loginAt, session.timezone)}
      </div>
    );
  }
  return (
    <div className="sessions-subdued audit-log-time__local">
      <i className="ti ti-device-desktop" aria-hidden="true" title="Your local time" />
      <span className="sr-only">Your local time: </span>
      {viewerLocalTime(session.loginAt)}
    </div>
  );
}

export function SessionSignIn({ authMethod }: Readonly<{ authMethod: string }>) {
  return authMethod === "oidc" ? (
    <span className="sessions-signin sessions-signin--sso">
      <i className="ti ti-cloud" aria-hidden="true" /> Identity provider
    </span>
  ) : (
    <span className="sessions-signin sessions-signin--local">
      <i className="ti ti-key" aria-hidden="true" /> Local password
    </span>
  );
}

export function SessionRevokeAction({ session, onRevoke }: Readonly<{ session: SessionListDto; onRevoke: (s: SessionListDto) => void }>) {
  const button = (
    <IconButton
      icon={<i className="ti ti-logout" aria-hidden="true" />}
      label={`Revoke session for ${session.userEmail}`}
      size="sm"
      className="sessions-row-actions__revoke"
      disabled={session.isCurrent}
      onClick={session.isCurrent ? undefined : () => onRevoke(session)}
    />
  );
  return session.isCurrent ? (
    <Tooltip content="You cannot revoke your own session">{button}</Tooltip>
  ) : (
    button
  );
}

type SessionRowProps = {
  session: SessionListDto;
  onEdit: (session: SessionListDto) => void;
  onRevoke: (session: SessionListDto) => void;
};

/** Desktop table row for one session. */
export function SessionTableRow({ session: s, onEdit, onRevoke }: Readonly<SessionRowProps>) {
  return (
    <tr>
      <td>
        <div className="users-page__user-cell">
          <Avatar name={s.userDisplayName ?? s.userEmail} size="sm" />
          <div className="users-page__user-meta">
            <div className="users-page__user-name">{s.userDisplayName ?? s.userEmail}</div>
            {s.userDisplayName && <div className="users-page__user-email">{s.userEmail}</div>}
          </div>
        </div>
      </td>
      <td>
        <Badge variant={roleBadgeVariant(s.role)}>{roleLabel(s.role)}</Badge>
      </td>
      <td className="sessions-col-tablet-hide" title={s.userAgent ?? undefined}>
        {s.deviceLabel ? s.deviceLabel : parseUserAgent(s.userAgent)}
      </td>
      <td className="sessions-col-tablet-hide">
        {s.ip ?? "-"}
        {s.ip && <div className="sessions-subdued"><GeoCell location={s.country} /></div>}
      </td>
      <td>
        {formatPrimaryTime(s.loginAt)} UTC
        <SessionLocalTimeLine session={s} />
      </td>
      <td>{formatRelativeTime(s.lastSeenAt)}</td>
      <td className="sessions-col-tablet-hide">
        <SessionSignIn authMethod={s.authMethod} />
      </td>
      <td>
        <div className="sessions-row-actions">
          <IconButton
            icon={<i className="ti ti-pencil" aria-hidden="true" />}
            label={`Edit device label for ${s.userEmail}`}
            size="sm"
            onClick={() => onEdit(s)}
          />
          <SessionRevokeAction session={s} onRevoke={onRevoke} />
        </div>
      </td>
    </tr>
  );
}

/** Mobile/tablet stacked card for one session - same fields as the desktop table, laid out as a
 * card so the row never needs horizontal scrolling below the 768px breakpoint. */
export function SessionCard({ session: s, onEdit, onRevoke }: Readonly<SessionRowProps>) {
  return (
    <article className="users-page__card">
      <div className="users-page__card-head">
        <div className="users-page__user-cell">
          <Avatar name={s.userDisplayName ?? s.userEmail} size="sm" />
          <div className="users-page__user-meta">
            <div className="users-page__user-name">{s.userDisplayName ?? s.userEmail}</div>
            {s.userDisplayName && <div className="users-page__user-email">{s.userEmail}</div>}
          </div>
        </div>
        <div className="sessions-card-head-end">
          <Badge variant={roleBadgeVariant(s.role)}>{roleLabel(s.role)}</Badge>
          <div className="sessions-card-icon-actions">
            <IconButton
              icon={<i className="ti ti-pencil" aria-hidden="true" />}
              label={`Edit device label for ${s.userEmail}`}
              size="sm"
              onClick={() => onEdit(s)}
            />
            <SessionRevokeAction session={s} onRevoke={onRevoke} />
          </div>
        </div>
      </div>
      <dl className="users-page__card-meta">
        <div>
          <dt>Device</dt>
          <dd title={s.userAgent ?? undefined}>{s.deviceLabel ? s.deviceLabel : parseUserAgent(s.userAgent)}</dd>
        </div>
        <div>
          <dt>IP address</dt>
          <dd>
            {s.ip ?? "-"}
            {s.ip && <div className="sessions-subdued"><GeoCell location={s.country} /></div>}
          </dd>
        </div>
        <div>
          <dt>Logged in</dt>
          <dd>
            {formatPrimaryTime(s.loginAt)} UTC
            <SessionLocalTimeLine session={s} />
          </dd>
        </div>
        <div>
          <dt>Last active</dt>
          <dd>{formatRelativeTime(s.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Sign-in</dt>
          <dd>
            <SessionSignIn authMethod={s.authMethod} />
          </dd>
        </div>
      </dl>
    </article>
  );
}
