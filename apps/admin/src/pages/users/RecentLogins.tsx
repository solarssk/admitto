import { useCallback } from "react";
import { Skeleton } from "@admitto/ui";
import { fetchSecurityAuditLog } from "../../api/client.js";
import type { SecurityAuditLogEntryDto } from "../../api/types.js";
import { GeoCell } from "../../components/GeoCell.js";
import { RetryHint } from "../../components/RetryHint.js";
import { SlowNote } from "../../components/SlowNote.js";
import { useLoadingGate } from "../../hooks/useDelayedLoading.js";
import { useOptionsLoad, type OptionsLoad } from "../../hooks/useOptionsLoad.js";
import { formatRelativeTime } from "../../utils/event-dates.js";
import "../users-page.css";

/** The last three successful sign-ins of a person, read while the dialog is open (see `useOptionsLoad`). */
export function useRecentLogins(open: boolean, userId: string | undefined): OptionsLoad<SecurityAuditLogEntryDto> {
  // Keyed on the id, not the whole user: a role change gives the modal a new user object, which does not change whose
  // logins these are, and reading them again would make the section flash for nothing.
  const load = useCallback(
    async (signal: AbortSignal) => {
      // Not reachable: the lookup is only enabled with an id. It keeps `userId` a string below.
      /* v8 ignore next */
      if (!userId) return [];
      const answer = await fetchSecurityAuditLog({ eventType: "auth.login.success", userId, pageSize: 3 }, signal);
      return answer.entries;
    },
    [userId],
  );
  return useOptionsLoad(load, "Could not load recent logins.", open && Boolean(userId));
}

/**
 * The "Recent logins" list of the edit dialog. While the first request is on its way it holds the place of three rows
 * (invisible for the first 200ms), so the section does not pop in and push what is below it down; when it failed it
 * says so with a Retry, and never claims that there were no recent logins.
 */
export function RecentLogins({ logins }: Readonly<{ logins: OptionsLoad<SecurityAuditLogEntryDto> }>) {
  const gate = useLoadingGate(logins.loading);
  return (
    <div className="users-modal__logins">
      <p className="users-modal__subsection-title" style={{ margin: "0 0 var(--space-1)" }}>
        Recent logins
      </p>
      {!gate.showContent && (
        <output
          aria-label="Loading recent logins"
          className={gate.showIndicator ? "users-modal__logins-skeleton" : "users-modal__logins-skeleton at-loading-hold"}
        >
          {[0, 1, 2].map((row) => (
            <div key={row} className="users-modal__login-skeleton-row">
              <Skeleton variant="rect" height={44} />
            </div>
          ))}
          {logins.slow ? <SlowNote /> : null}
        </output>
      )}
      {gate.showContent && logins.error && (
        <RetryHint message={logins.error} busy={logins.retrying} onRetry={logins.retry} retryLabel="Retry loading recent logins" />
      )}
      {gate.showContent && !logins.error && logins.items.length === 0 && (
        <p className="users-modal__empty-line">
          <i className="ti ti-history" aria-hidden="true" /> No recent logins
        </p>
      )}
      {gate.showContent &&
        !logins.error &&
        logins.items.map((entry) => (
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
  );
}
