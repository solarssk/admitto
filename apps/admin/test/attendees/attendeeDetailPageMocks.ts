import type { Mock } from "vitest";
import type { RoleAssignment } from "../../src/api/types.js";

/** The role assignment nearly every AttendeeDetailPage.*.test.tsx file wants by default - see
 * `mockAuthProvider`'s default below. Exported (not just used internally) so the rare file that
 * needs an admin assignment alongside something else (e.g. a second, non-admin assignment in the
 * array) can still reuse the literal instead of retyping it. */
export const ADMIN_ASSIGNMENT: RoleAssignment = { role: "admin", scope_type: "organization", scope_id: "org-1" };

/**
 * Shared `vi.mock(...)` bodies for the three modules every AttendeeDetailPage.*.test.tsx file
 * mocks: `attendeeDetailForm.js`, `AuthProvider.js`, and `react-router`'s `useOutletContext()`.
 * SonarCloud flagged this as duplicated identically across the file family (PR #1136 review, and
 * again on this file's own PR #1141 - see point 5 below, that first attempt only halved the
 * problem). All three live in this one file, not test-utils.tsx, so a new file only has one place
 * to look, and a future edit to any of the three has one place to change.
 *
 * RECIPE - copy this into a new AttendeeDetailPage.*.test.tsx file that just needs the ordinary
 * admin/non-archived/wallet-enabled defaults (the common case - see `baseAttendeeDetailEvent` in
 * test-utils.tsx for exactly what "default" means for the event):
 *
 *   // The imports below must come first, before every other import in the file - see the
 *   // "why this shape" note at the bottom of this file for the reason.
 *   import { mockAttendeeDetailForm, mockAuthProvider, mockOutletEvent } from "./attendeeDetailPageMocks.js";
 *   import { baseAttendeeDetailEvent, mockMatchMedia, renderWithToast } from "../test-utils.js";
 *   import { cleanup, fireEvent, screen } from "@testing-library/react";
 *   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 *   import { MemoryRouter, Route, Routes } from "react-router";
 *   import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
 *
 *   const loadAttendeeDetailData = vi.fn();
 *
 *   vi.mock("../../src/attendees/attendeeDetailForm.js", (importOriginal) =>
 *     mockAttendeeDetailForm(importOriginal, () => loadAttendeeDetailData),
 *   );
 *
 *   vi.mock("../../src/auth/AuthProvider.js", () => mockAuthProvider());
 *
 *   vi.mock("react-router", (importOriginal) =>
 *     mockOutletEvent(importOriginal, () => baseAttendeeDetailEvent),
 *   );
 *
 * A file that needs something other than the defaults overrides just that part - e.g.
 * `mockAuthProvider(() => ({ assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }] }))`
 * for superadmin (AttendeeDetailPage.errors.test.tsx), or
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
 * the import of these three functions. That means:
 *
 * 1. The second argument to `vi.mock(...)` must be an inline function (`(importOriginal) =>
 *    mockAttendeeDetailForm(importOriginal, ...)`), never the *result* of calling one of these
 *    functions directly (`vi.mock(path, mockAttendeeDetailForm(...))`). The inline arrow is safe
 *    because creating a function doesn't execute its body; calling `mockAttendeeDetailForm(...)`
 *    eagerly does, and at that point this file's own import of it hasn't resolved yet - ReferenceError:
 *    Cannot access '<import>' before initialization.
 *
 * 2. The import of this file (`attendeeDetailPageMocks.js`) must come before every other import in
 *    the test file. Vitest resolves a test file's imports depth-first, in declaration order; if
 *    `AttendeeDetailPage.js` (which transitively imports the three mocked modules) is imported
 *    first, its dependency graph gets evaluated - and the mock factories invoked - before this
 *    file has been reached, hitting the same "before initialization" error.
 *
 * 3. `mockOutletEvent` mocks "react-router" and lives in this file rather than test-utils.tsx
 *    specifically because test-utils.tsx itself imports the real "react-router" package (for
 *    `renderWithToastAndRouter`'s `MemoryRouter`). A test file that mocks "react-router" mocks it
 *    for its *whole* module graph, including test-utils.tsx's own import - so a factory defined
 *    there would need to call itself before it finished being defined. This file has no runtime
 *    dependency on "react-router" (the type below is erased at compile time), so it doesn't hit
 *    that problem, and `mockAttendeeDetailForm`/`mockAuthProvider` are kept alongside it rather
 *    than split back out to test-utils.tsx, so there's exactly one place to look.
 *
 * 4. Each factory takes a getter (`() => loadAttendeeDetailData`), not the mock/value directly, for
 *    the same underlying reason as point 1: a bare same-file `const`/`let` reference evaluated
 *    eagerly at the hoisted call site would hit Vitest's hoisting restriction (it only allows that
 *    for variables prefixed `mock` or declared via `vi.hoisted`). A getter closure defers the read
 *    until the mock is actually used, well after the whole file has finished loading - which also
 *    happens to be exactly what tests that reassign `assignments`/`outletEvent` between cases need.
 *
 * 5. `mockAuthProvider()`'s default and `mockOutletEvent(importOriginal, () => baseAttendeeDetailEvent)`
 *    both matter, not just style: extracting the *wiring* (points 1-4) without also reusing shared
 *    *data* for the common case still leaves each file spelling out the same assignments/event
 *    literal, and once the wiring boilerplate is gone that literal becomes nearly the entire diff
 *    in each file - which is exactly what tripped SonarCloud's new-code duplication gate the first
 *    time this file existed (30.5%, gate is <=3%). Reusing `ADMIN_ASSIGNMENT`/`baseAttendeeDetailEvent`
 *    by reference, instead of retyping their contents, is what actually keeps files under Sonar's
 *    duplicate-block floor - shrinking a repeated literal doesn't help once several files still
 *    repeat it identically, only removing it (by reference) does.
 */
export async function mockAttendeeDetailForm(
  importOriginal: () => Promise<typeof import("../../src/attendees/attendeeDetailForm.js")>,
  getLoadAttendeeDetailData: () => Mock,
) {
  const actual = await importOriginal();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => getLoadAttendeeDetailData()(...args),
  };
}

export function mockAuthProvider(
  getAuth: () => { assignments: RoleAssignment[]; user?: { id: string } } = () => ({
    assignments: [ADMIN_ASSIGNMENT],
  }),
) {
  return { useAuth: getAuth };
}

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

/** Generic `vi.mock(...)` body for the same "spread real exports, override a few" shape as the
 * three functions above, for a module none of them cover - in practice always
 * `vi.mock("../../src/api/client.js", ...)`, whose *override set* (which functions get mocked)
 * is inherently different per file, but whose *wrapper* was identical everywhere. Extracted for a
 * concrete, measured reason, not just style: once the three mocks above got short enough, this
 * file's own PR (#1141) found SonarCloud chaining that wrapper - unchanged, but now sitting right
 * after an equally short block above it with nothing large enough between them to stop the match -
 * into the same clone as the mocks above, even though neither block crossed the duplicate-block
 * threshold alone. Same hoisting rules as the others apply (see point 1 above): the call site
 * wraps this in an inline `(importOriginal) => mockModule(importOriginal, () => ({...}))`. */
export async function mockModule<T extends object>(
  importOriginal: () => Promise<T>,
  getOverrides: () => Partial<T>,
) {
  const actual = await importOriginal();
  return { ...actual, ...getOverrides() };
}
