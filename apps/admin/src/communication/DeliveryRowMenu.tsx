import type { DeliveryDto } from "../api/types.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../components/ArchivedGuard.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import "./delivery-row-menu.css";

export interface DeliveryRowMenuProps {
  row: DeliveryDto;
  onViewSentMessage: (row: DeliveryDto) => void;
  onViewDetails: (row: DeliveryDto) => void;
  /** Only offered for a bounced row, and only when the caller supplies both - the Attendee
   * Detail page's own "Delivery history" card reuses this same menu without them, since it
   * already has its own page-level "Resend ticket" action. */
  onResend?: (row: DeliveryDto) => void;
  onDismiss?: (row: DeliveryDto) => void;
  /** True once Resend or Dismiss has already been used for this row (the caller tracks this,
   * keyed by row id) - greys out both actions instead of leaving them clickable forever, since
   * the row's own `status` stays "bounced" permanently (it's a historical record) even after the
   * attendee's bounce is actually resolved one way or the other. Shown disabled rather than
   * hidden, so it stays visible that the row was already acted on. */
  bounceResolved?: boolean;
  /** True while a Resend/Dismiss request for this row is in flight - same grey-out as
   * `bounceResolved`, so the operator cannot reopen the menu and fire a second attempt before
   * the first response lands. */
  bouncePending?: boolean;
  /** The event is archived: Resend and Dismiss are writes the server refuses then, so both are
   * off (with the standard archived reason) instead of failing on click. */
  archived?: boolean;
}

/** Per-row "..." menu for a delivery: "View sent message" / "View delivery details". Shared
 * between the Communication tab's Delivery log table/cards and the Attendee Detail page's own
 * "Delivery history" card - lives in its own file (rather than inlined in DeliveryLogTable.tsx)
 * purely because of that second consumer. Neither consumer needs an "Open attendee" item here:
 * the log table's recipient name is itself a link to the attendee's profile now, and the
 * Attendee Detail card is already on that attendee's own page.
 *
 * The panel is `position: fixed`, placed by `useDropdownMenu` (right-aligned to the trigger,
 * flipped above it and kept inside the viewport) - NOT portaled to document.body. A plain
 * `position: absolute` panel used to inflate `.communication-table-wrap`'s `overflow: auto`
 * instead of floating over it whenever it extended past the table's edge (verified live:
 * switching to `position: fixed` alone, no portal, already stops that - a fixed-position
 * descendant's containing block is the viewport rather than the nearest scrolling ancestor, as
 * long as no ancestor sets transform/filter/contain/will-change, which none here does). Keeping
 * the panel a normal DOM child (instead of portaling) also means useDropdownMenu's own
 * outside-click detection (DOM-containment via rootRef) keeps working unmodified. */
export function DeliveryRowMenu({
  row,
  onViewSentMessage,
  onViewDetails,
  onResend,
  onDismiss,
  bounceResolved = false,
  bouncePending = false,
  archived = false,
}: Readonly<DeliveryRowMenuProps>) {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
  });
  // A name with no id is a historical snapshot of a template that was deleted. Passing
  // `undefined` to the resend endpoint would select the current default template instead.
  const canResend = row.template_id !== null || row.template_name === null;
  const bounceActionsLocked = archived || bounceResolved || bouncePending;
  let bounceActionsTitle: string | undefined;
  if (archived) bounceActionsTitle = ARCHIVED_ACTION_TOOLTIP;
  else if (bounceResolved) bounceActionsTitle = "Already handled";
  else if (bouncePending) bounceActionsTitle = "Working…";
  return (
    <div className="delivery-row-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="at-iconbtn at-iconbtn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${row.attendee_name}'s message`}
        onClick={() => setOpen((o) => !o)}
      >
        <i className="ti ti-dots-vertical" aria-hidden="true" />
      </button>
      {open && (
        <div className="delivery-row-menu__panel" role="menu" ref={panelRef} style={panelStyle}>
          <button
            type="button"
            role="menuitem"
            className="delivery-row-menu__item"
            onClick={() => {
              setOpen(false);
              onViewSentMessage(row);
            }}
          >
            <i className="ti ti-mail-opened" aria-hidden="true" />{" "}
            View sent message
          </button>
          <button
            type="button"
            role="menuitem"
            className="delivery-row-menu__item"
            onClick={() => {
              setOpen(false);
              onViewDetails(row);
            }}
          >
            <i className="ti ti-list-details" aria-hidden="true" />{" "}
            View delivery details
          </button>
          {row.status === "bounced" && canResend && onResend && (
            <button
              type="button"
              role="menuitem"
              className="delivery-row-menu__item"
              disabled={bounceActionsLocked}
              title={bounceActionsTitle}
              onClick={() => {
                setOpen(false);
                onResend(row);
              }}
            >
              <i className="ti ti-send" aria-hidden="true" />{" "}
              Resend
            </button>
          )}
          {row.status === "bounced" && onDismiss && (
            <button
              type="button"
              role="menuitem"
              className="delivery-row-menu__item"
              disabled={bounceActionsLocked}
              title={bounceActionsTitle}
              onClick={() => {
                setOpen(false);
                onDismiss(row);
              }}
            >
              <i className="ti ti-mail-off" aria-hidden="true" />{" "}
              Dismiss bounce
            </button>
          )}
        </div>
      )}
    </div>
  );
}
