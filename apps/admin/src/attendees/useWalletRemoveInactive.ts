import type { ToastVariant } from "@admitto/ui";
import { triggerEventWideWalletRemoveInactive } from "../api/client.js";
import { useWalletCleanupAction } from "./useWalletCleanupAction.js";

/** The Attendees header's "Remove inactive passes" - see useWalletCleanupAction's own doc comment
 * for the shared behaviour (event-scoped confirmation, detached poll). */
export function useWalletRemoveInactive(params: {
  eventId: string | undefined;
  addToast: (message: string, variant?: ToastVariant) => void;
  reportApiError: (status: number) => void;
  onFinished: () => void;
}) {
  return useWalletCleanupAction({
    action: "remove_inactive",
    trigger: triggerEventWideWalletRemoveInactive,
    apiErrorFallback: "Removing the wallet passes failed.",
    genericFallback: "Failed to remove the wallet passes.",
    ...params,
  });
}
