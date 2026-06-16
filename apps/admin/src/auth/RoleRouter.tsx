import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider.js";
import { canAccessAdminPanel, canAccessCheckInPanel } from "./capabilities.js";

export function AdminGuard() {
  const { assignments } = useAuth();
  if (!canAccessAdminPanel(assignments)) {
    if (canAccessCheckInPanel(assignments)) {
      return <Navigate to="/operator" replace />;
    }
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export function OperatorGuard() {
  const { assignments } = useAuth();
  if (!canAccessCheckInPanel(assignments)) {
    if (canAccessAdminPanel(assignments)) {
      return <Navigate to="/admin" replace />;
    }
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
