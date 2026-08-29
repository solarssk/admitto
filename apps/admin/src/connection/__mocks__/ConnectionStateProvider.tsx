import { vi } from "vitest";

export const reportApiError = vi.fn();

export function useConnectionState() {
  return { reportApiError };
}
