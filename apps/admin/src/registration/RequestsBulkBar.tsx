import { Button } from "@admitto/ui";
import { ARCHIVED_ACTION_TOOLTIP, ArchivedGuard, isEventArchived, type ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { pluralize } from "../utils/pluralize.js";
import type { selectionActions } from "./registrationDecisions.js";
import type { BusyDecision } from "./useRegistrationDecisions.js";
import "../attendees/attendees.css";

type Actions = ReturnType<typeof selectionActions>;

const requests = (count: number): string => `${count} ${pluralize(count, "request")}`;

const NOTHING_TO_ACCEPT = "None of the selected requests can be accepted: they are accepted already, or wait for the guest to confirm the address.";
const NOTHING_TO_REJECT = "None of the selected requests can be rejected: they are decided already, or wait for the guest to confirm the address.";
const NOTHING_TO_SEND = "None of the selected requests has an email that failed for good.";

interface BulkProps {
  actions: Actions;
  event: ArchivedGuardEvent;
  busy: BusyDecision;
  onReject: () => void;
  onRetryMail: () => void;
  onDelete: () => void;
}

/** Why a decision cannot be made right now, for the tooltip of its disabled button: the event is archived, or nothing selected fits. */
function unavailable(archived: boolean, anyFits: boolean, nothingFits: string): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  return anyFits ? undefined : nothingFits;
}

/**
 * The actions beyond the two decisions, as a menu (like the Attendees list's): Reject on a narrow screen, where it does not fit
 * beside the count and Accept, Send email again, and Delete, which takes one more click to reach on purpose.
 */
function BulkMoreMenu({ actions, event, busy, isDesktop, onReject, onRetryMail, onDelete }: Readonly<BulkProps & { isDesktop: boolean }>) {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({ align: "end" });
  const archived = isEventArchived(event);
  return (
    <div className="more-actions-menu" ref={rootRef}>
      <Button ref={triggerRef} type="button" variant="ghost" hasMenu aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {isDesktop ? "More actions" : "More"}
      </Button>
      {open && (
        <div className="more-actions-menu__panel at-scroll" role="menu" ref={panelRef} style={panelStyle}>
          {!isDesktop && (
            <MoreActionsMenuItem
              icon="x"
              label="Reject"
              hint={`Turn down ${requests(actions.reject.length)}`}
              disabled={archived || actions.reject.length === 0}
              tooltip={unavailable(archived, actions.reject.length > 0, NOTHING_TO_REJECT)}
              onClick={() => {
                setOpen(false);
                onReject();
              }}
            />
          )}
          <MoreActionsMenuItem
            icon="mail-forward"
            label="Send email again"
            loading={busy === "retry"}
            hint={actions.retry.length > 0 ? `The last email failed for ${requests(actions.retry.length)}` : "No failed email among the selected"}
            disabled={archived || busy === "retry" || actions.retry.length === 0}
            tooltip={unavailable(archived, actions.retry.length > 0, NOTHING_TO_SEND)}
            onClick={() => {
              setOpen(false);
              onRetryMail();
            }}
          />
          <hr className="more-actions-menu__divider" />
          {/* Not archived-guarded: a request to delete personal data does not expire with the event. */}
          <MoreActionsMenuItem
            icon="trash"
            variant="danger"
            label="Delete requests"
            hint="For good. An accepted request erases its attendee too."
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The count of the selected requests and what can be done with them, in the slot of the toolbar (as the Attendees list does it, on the
 * same classes): Accept and Reject decide, and the menu holds Send email again and Delete. A button is off, with its reason in a tooltip,
 * when none of the selected requests fits it, and the two decisions are off on an archived event (deleting is not: a request to delete
 * personal data does not expire with the event).
 */
export function RequestsBulkBar({
  count,
  onClear,
  onAccept,
  ...rest
}: Readonly<BulkProps & { count: number; onClear: () => void; onAccept: () => void }>) {
  const { actions, event, busy, onReject } = rest;
  const isDesktop = useIsDesktop();
  return (
    <div className="attendees-bulkbar">
      <div className="attendees-bulkbar__info">
        <span className="attendees-bulkbar__count">
          <strong>{count}</strong> selected
        </span>
        <button type="button" className="attendees-bulkbar__clear" onClick={onClear} aria-label="Clear selection">
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>
      <div className="attendees-bulkbar__actions">
        <span className="attendees-bulkbar__sep" aria-hidden="true" />
        <ArchivedGuard
          event={event}
          reasonId="requests-bulk-accept-reason"
          disabled={actions.accept.length === 0}
          tooltip={unavailable(false, actions.accept.length > 0, NOTHING_TO_ACCEPT)}
        >
          {(guard) => (
            <Button variant="ghost" icon={<i className="ti ti-check" aria-hidden="true" />} {...guard} loading={busy === "accept"} onClick={onAccept}>
              Accept
            </Button>
          )}
        </ArchivedGuard>
        {isDesktop && (
          <ArchivedGuard
            event={event}
            reasonId="requests-bulk-reject-reason"
            disabled={actions.reject.length === 0}
            tooltip={unavailable(false, actions.reject.length > 0, NOTHING_TO_REJECT)}
          >
            {(guard) => (
              <Button variant="ghost" icon={<i className="ti ti-x" aria-hidden="true" />} {...guard} loading={busy === "reject"} onClick={onReject}>
                Reject
              </Button>
            )}
          </ArchivedGuard>
        )}
        <BulkMoreMenu {...rest} isDesktop={isDesktop} />
      </div>
    </div>
  );
}

