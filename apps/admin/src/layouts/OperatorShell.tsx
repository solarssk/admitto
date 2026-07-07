import { useEffect, useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { Avatar } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { ConnectionBanner } from "../connection/ConnectionStateProvider.js";
import { fetchCheckInEvents } from "../api/client.js";
import { BrandMark } from "./BrandMark.js";

function OperatorContextBar({ deviceLabel }: { deviceLabel: string | null }) {
  const { eventId } = useParams();
  const [eventTitle, setEventTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) {
      setEventTitle(null);
      return;
    }
    let cancelled = false;
    void fetchCheckInEvents()
      .then((events) => {
        if (cancelled) return;
        setEventTitle(events.find((e) => e.id === eventId)?.title ?? null);
      })
      .catch(() => {
        if (!cancelled) setEventTitle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (!deviceLabel && !eventTitle) return null;

  return (
    <div className="operator-shell__context" aria-live="polite">
      {eventTitle && (
        <span className="operator-shell__context-event">
          Event: <strong>{eventTitle}</strong>
        </span>
      )}
      {deviceLabel && (
        <span className="operator-shell__context-device">
          Device: <strong>{deviceLabel}</strong>
        </span>
      )}
    </div>
  );
}

export function OperatorShell() {
  const { user, deviceLabel } = useAuth();
  const displayName = user.display_name || user.email.split("@")[0] || "Operator";

  return (
    <div className="operator-shell">
      <ConnectionBanner />
      <header className="operator-shell__bar">
        <div className="operator-shell__brand">
          {BrandMark}
          <span>Admitto Check-in</span>
        </div>
        <OperatorContextBar deviceLabel={deviceLabel} />
        <div className="operator-shell__user">
          <Link to="/account" className="operator-shell__user-link">
            <Avatar name={displayName} size="sm" />
            <span>{displayName}</span>
          </Link>
          <form method="post" action="/logout">
            <button
              type="submit"
              className="topbar__signout"
              aria-label="Sign out"
              title="Sign out"
            >
              <i className="ti ti-logout" aria-hidden="true" />
            </button>
          </form>
        </div>
      </header>
      <main className="operator-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
