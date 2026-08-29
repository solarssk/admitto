import { vi } from "vitest";

/**
 * Vitest manual mock for `attendeeDetailForm.js`, auto-applied by every AttendeeDetailPage.*.test.tsx
 * file's bare `vi.mock("../../src/attendees/attendeeDetailForm.js");` (no factory needed) - see
 * `attendeeDetailPageMocks.ts`'s own doc comment for why this exists and how it fits alongside the
 * other three mocks. Every real export except `loadAttendeeDetailData` passes through unchanged;
 * a test file that needs different behavior can still call `loadAttendeeDetailData.mockResolvedValueOnce(...)`
 * (importing it the normal way - the import resolves to this mock, transparently) or override with
 * an explicit `vi.mock(path, factory)`, which always takes precedence over this file.
 */
export * from "../attendeeDetailForm.js";
export const loadAttendeeDetailData = vi.fn();
