import { Avatar, Badge, IconButton, Tooltip } from "@admitto/ui";
import type { SessionListDto } from "../../api/types.js";
import { roleBadgeVariant, roleLabel } from "../../auth/role-labels.js";
import { formatRelativeTime, zonedTimeLabel } from "../../utils/event-dates.js";
import { parseUserAgent } from "../../utils/parseUserAgent.js";
import { GeoCell } from "../../components/GeoCell.js";

/** "2026-01-01 12:00:00" - matches the Audit/Security log's own UTC-primary convention. */
function formatPrimaryTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

/** Cached per locale+zone - shared shape with AuditLogPanel's own cache, but this table has no
 * live-poll ticking it every render, so a per-render `new Map()` here would be needless. */
const hourMinuteFormatCache = new Map<string, Intl.DateTimeFormat>();

function hourMinuteFormat(timeZone: string): Intl.DateTimeFormat {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const key = `${locale}\0${timeZone}`;
  let format = hourMinuteFormatCache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    hourMinuteFormatCache.set(key, format);
  }
  return format;
}

/** The instant, converted to whoever is currently viewing the table's own browser timezone -
 * sessions don't capture the device's own timezone the way audit log entries do, so (matching
 * the Audit panel's own Security view, which has the same "no known actor zone" situation) this
 * shows the viewer's zone rather than fabricating the session holder's. */
function viewerLocalTime(iso: string): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hhmm = hourMinuteFormat(timeZone).format(new Date(iso));
  return `${hhmm} ${zonedTimeLabel(iso, timeZone)}`;
}

export const LOGGED_IN_HINT =
  "Top: when this session started, in UTC. Below: the same moment in your own local time.";

function SignIn({ authMethod }: Readonly<{ authMethod: string }>) {
  return authMethod === "oidc" ? (
    <span className="sessions-signin sessions-signin--sso">
      <i className="ti ti-cloud" aria-hidden="true" /> SSO
    </span>
  ) : (
    <span className="sessions-signin sessions-signin--local">
      <i className="ti ti-key" aria-hidden="true" /> Local
    </span>
  );
}

function RevokeAction({ session, onRevoke }: Readonly<{ session: SessionListDto; onRevoke: (s: SessionListDto) => void }>) {
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
        <div className="sessions-subdued">{viewerLocalTime(s.loginAt)}</div>
      </td>
      <td>{formatRelativeTime(s.lastSeenAt)}</td>
      <td className="sessions-col-tablet-hide">
        <SignIn authMethod={s.authMethod} />
      </td>
      <td>
        <div className="sessions-row-actions">
          <IconButton
            icon={<i className="ti ti-pencil" aria-hidden="true" />}
            label={`Edit device label for ${s.userEmail}`}
            size="sm"
            onClick={() => onEdit(s)}
          />
          <RevokeAction session={s} onRevoke={onRevoke} />
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
            <RevokeAction session={s} onRevoke={onRevoke} />
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
            <div className="sessions-subdued">{viewerLocalTime(s.loginAt)}</div>
          </dd>
        </div>
        <div>
          <dt>Last active</dt>
          <dd>{formatRelativeTime(s.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Sign-in</dt>
          <dd>
            <SignIn authMethod={s.authMethod} />
          </dd>
        </div>
      </dl>
    </article>
  );
}
