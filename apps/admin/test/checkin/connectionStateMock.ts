import { vi } from "vitest";
import type { ConnectionContextValue, ConnectionState } from "../../src/connection/types.js";

/**
 * Shared shape for a mocked `useConnectionState()` return value. The `vi.fn()`
 * and `vi.mock("../../src/connection/ConnectionStateProvider.js", ...)` call
 * still have to live in each test file (vi.mock is hoisted per-file, above
 * imports — referencing an imported `vi.fn()` inside its factory hits a
 * temporal-dead-zone error), but every file can build the mock's return
 * value from here instead of re-declaring the object shape:
 *
 *   const useConnectionState = vi.fn();
 *   vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({ useConnectionState }));
 *   ...
 *   useConnectionState.mockReturnValue(connectionStateValue("connected"));
 */
export function connectionStateValue(state: ConnectionState): ConnectionContextValue {
  return { state, lastCheckedAt: null, reportApiError: vi.fn() };
}
