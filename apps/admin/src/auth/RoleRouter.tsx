import { useEffect } from "react";
import { Navigate, Outlet } from "react-router";
import { useAuth } from "./AuthProvider.js";
import { canAccessAdminPanel, canAccessCheckInPanel, isSuperadmin } from "./capabilities.js";

function RedirectToLogin() {
  useEffect(() => {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
  }, []);
  return <p>Redirecting to sign in…</p>;
}

export function AdminGuard() {
  const { assignments } = useAuth();
  if (!canAccessAdminPanel(assignments)) {
    if (canAccessCheckInPanel(assignments)) {
      return <Navigate to="/operator" replace />;
    }
    return <RedirectToLogin />;
  }
  return <Outlet />;
}

/** Restricts child routes to users with instance superadmin role assignments. */
export function SuperadminGuard() {
  const { assignments } = useAuth();
  if (!isSuperadmin(assignments)) {
    return <Navigate to="/admin" replace />;
  }
  return <Outlet />;
}

/** Any authenticated staff session — backend requireSession is the source of truth. */
export function AuthenticatedGuard() {
  return <Outlet />;
}

export function OperatorGuard() {
  const { assignments } = useAuth();
  // Admin/superadmin always bounce to /admin, even though canAccessCheckInPanel is also true
  // for them (they can drive check-in from the admin panel's own Check-in tab) - the device
  // kiosk shell at /operator is reserved for accounts that are ONLY operators, so an admin
  // landing here (a stray link, a bookmark, a typed URL) doesn't get dropped into a full-screen
  // surface with no admin nav and have to click their way back out.
  if (canAccessAdminPanel(assignments)) {
    return <Navigate to="/admin" replace />;
  }
  if (!canAccessCheckInPanel(assignments)) {
    return <RedirectToLogin />;
  }
  return <Outlet />;
}
