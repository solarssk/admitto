import { vi } from "vitest";

/** Shared vi.mock() registrations for CheckInPage.{manualEntryTiming,cameraViewStale}.test.tsx -
 * both need the exact same four mocked modules (useEventStream, AuthProvider,
 * ConnectionStateProvider, api/client.js) with lookupCheckInAttendees/submitCheckInScan
 * controllable on top of the shared checkInApiMock.js shape. Loaded via setupFiles for the
 * "checkin-page-scan-shared-setup" Vitest project (see vitest.config.ts) - a plain side-effect
 * import from a test file would not work here, since vi.mock() hoisting only sees calls written
 * in the importing file's own source. */
export const submitCheckInScan = vi.fn();
export const lookupCheckInAttendees = vi.fn();

vi.mock("../../src/hooks/useEventStream.js");

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ deviceLabel: "desk-1", assignments: [] }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { buildCheckInApiMock } = await import("./checkInApiMock.js");
  return {
    ...buildCheckInApiMock(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchAttendeeCard: vi.fn(),
    lookupCheckInAttendees: (...args: unknown[]) => lookupCheckInAttendees(...args),
    submitAttendeeNote: vi.fn(),
    submitCheckInAdmit: vi.fn(),
    submitCheckInScan: (...args: unknown[]) => submitCheckInScan(...args),
    submitItemAction: vi.fn(),
    undoLastCheckIn: vi.fn(),
  };
});
