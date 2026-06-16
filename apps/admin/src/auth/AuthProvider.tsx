import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, fetchMe, fetchStaffTheme } from "../api/client.js";
import type { AuthUser, RoleAssignment } from "../api/types.js";
import { applyThemeVars } from "@admitto/ui";

export interface AuthContextValue {
  user: AuthUser;
  assignments: RoleAssignment[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setUser(me.user);
      setAssignments(me.assignments);
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
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => {
    if (!user) return null;
    return { user, assignments, loading, refresh };
  }, [user, assignments, loading, refresh]);

  if (loading || !value) {
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
