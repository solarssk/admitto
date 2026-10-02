import { useCallback, useEffect, useState } from "react";
import {
  fetchEventCustomFields,
  fetchEventLocation,
  fetchWalletPushHistory,
  type WalletPushHistoryPage,
} from "../api/client.js";
import type { EventCustomFieldDto, EventLocationDto } from "../api/types.js";
import type { EventSettingsTab } from "../settings/eventSettingsTabs.js";
import { WALLET_PUSH_HISTORY_PAGE_SIZE_DEFAULT } from "../settings/EventWalletPanel.js";
import { useListLoad, type ListLoad } from "./useListLoad.js";

/** Read-only preview data for the Wallet tab's field mapping hint icons (computeWalletPlaceholder
 * Preview) - the event's own Location tab data, fetched independently of LocationSettingsPanel
 * (which owns the editable copy) so opening Wallet alone doesn't require visiting Location first.
 * Fetched once, only once the Wallet tab is actually visited - undefined stays "loading" rather
 * than a misleading "not set" for the brief window before this resolves. Extracted out of
 * EventSettingsPage.tsx (SonarCloud S3776) - that page component's own cognitive complexity was
 * already at Sonar's ceiling before this and useWalletPushHistory below were pulled out, and a
 * single-purpose fetch-on-visit effect like this one is a self-contained concern in its own right,
 * not just complexity relocated for its own sake. `invalidate()` resets back to "loading" -
 * LocationSettingsPanel's own onLocationSaved calls it so a saved venue-access field shows up in
 * the hint preview right away instead of the value from whenever Wallet was first visited. */
export function useWalletLocationPreview(
  eventId: string | undefined,
  visitedTabs: ReadonlySet<EventSettingsTab>,
): {
  walletLocationPreview: EventLocationDto | null | undefined;
  invalidateWalletLocationPreview: () => void;
} {
  const [walletLocationPreview, setWalletLocationPreview] = useState<EventLocationDto | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!eventId || !visitedTabs.has("wallet") || walletLocationPreview !== undefined) return;
    const controller = new AbortController();
    fetchEventLocation(eventId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setWalletLocationPreview(data);
      })
      .catch(() => {
        /* preview-only: a failed fetch just leaves hint icons showing "Loading…" */
      });
    return () => controller.abort();
  }, [eventId, visitedTabs, walletLocationPreview]);
  const invalidateWalletLocationPreview = useCallback(() => setWalletLocationPreview(undefined), []);
  return { walletLocationPreview, invalidateWalletLocationPreview };
}

/** The event's own custom-field registry (Requirements/Registrations tab), reused by the Wallet
 * tab's field mapping dropdown so an admin can map a select/boolean custom field onto a
 * PassCreator property (v0.7.1) - same fetch-once-on-visit shape as useWalletLocationPreview
 * above, for the same reason (this is a read-only preview list, not the editable copy owned by
 * EventCustomFieldsCard). `undefined` while loading; an empty array is a valid loaded state
 * (no custom fields defined for this event yet).
 *
 * The cached result is keyed by the `eventId` it was fetched for, not just "has a fetch already
 * happened" - EventSettingsPage stays mounted across a `/events/:eventId/settings` navigation
 * (same pattern useWalletPushHistory above already has to account for), so a bare "already have a
 * value" check would keep showing event A's custom fields - and let an admin save a `custom:...`
 * mapping event B's own attendees can never resolve - after switching to event B (bot review). */
export function useWalletCustomFields(
  eventId: string | undefined,
  visitedTabs: ReadonlySet<EventSettingsTab>,
): EventCustomFieldDto[] | undefined {
  const [cached, setCached] = useState<{ eventId: string; items: EventCustomFieldDto[] } | undefined>(undefined);
  useEffect(() => {
    if (!eventId || !visitedTabs.has("wallet") || cached?.eventId === eventId) return;
    const controller = new AbortController();
    fetchEventCustomFields(eventId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setCached({ eventId, items });
      })
      .catch(() => {
        /* preview-only: a failed fetch just leaves the dropdown without custom-field options */
      });
    return () => controller.abort();
  }, [eventId, visitedTabs, cached]);
  return cached && cached.eventId === eventId ? cached.items : undefined;
}

export interface WalletPushHistoryState {
  /** The page of pushes on screen, with its load state (first load, refresh, failure). */
  list: ListLoad<WalletPushHistoryPage>;
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

/** Wallet push history: read each time the admin opens the Wallet tab (not just once: unlike the location preview above, it
 * reflects background jobs triggered from elsewhere, so it can go stale while the tab stays mounted between visits), and
 * again for every page or page size. It is a list on the loading standard (`useListLoad`): the first read is a placeholder,
 * a later page or visit keeps the rows on screen, blocked, while it runs, and a read that fails replaces them with the
 * error (they no longer answer what was asked), with a Retry. The page is a fresh one for another event (`EventSettingsPage` is keyed by the event), so its page number
 * never carries over. */
export function useWalletPushHistory(eventId: string, tab: EventSettingsTab): WalletPushHistoryState {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(WALLET_PUSH_HISTORY_PAGE_SIZE_DEFAULT);
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchWalletPushHistory(eventId, page, pageSize, signal),
    [eventId, page, pageSize],
  );
  const list = useListLoad({ fetcher, fallback: "Could not load wallet push history.", enabled: tab === "wallet" });
  return { list, page, pageSize, setPage, setPageSize };
}
