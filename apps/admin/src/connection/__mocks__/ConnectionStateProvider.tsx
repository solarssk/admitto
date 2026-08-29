import { vi } from "vitest";

export const reportApiError = vi.fn();

/** Matches the real ConnectionContextValue shape (state/lastCheckedAt/reportApiError) - "connected"
 * is a reasonable default for tests that don't otherwise care about the connection banner. */
export function useConnectionState() {
  return { state: "connected" as const, lastCheckedAt: null, reportApiError };
}
