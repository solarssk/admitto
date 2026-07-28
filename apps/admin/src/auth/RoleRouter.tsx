import { useEffect } from "react";
import { Navigate, Outlet } from "react-router";
import { useAuth } from "./AuthProvider.js";
import {
  canAccessAdminPanel,
  canAccessCheckInPanel,
  hasEventOperatorAssignment,
  isSuperadmin,
} from "./capabilities.js";

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
  // Admin/superadmin normally bounce to /admin because they can use its Check-in tab. Do not
  // do that for a mixed-scope user with an explicit event-operator assignment: their admin
  // event picker cannot list an event belonging to another organization, while /operator can.
  if (canAccessAdminPanel(assignments) && !hasEventOperatorAssignment(assignments)) {
    return <Navigate to="/admin" replace />;
  }
  if (!canAccessCheckInPanel(assignments)) {
    return <RedirectToLogin />;
  }
  return <Outlet />;
}
