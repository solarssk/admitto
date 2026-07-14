import type { ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
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
