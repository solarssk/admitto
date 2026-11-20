import { useEffect } from "react";

/**
 * What the Requests tab offers the "More actions" menu of the page header: the way to delete everything the filter selects, with how many
 * that is. The filter lives in the tab and the menu in the header, so the tab hands the offer up while it has one (the list is read, the
 * filter selects something that may be deleted together) and takes it back when it has none or is gone.
 */
export interface DeleteMatchingOffer {
  total: number;
  /** Opens the confirmation. */
  ask: () => void;
}

export function useDeleteMatchingOffer(offer: (offer: DeleteMatchingOffer | null) => void, total: number | null, ask: () => void): void {
  useEffect(() => {
    if (total === null) return;
    offer({ total, ask });
    return () => offer(null);
  }, [offer, total, ask]);
}
