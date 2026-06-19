import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
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

export function OperatorGuard() {
  const { assignments } = useAuth();
  if (!canAccessCheckInPanel(assignments)) {
    if (canAccessAdminPanel(assignments)) {
      return <Navigate to="/admin" replace />;
    }
    return <RedirectToLogin />;
  }
  return <Outlet />;
}
