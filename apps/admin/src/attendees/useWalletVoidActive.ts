import type { ToastVariant } from "@admitto/ui";
import { triggerEventWideWalletVoidActive } from "../api/client.js";
import { useWalletCleanupAction } from "./useWalletCleanupAction.js";

/** The Attendees header's "Void active passes" - see useWalletCleanupAction's own doc comment for
 * the shared behaviour (event-scoped confirmation, detached poll). */
export function useWalletVoidActive(params: {
  eventId: string | undefined;
  addToast: (message: string, variant?: ToastVariant) => void;
  reportApiError: (status: number) => void;
  onFinished: () => void;
}) {
  return useWalletCleanupAction({
    action: "void_active",
    trigger: triggerEventWideWalletVoidActive,
    apiErrorFallback: "Voiding the wallet passes failed.",
    genericFallback: "Failed to void the wallet passes.",
    ...params,
  });
}
