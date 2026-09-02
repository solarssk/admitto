import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEventLocation, fetchWalletPushHistory, type WalletPushHistoryEntry } from "../api/client.js";
import type { EventLocationDto } from "../api/types.js";
import type { EventSettingsTab } from "../settings/eventSettingsTabs.js";
import { WALLET_PUSH_HISTORY_PAGE_SIZE_DEFAULT } from "../settings/EventWalletPanel.js";
import { useDelayedLoading } from "./useDelayedLoading.js";

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

export interface WalletPushHistoryState {
  walletPushHistory: WalletPushHistoryEntry[] | null;
  walletPushHistoryTotal: number;
  walletPushHistoryError: string | null;
  showWalletPushHistoryLoading: boolean;
  walletPushHistoryPage: number;
  walletPushHistoryPageSize: number;
  setWalletPushHistoryPage: (page: number) => void;
  setWalletPushHistoryPageSize: (pageSize: number) => void;
  retryWalletPushHistory: () => void;
}

/** Wallet push history: re-fetched every time the admin switches to the Wallet tab (not just
 * once) - unlike useWalletLocationPreview above (a static reference value), this list reflects
 * background jobs triggered from elsewhere (currently only the Attendees list's bulk ticket-type
 * change), so it can go stale while this tab stays mounted between visits. Extracted out of
 * EventSettingsPage.tsx alongside useWalletLocationPreview, same SonarCloud S3776 reasoning. */
export function useWalletPushHistory(eventId: string | undefined, tab: EventSettingsTab): WalletPushHistoryState {
  const [walletPushHistory, setWalletPushHistory] = useState<WalletPushHistoryEntry[] | null>(null);
  const [walletPushHistoryTotal, setWalletPushHistoryTotal] = useState(0);
  const [walletPushHistoryError, setWalletPushHistoryError] = useState<string | null>(null);
  const [walletPushHistoryToken, setWalletPushHistoryToken] = useState(0);
  const [walletPushHistoryLoading, setWalletPushHistoryLoading] = useState(false);
  const [walletPushHistoryPage, setWalletPushHistoryPage] = useState(1);
  const [walletPushHistoryPageSize, setWalletPushHistoryPageSize] = useState(
    WALLET_PUSH_HISTORY_PAGE_SIZE_DEFAULT,
  );
  const showWalletPushHistoryLoading = useDelayedLoading(walletPushHistoryLoading);
  // Navigating from one event to another while the Wallet tab stays mounted must not keep the
  // outgoing event's rows/total/page - a separate reset effect keyed on eventId alone would still
  // let this effect run once more with the stale page for the new event first (both effects fire
  // on the same eventId-change render pass, before the reset effect's setState is applied) -
  // detecting the event change inline, in this same effect, is what actually avoids that request
  // (CodeRabbit).
  const walletPushHistoryEventIdRef = useRef(eventId);
  useEffect(() => {
    if (!eventId || tab !== "wallet") return;
    const isNewEvent = eventId !== walletPushHistoryEventIdRef.current;
    walletPushHistoryEventIdRef.current = eventId;
    const page = isNewEvent ? 1 : walletPushHistoryPage;
    if (isNewEvent) {
      setWalletPushHistory(null);
      setWalletPushHistoryTotal(0);
      if (walletPushHistoryPage !== 1) setWalletPushHistoryPage(1);
    }
    const controller = new AbortController();
    setWalletPushHistoryError(null);
    setWalletPushHistoryLoading(true);
    fetchWalletPushHistory(eventId, page, walletPushHistoryPageSize, controller.signal)
      .then(({ items, total }) => {
        setWalletPushHistory(items);
        setWalletPushHistoryTotal(total);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setWalletPushHistoryError("Could not load wallet push history.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setWalletPushHistoryLoading(false);
      });
    return () => controller.abort();
  }, [eventId, tab, walletPushHistoryToken, walletPushHistoryPage, walletPushHistoryPageSize]);

  const retryWalletPushHistory = useCallback(() => setWalletPushHistoryToken((n) => n + 1), []);

  return {
    walletPushHistory,
    walletPushHistoryTotal,
    walletPushHistoryError,
    showWalletPushHistoryLoading,
    walletPushHistoryPage,
    walletPushHistoryPageSize,
    setWalletPushHistoryPage,
    setWalletPushHistoryPageSize,
    retryWalletPushHistory,
  };
}
