import type { ReactNode } from "react";
import { fireEvent, render, screen, type RenderOptions } from "@testing-library/react";
import { vi } from "vitest";
import type { Mock } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@admitto/ui";
import type { TicketTypeDto } from "../src/api/types.js";
import { AttendeeDetailPage } from "../src/pages/AttendeeDetailPage.js";

/** Renders UI wrapped in `ToastProvider` for components that call `useToast()`. */
export function renderWithToast(ui: ReactNode, options?: Omit<RenderOptions, "wrapper">) {
  return render(<ToastProvider>{ui}</ToastProvider>, options);
}

/** Renders UI wrapped in both `MemoryRouter` and `ToastProvider`, for components that call
 * `useToast()` and also need a router context (e.g. a `<Link>` or `useSearchParams()`). */
export function renderWithToastAndRouter(ui: ReactNode, options?: Omit<RenderOptions, "wrapper">) {
  return render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
    options,
  );
}

/** Minimal TicketTypeDto fixture for tests exercising catalog resolution. */
export function makeTicketType(key: string, label: string): TicketTypeDto {
  return {
    id: `tt-${key}`,
    key,
    label,
    color: "purple",
    sort_order: 0,
    attendee_count: 0,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

/** Minimal event fixture for AttendeeDetailPage tests that mock `useOutletContext` directly (not
 * via a shared helper) and don't exercise wallet-platform gating themselves - every wallet toggle
 * on, so the Wallet card/chip render unconditionally and the test can focus on its own concern.
 * Spread and override per file (e.g. `{ ...baseAttendeeDetailEvent, archived_at: "..." }`) rather
 * than hand-writing the same event object in each file - Sonar flagged the identical literal
 * repeated across 10 test files as new-code duplication. Tests that DO need to flip a wallet
 * toggle mid-test (e.g. AttendeeDetailPage.walletActions.test.tsx) use their own mutable-getter
 * mock instead, since this static object can't do that. */
export const baseAttendeeDetailEvent = {
  id: "evt-1",
  title: "Demo",
  slug: "demo",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  location: null,
  attendee_count: 1,
  wallet_enabled: true,
  wallet_apple_enabled: true,
  wallet_google_enabled: true,
  archived_at: null as string | null,
};

/** The subset of an attendee-detail response's fields that stayed byte-for-byte identical across
 * every AttendeeDetailPage.*.test.tsx file's own local `baseDetail(overrides)` helper - a plain,
 * unremarkable registered attendee. Spread into each file's own `baseDetail()` (e.g.
 * `{ ...baseAttendeeDetail, company: "Acme", department: "Eng", ...overrides }`) rather than
 * retyping these 12 fields; each file keeps its own `baseDetail()` wrapper for the fields that
 * genuinely differ (name, company, admitted_at, check_in_status, ...) and for its own
 * `overrides` parameter. Same motivation as `baseAttendeeDetailEvent` above - see that fixture's
 * own doc comment and `attendeeDetailPageMocks.ts`'s "why this shape" note (point 5) for the
 * measured reason a shared *value*, not just shared *wiring*, is what keeps SonarCloud's
 * new-code duplication gate passing here. */
export const baseAttendeeDetail = {
  id: "att-1",
  name: "Anna",
  email: "anna@example.com",
  company: null as string | null,
  department: null as string | null,
  ticket_type: "vip",
  custom_data: {} as Record<string, unknown>,
  status: "registered" as const,
  admitted_at: null as string | null,
  updated_at: "2026-01-01T00:00:00.000Z",
  check_in_status: "not_admitted" as const,
  last_mail_status: null,
  rsvp_status: "confirmed" as const,
  rsvp_updated_at: null,
  rsvp_source: null,
  deliveries: [] as unknown[],
  action_log: [] as unknown[],
  event_items: [] as unknown[],
};

/** Shared body for AttendeeDetailPage.*.test.tsx's own local `mockLoad(detail)` wrapper - resolves
 * the mocked `loadAttendeeDetailData` once with `detail`. Kept as a thin per-file wrapper (calling
 * this) rather than switching every `mockLoad(baseDetail())` call site (dozens per file) to pass
 * `loadAttendeeDetailData` explicitly - only the wrapper's own body needed to change. `extra` covers
 * the one file (profileEdit) that resolves with real `attributeFields` instead of `[]`. */
export function mockAttendeeDetailLoad(
  loadAttendeeDetailData: Mock,
  detail: Record<string, unknown>,
  extra: { attributeFields?: unknown[]; itemsWarning?: unknown } = {},
) {
  loadAttendeeDetailData.mockResolvedValueOnce({
    detail,
    attributeFields: extra.attributeFields ?? [],
    itemsWarning: extra.itemsWarning ?? null,
  });
}

/** Shared body for AttendeeDetailPage.*.test.tsx's own local `renderPage(...)` wrapper - same
 * reasoning as `mockAttendeeDetailLoad` above: kept as a per-file wrapper so call sites don't
 * change, only what the wrapper delegates to. `element` is what renders at the attendee-detail
 * route (plain `<AttendeeDetailPage />`, or wrapped with a file-local `<RouteChangeControl />` for
 * files that test stale-request handling across a route change); `extraRoutes` covers
 * deleteAttendee's own extra "back to the list" route. */
export function renderAttendeeDetailRoute(
  element: ReactNode,
  options: { extraRoutes?: ReactNode; initialEntry?: string } = {},
) {
  return renderWithToast(
    <MemoryRouter initialEntries={[options.initialEntry ?? "/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={element} />
        {options.extraRoutes}
      </Routes>
    </MemoryRouter>,
  );
}

/** A disabled control's reason now shows via the shared <Tooltip> (packages/ui) - a
 * hover-triggered, portal-rendered bubble (role="tooltip"), not a static title= attribute.
 * Mouse hover, not focus: a `disabled` element is never focusable in a real browser (jsdom's
 * fireEvent.focus doesn't enforce that, so a focus-based helper would pass here while never
 * actually working for a real user tabbing through a disabled control). mouseenter doesn't
 * bubble, so it's dispatched on the actual <Tooltip> trigger wrapper (found via `closest`, since
 * some controls - e.g. Switch's <label><input/></label> - put a level of markup between the
 * queried element and the wrapper that owns the listener), not the element itself. Leaves again
 * before returning - otherwise a test asserting several disabled controls on one page leaves
 * every earlier tooltip open too, and a later screen.queryByRole("tooltip") sees more than one. */
export function getTooltipText(element: HTMLElement): string | null {
  const trigger = element.closest(".at-tooltip-trigger") ?? element;
  fireEvent.mouseEnter(trigger);
  const bubble = screen.queryByRole("tooltip");
  const text = bubble ? bubble.textContent : null;
  fireEvent.mouseLeave(trigger);
  return text;
}

export interface MockMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: (type: string, handler: (event: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: string, handler: (event: MediaQueryListEvent) => void) => void;
  dispatch: (next: boolean) => void;
}

/** Stubs `window.matchMedia` for the `useIsDesktop()` breakpoint hook, since jsdom does not
 * implement it. Pattern matches `test/checkin/inline-camera.test.tsx`. Call before render (e.g.
 * in `beforeEach`) and pair with `vi.unstubAllGlobals()` in `afterEach`. Defaults tests to
 * `matches: true` (desktop) unless a test explicitly needs the mobile (<768px) layout. */
export function mockMatchMedia(matches: boolean): MockMediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mq: MockMediaQueryList = {
    matches,
    media: "(min-width: 768px)",
    addEventListener: (_type, handler) => {
      listeners.add(handler);
    },
    removeEventListener: (_type, handler) => {
      listeners.delete(handler);
    },
    dispatch(next) {
      mq.matches = next;
      listeners.forEach((handler) => handler({ matches: next } as MediaQueryListEvent));
    },
  };
  vi.stubGlobal("matchMedia", () => mq);
  return mq;
}
