import { ApiError } from "../api/client.js";

/** Session expired mid-request: hand off to login with a return path (the pattern used across the admin SPA, e.g.
 * ReportsPage/AttendeesPage). */
export function redirectToLogin(): void {
  const next = encodeURIComponent(window.location.pathname);
  window.location.assign(`/login?next=${next}`);
}

/**
 * `load`, but a 401 hands the browser over to the login page instead of failing: the answer never comes (the page is
 * on its way out), so no error or Retry flashes up first. For the loads of an Identity screen, which are read through
 * `useListLoad` or `usePanelLoad`; it must be created once (module level), a new function is a new request.
 */
export function orLoginRedirect<T>(load: (signal: AbortSignal) => Promise<T>): (signal: AbortSignal) => Promise<T> {
  return async (signal) => {
    try {
      return await load(signal);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return new Promise<never>(() => {});
      }
      throw err;
    }
  };
}
