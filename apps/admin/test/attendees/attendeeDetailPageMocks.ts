import type { RoleAssignment } from "../../src/api/types.js";

/**
 * Shared `vi.mock(...)` support for the four modules every AttendeeDetailPage.*.test.tsx file
 * mocks: `attendeeDetailForm.js`, `AuthProvider.js`, react-router's `useOutletContext()`, and
 * `api/client.js`. SonarCloud flagged this as duplicated identically across the file family (PR
 * #1136 review, and repeatedly on this file's own PR #1141 - see point 5 below for what actually
 * fixed it, after two earlier attempts here that only shrank the problem instead of removing it).
 *
 * `attendeeDetailForm.js` and `AuthProvider.js` don't have functions here anymore - they have
 * Vitest manual mocks instead (`src/attendees/__mocks__/attendeeDetailForm.ts`,
 * `src/auth/__mocks__/AuthProvider.ts`), auto-applied by a bare `vi.mock(path);` with no factory.
 * `mockOutletEvent`/`mockModule` below still need a real factory (see point 3), so they stay here.
 *
 * RECIPE - copy this into a new AttendeeDetailPage.*.test.tsx file that just needs the ordinary
 * admin/non-archived/wallet-enabled defaults (the common case - see `baseAttendeeDetailEvent` in
 * test-utils.tsx for exactly what "default" means for the event):
 *
 *   // The imports below must come first, before every other import in the file - see the
 *   // "why this shape" note at the bottom of this file for the reason.
 *   import { mockModule, mockOutletEvent } from "./attendeeDetailPageMocks.js";
 *   import { baseAttendeeDetailEvent, mockMatchMedia, renderAttendeeDetailRoute } from "../test-utils.js";
 *   import { cleanup, fireEvent, screen } from "@testing-library/react";
 *   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 *   import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
 *   import { loadAttendeeDetailData } from "../../src/attendees/attendeeDetailForm.js";
 *
 *   vi.mock("../../src/attendees/attendeeDetailForm.js");
 *   vi.mock("../../src/auth/AuthProvider.js");
 *
 *   vi.mock("react-router", (importOriginal) =>
 *     mockOutletEvent(importOriginal, () => baseAttendeeDetailEvent),
 *   );
 *
 *   vi.mock("../../src/api/client.js", (importOriginal) =>
 *     mockModule(importOriginal, () => ({ resendTicket: vi.fn(), fetchAttendeeDetail: vi.fn() })),
 *   );
 *
 * `loadAttendeeDetailData` is imported, not declared with `const loadAttendeeDetailData = vi.fn()` -
 * the bare `vi.mock(...)` above makes that import resolve to the manual mock's own `vi.fn()`, which
 * every test file gets a fresh instance of (Vitest isolates each test file's module graph), so
 * `loadAttendeeDetailData.mockResolvedValueOnce(...)` and friends work exactly as before.
 *
 * A file that needs something other than the defaults overrides just that part - e.g.
 * `vi.mock("../../src/auth/AuthProvider.js", () => mockAuthProvider(() => ({ assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }] })))`
 * for superadmin (AttendeeDetailPage.errors.test.tsx - an explicit factory always overrides the
 * manual mock, same as it overrides a bare `vi.mock()`), or
 * `mockOutletEvent(importOriginal, () => ({ ...baseAttendeeDetailEvent, archived_at: "..." }))` to
 * spread-override one field (AttendeeDetailPage.archived.test.tsx). If a test needs to change
 * `assignments`/`user`/the event between cases (e.g. to exercise RBAC, or to flip `archived_at` or
 * a wallet toggle mid-file), declare a mutable `let` and read it inside the getter instead of a
 * static literal - see AttendeeDetailPage.notes.test.tsx (`assignments`/`currentUser`,
 * `outletEvent`) or AttendeeDetailPage.walletActions.test.tsx (`mockArchivedAt`,
 * `mockWalletEnabled`, ...) for worked examples. The getter re-runs on every render, so it always
 * sees the current value.
 *
 * WHY THIS SHAPE (read this before "simplifying" the call sites above):
 *
 * Vitest hoists every `vi.mock(...)` call to the top of the file, above every import - including
 * the import of `mockOutletEvent`/`mockModule` below. That means:
 *
 * 1. Where a factory is still needed (`mockOutletEvent`, `mockModule`), the second argument to
 *    `vi.mock(...)` must be an inline function (`(importOriginal) => mockOutletEvent(importOriginal, ...)`),
 *    never the *result* of calling one of these functions directly
 *    (`vi.mock(path, mockOutletEvent(...))`). The inline arrow is safe because creating a function
 *    doesn't execute its body; calling `mockOutletEvent(...)` eagerly does, and at that point this
 *    file's own import of it hasn't resolved yet - ReferenceError: Cannot access '<import>' before
 *    initialization. A bare `vi.mock(path)` (no factory, relying on a manual mock) doesn't have
 *    this problem at all - there's no factory expression to evaluate eagerly.
 *
 * 2. The import of this file (`attendeeDetailPageMocks.js`) must come before every other import in
 *    the test file. Vitest resolves a test file's imports depth-first, in declaration order; if
 *    `AttendeeDetailPage.js` (which transitively imports react-router and api/client.js) is
 *    imported first, its dependency graph gets evaluated - and the `mockOutletEvent`/`mockModule`
 *    factories invoked - before this file has been reached, hitting the same "before
 *    initialization" error.
 *
 * 3. `mockOutletEvent` mocks "react-router" and lives in this file rather than test-utils.tsx
 *    specifically because test-utils.tsx itself imports the real "react-router" package (for
 *    `renderAttendeeDetailRoute`'s `MemoryRouter`). A test file that mocks "react-router" mocks it
 *    for its *whole* module graph, including test-utils.tsx's own import - so a factory defined
 *    there would need to call itself before it finished being defined. This file has no runtime
 *    dependency on "react-router" (the type below is erased at compile time), so it doesn't hit
 *    that problem. `mockModule` (for api/client.js) is kept alongside it for the same reason
 *    "there's exactly one place to look" applied before - api/client.js isn't a manual mock because
 *    its override set (which functions get mocked) is genuinely different per file, unlike
 *    attendeeDetailForm.js/AuthProvider.js, which have one real default nearly every file wants.
 *
 * 4. `mockOutletEvent` takes a getter (`() => baseAttendeeDetailEvent`), not the event directly, for
 *    the same underlying reason as point 1: a bare same-file `const`/`let` reference evaluated
 *    eagerly at the hoisted call site would hit Vitest's hoisting restriction (it only allows that
 *    for variables prefixed `mock` or declared via `vi.hoisted`). A getter closure defers the read
 *    until the mock is actually used, well after the whole file has finished loading - which also
 *    happens to be exactly what tests that reassign the event between cases need.
 *
 * 5. The manual mocks matter, not just style: extracting the *wiring* into shared functions (as an
 *    earlier version of this file did for all four modules) without also reusing shared *data* for
 *    the common case still left each file spelling out the same assignments/event literal - and
 *    once the wiring boilerplate was gone, that literal became nearly the entire diff in each file,
 *    which is what tripped SonarCloud's new-code duplication gate the first time this file existed
 *    (30.5%, gate is <=3%). Reusing `baseAttendeeDetailEvent` by reference cut that to ~13%, but the
 *    *wiring itself* - `vi.mock(path, (importOriginal) => mockXxx(importOriginal, () => ...))`,
 *    repeated with the same shape in 8-9 files - was still enough text to chain into a flagged
 *    clone with whatever sat next to it. Manual mocks remove that wiring from the file entirely for
 *    the two modules where a single default genuinely covers most files, rather than just
 *    shortening it - `vi.mock(path);` is a single bare line with nothing left to shrink.
 */
