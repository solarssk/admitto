import type { ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { ToastProvider } from "@admitto/ui";

/** Renders UI wrapped in `ToastProvider` for components that call `useToast()`. */
export function renderWithToast(ui: ReactNode, options?: Omit<RenderOptions, "wrapper">) {
  return render(<ToastProvider>{ui}</ToastProvider>, options);
}
