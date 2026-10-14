import { useEffect, useRef, useState } from "react";
import { Button, Notice, useToast } from "@admitto/ui";
import { unarchiveEvent } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { formatEventDateTime, formatUtcDateTime } from "../utils/event-dates.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import "./archived-event-notice.css";

interface ArchivedEventNoticeProps {
  event: EventDto;
  refreshEvent: () => Promise<boolean>;
}

/** The one place an archived event says so: a warning bar on top of every page of the event, with
 * Restore for a superadmin. Screens and panels of an archived event show it by their locked controls
 * and add no archived line of their own. One event, one notice: a different `event.id` is a new
 * instance (the shell keys it), so a restore still in flight for the previous event never touches
 * the next one. */
export function ArchivedEventNotice({ event, refreshEvent }: Readonly<ArchivedEventNoticeProps>) {
  const { addToast } = useToast();
  const { assignments } = useAuth();
  // Unarchiving is a superadmin-only API (POST /events/:id/unarchive), so only they get the button.
  const canRestore = isSuperadmin(assignments);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const currentEventIdRef = useRef<string | null>(event.id);

  useEffect(() => {
    currentEventIdRef.current = event.id;
    return () => {
      currentEventIdRef.current = null;
    };
  }, [event.id]);

  const handleRestore = async () => {
    const restoringId = event.id;
    const stillHere = () => currentEventIdRef.current === restoringId;
    setRestoring(true);
    setRestoreError(null);
    try {
      await unarchiveEvent(restoringId);
      addToast("Event restored.", "success");
      if (!stillHere()) return;
      setRestoreOpen(false);
      // The read after a restore failed: the bar and the locked page are the old snapshot, and a second Restore
      // would be refused as "not archived". Say so instead of leaving a bar that looks like the restore failed.
      if (!(await refreshEvent()) && stillHere()) {
        addToast("The event is restored, but this page could not refresh. Reload the page to continue.", "warning");
      }
    } catch (err) {
      // Shown inside the still-open dialog (errorMessage), not a toast - the dialog's backdrop
      // sits above the toast stack, so a toast-only failure would be invisible behind it.
      if (stillHere()) setRestoreError(operatorApiErrorMessage(err, "Could not restore the event."));
    } finally {
      if (stillHere()) setRestoring(false);
    }
  };

  if (!event.archived_at) return null;

  return (
    <>
      <div className="archived-event-notice">
        <Notice
          variant="warning"
          icon="archive"
          action={
            canRestore ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<i className="ti ti-archive-off" aria-hidden="true" />}
                onClick={() => setRestoreOpen(true)}
              >
                Restore event
              </Button>
            ) : undefined
          }
        >
          This event is archived. Data is kept, but editing and check-in are locked. Archived on{" "}
          {event.archived_by_timezone
            ? formatEventDateTime(event.archived_at, event.archived_by_timezone)
            : formatUtcDateTime(event.archived_at)}
          .{canRestore ? "" : " Ask a superadmin to restore it."}
        </Notice>
      </div>

      <ConfirmDialog
        open={restoreOpen}
        icon={<i className="ti ti-archive-off" />}
        title="Restore this event?"
        message={`"${event.title}" will become active again. Editing and check-in will be allowed, and it will show up in default event lists.`}
        confirmLabel="Restore event"
        loading={restoring}
        errorMessage={restoreError}
        onConfirm={() => void handleRestore()}
        onCancel={() => {
          if (!restoring) {
            setRestoreOpen(false);
            setRestoreError(null);
          }
        }}
      />
    </>
  );
}
