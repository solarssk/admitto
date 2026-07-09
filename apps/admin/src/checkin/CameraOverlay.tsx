import { useEffect, useMemo, useState } from "react";
import { Button } from "@admitto/ui";
import type {
  AttendeeCardDto,
  CheckInHistoryEntry,
  CheckInScanResponse,
  LookupAttendeeResult,
} from "../api/types.js";
import { CameraScanner } from "./CameraScanner.js";
import { CheckInCameraResultPanel } from "./CheckInCameraResultPanel.js";
import { CkRecentScans } from "./CkRecentScans.js";
import { CameraOverlayManualSearch } from "./CameraOverlayManualSearch.js";
import { CameraOverlayItemIssuing } from "./CameraOverlayItemIssuing.js";
import { BrandMark } from "../layouts/BrandMark.js";

type CameraOverlayProps = {
  open: boolean;
  eventTimezone: string;
  eventDate?: string | null;
  admittedCount: number;
  history: CheckInHistoryEntry[];
  wedgeActive: boolean;
  onClose: () => void;
  onScan: (raw: string) => void;
  allowManualLookup: boolean;
  onSearch: (query: string) => Promise<LookupAttendeeResult[]>;
  onSelectAttendee: (attendeeId: string) => void;
  onManualEntry: (query: string) => Promise<boolean>;
  manualError?: string | null;
  onClearManualError?: () => void;
  scanResult: CheckInScanResponse | null;
  card: AttendeeCardDto | null;
  pending: boolean;
  canAct: boolean;
  onConfirm?: () => void;
  onReset: () => void;
  /** Resolves whether the action actually succeeded — CameraOverlayItemIssuing
   * awaits this to revert its optimistic "issued" mark on failure. */
  onItemAction?: (itemKey: string, targetState: string) => Promise<boolean>;
  onUndo?: () => void;
  showUndo?: boolean;
};

export function CameraOverlay({
  open,
  eventTimezone,
  eventDate = null,
  admittedCount,
  history,
  wedgeActive,
  onClose,
  onScan,
  allowManualLookup,
  onSearch,
  onSelectAttendee,
  onManualEntry,
  manualError,
  onClearManualError,
  scanResult,
  card,
  pending,
  canAct,
  onConfirm,
  onReset,
  onItemAction,
  onUndo,
  showUndo,
}: CameraOverlayProps) {
  const [manualMode, setManualMode] = useState(false);

  useEffect(() => {
    if (!open) setManualMode(false);
  }, [open]);

  // Snapshot of every configured item, taken once per attendee — walked
  // through in full even when an item (e.g. Badge via badge_at_entry) was
  // already auto-issued server-side: the operator still needs a step for it
  // as a reminder to physically hand it over, not just the ones still
  // missing a system action (PO review).
  const itemStepKeys = useMemo(
    () => card?.items.map((item) => item.key) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-snapshot only on attendee change, not on every item mutation from onItemAction (which would reshuffle the order mid-flow)
    [card?.id],
  );

  // Manual entry into the item flow from an "Already checked in" result —
  // e.g. the attendee was admitted earlier but their items weren't handed
  // out, and the operator scans them again. Reset whenever the displayed
  // attendee or result changes.
  const [itemsMode, setItemsMode] = useState(false);
  useEffect(() => {
    setItemsMode(false);
  }, [card?.id, scanResult?.status]);

  // Auto-shown right after a fresh check-in (manual Confirm or auto-admit)
  // when the event has items configured. ALREADY_CHECKED_IN does NOT take
  // over automatically — the operator gets the standard result card with a
  // small "Issue items" entry point instead (PO review), since re-scanning
  // someone is usually about verifying, not re-issuing.
  const itemStepActive =
    !!card &&
    itemStepKeys.length > 0 &&
    !!scanResult &&
    ((scanResult.status === "VALID" && scanResult.confirmed) || itemsMode);

  const pendingItemCount = card?.items.filter((item) => item.actions.length > 0).length ?? 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Extracted from a nested ternary in the JSX below (Sonar S3358) — three
  // mutually exclusive states for the camera frame's content.
  function renderFrameContent() {
    if (itemStepActive && card && onItemAction) {
      return (
        <CameraOverlayItemIssuing
          key={card.id}
          items={card.items}
          stepKeys={itemStepKeys}
          onItemAction={onItemAction}
          pending={pending}
          canAct={canAct}
          onDone={onReset}
          onUndo={onUndo}
          showUndo={showUndo}
        />
      );
    }
    if (scanResult) {
      return (
        <CheckInCameraResultPanel
          scanResult={scanResult}
          card={card}
          pending={pending}
          canAct={canAct}
          eventTimezone={eventTimezone}
          onConfirm={onConfirm}
          onReset={onReset}
          onIssueItems={
            scanResult.status === "ALREADY_CHECKED_IN" && pendingItemCount > 0 && onItemAction
              ? () => setItemsMode(true)
              : undefined
          }
        />
      );
    }
    return (
      <div className="ck-overlay__viewfinder" aria-hidden="true">
        <div className="vf-frame">
          <span className="c tl" />
          <span className="c tr" />
          <span className="c bl" />
          <span className="c br" />
          <span className="vf-line" />
        </div>
        <p className="ck-overlay__hint">Point the camera at the attendee&apos;s QR</p>
      </div>
    );
  }

  return (
    <div className="ck-overlay" role="dialog" aria-modal="true" aria-label="Camera check-in">
      <header className="ck-overlay__bar">
        <div className="ck-overlay__brand">
          {BrandMark}
          <span>Check-in</span>
        </div>
        <span className="ck-overlay__admitted">{admittedCount} checked in</span>
        <button
          type="button"
          className="ck-overlay__close"
          aria-label="Exit camera mode"
          onClick={onClose}
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </header>

      {manualMode ? (
        <CameraOverlayManualSearch
          allowManualLookup={allowManualLookup}
          onSearch={onSearch}
          onSelectAttendee={(attendeeId) => {
            setManualMode(false);
            onSelectAttendee(attendeeId);
          }}
          onManualEntry={onManualEntry}
          manualError={manualError}
          onClearManualError={onClearManualError}
          onBack={() => {
            setManualMode(false);
            onClearManualError?.();
          }}
        />
      ) : (
        <div className="ck-overlay__body">
          <div className="ck-overlay__main">
            <div className="ck-overlay__frame">
              <CameraScanner
                enabled={!scanResult && !pending && !itemStepActive}
                wedgeActive={wedgeActive}
                onScan={onScan}
              />
              {renderFrameContent()}
            </div>

            <div className="ck-overlay__manual">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<i className="ti ti-keyboard" aria-hidden="true" />}
                onClick={() => {
                  setManualMode(true);
                  onClearManualError?.();
                }}
              >
                Manual search
              </Button>
            </div>
          </div>

          <aside className="ck-overlay__aside">
            <CkRecentScans
              history={history}
              eventTimezone={eventTimezone}
              eventDate={eventDate}
              compact
              limit={6}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