export async function mockOutletEvent<T extends Record<string, unknown>>(
  importOriginal: () => Promise<typeof import("react-router")>,
  getEvent: () => T,
) {
  const actual = await importOriginal();
  return {
    ...actual,
    useOutletContext: () => ({ event: getEvent() }),
  };
}

/** Shared body for the rare `vi.mock("../../src/auth/AuthProvider.js", ...)` call that needs
 * something other than the manual mock's default org admin (see the file-level doc comment above) -
 * a different role (AttendeeDetailPage.errors.test.tsx), or one that changes between test cases
 * (AttendeeDetailPage.notes.test.tsx, AttendeeDetailPage.revokePass.test.tsx). Call site still wraps
 * this in an inline `() => mockAuthProvider(...)` for the same hoisting reason as point 1 above. */
export function mockAuthProvider(getAuth: () => { assignments: RoleAssignment[]; user?: { id: string } }) {
  return { useAuth: getAuth };
}

/** Generic `vi.mock(...)` body for the same "spread real exports, override a few" shape as
 * `mockOutletEvent` above, for a module that isn't a manual mock - in practice always
 * `vi.mock("../../src/api/client.js", ...)`, whose *override set* (which functions get mocked) is
 * inherently different per file, but whose *wrapper* was identical everywhere. Extracted for a
 * concrete, measured reason, not just style: once the mocks above got short enough, this file's own
 * PR (#1141) found SonarCloud chaining that wrapper - unchanged, but now sitting right after an
 * equally short block above it with nothing large enough between them to stop the match - into the
 * same clone as the mocks above, even though neither block crossed the duplicate-block threshold
 * alone. Same hoisting rules as the others apply (see point 1 above): the call site wraps this in
 * an inline `(importOriginal) => mockModule(importOriginal, () => ({...}))`. */
export async function mockModule<T extends object>(
  importOriginal: () => Promise<T>,
  getOverrides: () => Partial<T>,
) {
  const actual = await importOriginal();
  return { ...actual, ...getOverrides() };
}
