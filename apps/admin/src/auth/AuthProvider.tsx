import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button, EmptyState, applyThemeVars } from "@admitto/ui";
import { ApiError, fetchMe, fetchStaffTheme } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AuthUser, RoleAssignment } from "../api/types.js";
import { setPreferredLocale } from "../utils/locale-store.js";

export interface AuthContextValue {
  user: AuthUser;
  assignments: RoleAssignment[];
  deviceLabel: string | null;
  hasAdmittoSession: boolean;
  setupComplete: boolean;
  loading: boolean;
  authError: string | null;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [hasAdmittoSession, setHasAdmittoSession] = useState(false);
  const [setupComplete, setSetupComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    try {
      const me = await fetchMe();
      setPreferredLocale(me.user.preferred_locale ?? undefined);
      setUser({ ...me.user, mailer_status: me.mailer_status ?? null });
      setAssignments(me.assignments);
      setDeviceLabel(me.device_label ?? null);
      setHasAdmittoSession(me.session_active);
      setSetupComplete(me.setup_complete !== false);
      try {
        const theme = await fetchStaffTheme();
        applyThemeVars(theme.theme);
      } catch {
        applyThemeVars(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.assign(`/login?next=${next}`);
        return;
      }
      setAuthError(operatorApiErrorMessage(err, "Failed to load session"));
      setUser(null);
      setAssignments([]);
      setDeviceLabel(null);
      setHasAdmittoSession(false);
      setSetupComplete(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => {
    if (!user) return null;
    return {
      user,
      assignments,
      deviceLabel,
      hasAdmittoSession,
      setupComplete,
      loading,
      authError,
      refresh,
    };
  }, [user, assignments, deviceLabel, hasAdmittoSession, setupComplete, loading, authError, refresh]);

  if (loading) {
    return (
      <div className="shell-loading" style={{ padding: "2rem", textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  if (authError) {
    return (
      <div className="shell-loading" style={{ padding: "2rem" }}>
        <EmptyState
          title="Could not load session"
          description={authError}
          action={
            <Button type="button" variant="secondary" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (!value) {
    return (
      <div className="shell-loading" style={{ padding: "2rem", textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth requires AuthProvider");
  return ctx;
}
