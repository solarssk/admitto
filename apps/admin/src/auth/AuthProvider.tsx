import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, EmptyState, PageLoader, applyThemeVars } from "@admitto/ui";
import { ApiError, fetchMe, fetchStaffTheme } from "../api/client.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AuthUser, RoleAssignment } from "../api/types.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS, SLOW_NOTICE_MS, SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import { setPreferredLocale, setPreferredTimeFormat } from "../utils/locale-store.js";

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

  // Only the very first load (or a retry after a failed one) replaces the app with the loading
  // screen. A later refresh (setup wizard finished, device label saved) updates in place, so it
  // does not unmount every page and throw away what the user had open.
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    setAuthError(null);
    // A stalled server must not spin forever: give up after LOAD_TIMEOUT_MS and offer a retry.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    // Branding is independent of the session payload. Starting it now removes a
    // full network round trip from a cold staff-app load, while retaining the
    // current all-or-nothing visual bootstrap (no flash of unthemed UI).
    const themePromise = fetchStaffTheme(controller.signal)
      .then((theme) => applyThemeVars(theme.theme))
      .catch(() => applyThemeVars(null));
    try {
      const me = await fetchMe(controller.signal);
      setPreferredLocale(me.user.preferred_locale ?? undefined);
      setPreferredTimeFormat(me.user.preferred_time_format);
      setUser({ ...me.user, mailer_status: me.mailer_status ?? null });
      setAssignments(me.assignments);
      setDeviceLabel(me.device_label ?? null);
      setHasAdmittoSession(me.session_active);
      setSetupComplete(me.setup_complete !== false);
      await themePromise;
      hasLoadedRef.current = true;
    } catch (err) {
      hasLoadedRef.current = false;
      if (err instanceof ApiError && err.status === 401) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.assign(`/login?next=${next}`);
        return;
      }
      setAuthError(
        controller.signal.aborted ? LOAD_TIMEOUT_MESSAGE : operatorApiErrorMessage(err, "Could not load session."),
      );
      setUser(null);
      setAssignments([]);
      setDeviceLabel(null);
      setHasAdmittoSession(false);
      setSetupComplete(true);
    } finally {
      clearTimeout(timeout);
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

  const slow = useDelayedLoading(loading, SLOW_NOTICE_MS);
  const bootLoader = (
    <div className="shell-loading">
      <PageLoader label="Loading Admitto" caption={slow ? SLOW_NOTICE_TEXT : undefined} />
    </div>
  );

  if (loading) return bootLoader;

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

  if (!value) return bootLoader;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth requires AuthProvider");
  return ctx;
}
