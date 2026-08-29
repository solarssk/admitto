import { vi } from "vitest";

/**
 * Vitest manual mock for `AuthProvider.js`, auto-applied by every AttendeeDetailPage.*.test.tsx
 * file's bare `vi.mock("../../src/auth/AuthProvider.js");` (no factory needed) - see
 * `attendeeDetailPageMocks.ts`'s own doc comment for why this exists. Defaults to a plain org
 * admin, matching what most of these files want. A file needing a different role (or one that
 * reassigns the role between test cases, e.g. AttendeeDetailPage.errors.test.tsx or
 * AttendeeDetailPage.revokePass.test.tsx) overrides with an explicit `vi.mock(path, factory)`,
 * which always takes precedence over this file - it does not export `AuthProvider` itself since
 * nothing under test renders it directly, only calls `useAuth()`.
 */
export const useAuth = vi.fn(() => ({
  assignments: [{ role: "admin", scope_type: "organization", scope_id: "org-1" }],
}));
