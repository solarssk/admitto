import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@admitto/ui";
import type { AttendeeCardItemDto } from "../api/types.js";
import { itemActionLabel, itemBadgeVariant } from "./AttendeeCard.js";

type CameraOverlayItemIssuingProps = {
  /** Live item list from the current card — looked up by key so state (e.g. after
   * an action completes) stays in sync while stepping through. */
  items: AttendeeCardItemDto[];
  /** Ordered snapshot of item keys to step through, taken once when this screen opens. */
  stepKeys: string[];
  onItemAction: (itemKey: string, targetState: string) => void;
  pending: boolean;
  canAct: boolean;
  /** "Next scan" on the final summary screen. */
  onDone: () => void;
  onUndo?: () => void;
  showUndo?: boolean;
};

export function CameraOverlayItemIssuing({
  items,
  stepKeys,
  onItemAction,
  pending,
  canAct,
  onDone,
  onUndo,
  showUndo,
}: CameraOverlayItemIssuingProps) {
  const [stepIndex, setStepIndex] = useState(0);
  // onItemAction is fire-and-forget from the caller (CheckInPage awaits the
  // API call internally, then updates the `items` prop asynchronously) —
  // goForward() below runs synchronously, so advancing straight to the
  // summary after the last item briefly rendered it against the stale
  // `items` prop, showing the item as still-pending (orange "N skipped")
  // for one tick before the prop caught up and it flipped to green (PO
  // review point 5). Tracking the click locally lets the summary compute
  // "done" immediately, without waiting on the prop.
  const [locallyIssued, setLocallyIssued] = useState<Set<string>>(new Set());
  // Self-correct if the API call actually failed: once `pending` drops back
  // to false (the call settled, success or error) and `items` still shows a
  // locally-marked item as pending, the update didn't go through server-side
  // — drop the optimistic mark so the summary reflects reality instead of a
  // false "issued".
  const wasPending = useRef(pending);
  useEffect(() => {
    if (wasPending.current && !pending) {
      setLocallyIssued((prev) => {
        const stillPending = items.filter((i) => prev.has(i.key) && i.actions.length > 0);
        if (stillPending.length === 0) return prev;
        const next = new Set(prev);
        stillPending.forEach((i) => next.delete(i.key));
        return next;
      });
    }
    wasPending.current = pending;
  }, [pending, items]);

  const currentKey = stepKeys[stepIndex];
  const currentItem = currentKey ? items.find((i) => i.key === currentKey) : undefined;
  const goBack = () => setStepIndex((i) => i - 1);
  const goForward = () => setStepIndex((i) => i + 1);
  const isDone = (item: AttendeeCardItemDto) => item.actions.length === 0 || locallyIssued.has(item.key);

  // Top-anchored column, not vertically centered: the icon sits at a fixed
  // offset from the top (matching the icon on the main check-in cards —
  // Valid / Already checked in / Revoked — exactly, PO review) and the
  // button at a fixed offset from the bottom on every screen (a step, or
  // the summary), regardless of how much content sits between them.
  // Centering the whole stack (the previous approach) made the icon/button
  // position depend on total content height, which varies per screen — the
  // button visibly drifted (PO review). The middle region
  // (.ck-items__card / .ck-items__summary) is the only flexible piece: it
  // grows into leftover space when short, and scrolls instead of pushing
  // the button out of place when it doesn't fit (e.g. 4-5 items). The step
  // progress indicator ("Item X of Y") renders below the button, not above
  // the icon — it used to collide with the icon there (PO review).
  if (stepIndex >= stepKeys.length) {
    const resolvedItems = stepKeys
      .map((key) => items.find((i) => i.key === key))
      .filter((i): i is AttendeeCardItemDto => !!i);
    const skippedCount = resolvedItems.filter((item) => !isDone(item)).length;
    const allDone = skippedCount === 0;

    return (
      // Skipping an item is a legitimate choice, but the summary must not
      // read as "everything was handed out" when it wasn't — a big green
      // checkmark there would be a false confirmation (PO review).
      <div className={allDone ? "ck-items" : "ck-items ck-items--incomplete"}>
        <i
          className={`ti ${allDone ? "ti-circle-check" : "ti-alert-triangle"} ck-items__icon`}
          aria-hidden="true"
        />
        <h2 className="ck-items__label">
          {allDone ? "All items issued" : `${skippedCount} item${skippedCount === 1 ? "" : "s"} skipped`}
        </h2>
        <ul className="ck-items__summary">
          {resolvedItems.map((item) => {
            const done = isDone(item);
            return (
              <li key={item.key} className={done ? "is-done" : "is-skipped"}>
                <i className={`ti ${done ? "ti-check" : "ti-minus"}`} aria-hidden="true" />
                {item.label}
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="primary" size="lg" block onClick={onDone}>
          Next scan
        </Button>
        {/* Always rendered — matches .ck-items__nav's reserved height on the
            step screens, even when there's no undo link, so the button sits
            at the same fixed Y on every screen (PO review point 2). */}
        <div className="ck-items__nav">
          {showUndo && onUndo && (
            <button type="button" className="link-btn" onClick={onUndo}>
              Undo last check-in
            </button>
          )}
        </div>
      </div>
    );
  }

  // currentItem is always defined once stepIndex < stepKeys.length — every
  // key in the snapshot comes straight from `items`.
  if (!currentItem) return null;

  const alreadyDone = isDone(currentItem);
  const action = currentItem.actions[0];

  return (
    <div className="ck-items">
      <i className={`ti ti-${currentItem.icon ?? "package"} ck-items__icon`} aria-hidden="true" />
      <h2 className="ck-items__label">{currentItem.label}</h2>
      {/* Card box matching .ck-overlay__result-card; groups desc, detail, and
          the already-issued badge. Fields render only when they have
          content — the button's position no longer depends on this card's
          height (it's bottom-anchored via .ck-items__card's flex:1, not
          centering), so there's no more need to always reserve worst-case
          height for absent fields (PO review point 3). Description is shown
          in full, not clamped — the card scrolls if it's long, rather than
          silently truncating admin-configured text (PO review point 3).
          The already-issued state is the same Badge + itemBadgeVariant
          AttendeeCard.tsx uses on desktop, not a full sentence: a "remember
          to hand it over" sentence wrapped to 2 lines and looked messy at
          this width (PO review point 4). */}
      {(currentItem.description || currentItem.detail || alreadyDone) && (
        <div className="ck-items__card">
          {currentItem.description && <p className="ck-items__desc">{currentItem.description}</p>}
          {currentItem.detail && <p className="ck-items__detail">{currentItem.detail}</p>}
          {alreadyDone && (
            <Badge variant={itemBadgeVariant(currentItem.state)} className="ck-items__note">
              Already {currentItem.state}
            </Badge>
          )}
        </div>
      )}
      {alreadyDone ? (
        <Button type="button" variant="primary" size="lg" block onClick={goForward}>
          Next
        </Button>
      ) : (
        <Button
          type="button"
          variant="primary"
          size="lg"
          block
          disabled={!canAct || pending}
          onClick={() => {
            setLocallyIssued((prev) => new Set(prev).add(currentItem.key));
            onItemAction(currentItem.key, action);
            goForward();
          }}
        >
          {itemActionLabel(currentItem.key, action)}
        </Button>
      )}
      {/* Dots only, no visible "Item X of Y" label (kept for screen readers
          via .sr-only below), folded into the existing nav row instead of
          its own row — a separate row (above the icon, then below the
          button) either collided with the icon or added enough height to
          shift the button out of its reference-matched position; the dots
          alone need no extra vertical budget here (PO review). */}
      <div className="ck-items__nav">
        {stepIndex > 0 ? (
          <button type="button" className="ck-items__nav-btn" onClick={goBack}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> Back
          </button>
        ) : (
          <span />
        )}
        <div className="ck-items__dots">
          <span className="sr-only">
            Item {stepIndex + 1} of {stepKeys.length}
          </span>
          {stepKeys.map((key, i) => (
            <span key={key} className={i === stepIndex ? "is-current" : undefined} aria-hidden="true" />
          ))}
        </div>
        {!alreadyDone ? (
          <button type="button" className="ck-items__nav-btn" onClick={goForward}>
            Skip
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
