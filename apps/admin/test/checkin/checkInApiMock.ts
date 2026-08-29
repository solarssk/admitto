import { vi } from "vitest";

/** Handles for the four api/client.js calls CheckInPage always makes on mount (its own
 * bootstrap fetches) - shared by every CheckInPage.*.test.tsx file whose scenario doesn't
 * otherwise diverge from this shape. Each test file still registers its own local
 * vi.mock("../../src/api/client.js", ...) - Vitest's mock hoisting is a per-file static-analysis
 * transform that only sees calls written in the importing file's own source, so this can share
 * the mock *implementation* but not the registration itself - building off buildCheckInApiMock()
 * below and layering in only the extra functions its own scenario needs to control. */
export const checkInApiMocks = {
  fetchCheckInHistory: vi.fn(),
  fetchCheckInStats: vi.fn(),
  fetchCheckInOpsConfig: vi.fn(),
  fetchCheckInEvents: vi.fn(),
};

export function buildCheckInApiMock(actual: typeof import("../../src/api/client.js")) {
  return {
    ...actual,
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
    fetchCheckInHistory: (...args: unknown[]) => checkInApiMocks.fetchCheckInHistory(...args),
    fetchCheckInStats: (...args: unknown[]) => checkInApiMocks.fetchCheckInStats(...args),
    fetchCheckInOpsConfig: (...args: unknown[]) => checkInApiMocks.fetchCheckInOpsConfig(...args),
    fetchCheckInEvents: (...args: unknown[]) => checkInApiMocks.fetchCheckInEvents(...args),
  };
}

/** "Everything enabled, one live event, nothing admitted yet" - the page-bootstrap state every
 * CheckInPage test starts from before exercising its own scenario. */
export function mockCheckInBootstrap(): void {
  checkInApiMocks.fetchCheckInOpsConfig.mockResolvedValue({
    require_confirm_on_scan: false,
    badge_at_entry: true,
    allow_manual_lookup: true,
    auto_advance_on_valid: true,
  });
  checkInApiMocks.fetchCheckInEvents.mockResolvedValue([{ id: "evt-live", timezone: "UTC" }]);
  checkInApiMocks.fetchCheckInHistory.mockResolvedValue([]);
  checkInApiMocks.fetchCheckInStats.mockResolvedValue({ admitted_count: 0, total_count: 1 });
}
