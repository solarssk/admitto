import type { ReactNode } from "react";
import { fireEvent, render, screen, type RenderOptions } from "@testing-library/react";
import { vi } from "vitest";
import { ToastProvider } from "@admitto/ui";
import type { TicketTypeDto } from "../src/api/types.js";

/** Renders UI wrapped in `ToastProvider` for components that call `useToast()`. */
export function renderWithToast(ui: ReactNode, options?: Omit<RenderOptions, "wrapper">) {
  return render(<ToastProvider>{ui}</ToastProvider>, options);
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

/** A disabled control's reason now shows via the shared <Tooltip> (packages/ui) - a
 * hover-triggered, portal-rendered bubble (role="tooltip"), not a static title= attribute.
 * Mouse hover, not focus: a `disabled` element is never focusable in a real browser (jsdom's
 * fireEvent.focus doesn't enforce that, so a focus-based helper would pass here while never
 * actually working for a real user tabbing through a disabled control). mouseenter doesn't
 * bubble, so it's dispatched on the element's own parent - the <Tooltip> trigger wrapper that
 * actually owns the listener - not the element itself. */
export function getTooltipText(element: HTMLElement): string | null {
  fireEvent.mouseEnter(element.parentElement ?? element);
  const bubble = screen.queryByRole("tooltip");
  return bubble ? bubble.textContent : null;
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
