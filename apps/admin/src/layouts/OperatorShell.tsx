import { Outlet } from "react-router-dom";
import { Avatar } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { ConnectionBanner } from "../connection/ConnectionStateProvider.js";

export function OperatorShell() {
  const { user } = useAuth();
  const displayName = user.display_name || user.email.split("@")[0] || "Operator";

  return (
    <div className="operator-shell">
      <ConnectionBanner />
      <header className="operator-topbar">
        <div className="operator-topbar__brand">
          <span className="sidebar__brand-mark" aria-hidden="true" />
          <span>Admitto Check-in</span>
        </div>
        <div className="operator-topbar__user">
          <Avatar name={displayName} size="sm" />
          <span>{displayName}</span>
          <form method="post" action="/logout">
            <button type="submit" className="topbar__signout">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="operator-content">
        <Outlet />
      </main>
    </div>
  );
}
