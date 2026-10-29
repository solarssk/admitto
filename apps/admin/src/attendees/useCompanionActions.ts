import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@admitto/ui";
import { removeAttendeeCompanion, updateAttendeeCompanion } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AttendeeDetailDto } from "../api/types.js";
import { companionBody, companionProblem, type CompanionFormState } from "./companionForm.js";
import type { CustomDataFieldDef } from "./customData.js";

/** The attendee a change was asked for: the page checks that it is still the one on screen before it takes the answer. */
export interface CompanionTarget {
  eventId: string;
  attendeeId: string;
}

export interface CompanionActionsInput extends CompanionTarget {
  /** The questions about the companion, which the form is checked against. */
  fields: readonly CustomDataFieldDef[];
  /** The server answered a change with the attendee as it is now. */
  onChanged: (detail: AttendeeDetailDto, target: CompanionTarget) => void;
  /** The event turned out to be archived, which the page did not know: it reads the event again, so that everything locks. */
  onArchived: () => void;
  /** The guest was erased or has no companion any more, which the page did not know: it reads the attendee again. */
  onOutOfDate: () => void;
}

/** Said when the server refused a name or an answer that the form let through: the form knows less than the server does. */
const REFUSED_BY_SERVER =
  "The name or an answer was not accepted. A name cannot be a link or an address, and an answer has to be what its question takes.";

/**
 * What the Edit and Remove dialogs of a guest's companion do: the request, what it is busy with, and what to say when it fails. A
 * failure that is about the dialog (a name the server refuses, an archived event) is said in the dialog; one that says the page is out
 * of date (the guest was erased, or the companion removed, by someone else) closes the dialog, says so in a toast, and has the page read
 * again, because the card the dialog belongs to is about to go.
 */
export function useCompanionActions({ eventId, attendeeId, fields, onChanged, onArchived, onOutOfDate }: CompanionActionsInput) {
  const { addToast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // An answer that comes after the page moved on to another attendee is not for this one: nothing is said, nothing is applied.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const target = useCallback((): CompanionTarget => ({ eventId, attendeeId }), [eventId, attendeeId]);

  /** The failure of a change, said where it belongs. `inline` is the dialog's own place for it. */
  function fail(err: unknown, inline: (message: string) => void, fallback: string) {
    if (hasApiErrorCode(err, "attendee_erased") || hasApiErrorCode(err, "companion_not_found")) {
      addToast(operatorApiErrorMessage(err, fallback), "warning");
      setEditOpen(false);
      setRemoveOpen(false);
      onOutOfDate();
      return;
    }
    if (hasApiErrorCode(err, "event_archived")) onArchived();
    inline(hasApiErrorCode(err, "validation_failed") ? REFUSED_BY_SERVER : operatorApiErrorMessage(err, fallback));
  }

  async function save(form: CompanionFormState) {
    const problem = companionProblem(form, fields);
    if (problem) {
      setEditError(problem);
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const detail = await updateAttendeeCompanion(eventId, attendeeId, companionBody(form, fields));
      if (!alive.current) return;
      onChanged(detail, target());
      setEditOpen(false);
      addToast("Companion saved", "success");
    } catch (err) {
      if (alive.current) fail(err, setEditError, "Could not save the companion. Try again.");
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setRemoveError(null);
    try {
      const detail = await removeAttendeeCompanion(eventId, attendeeId);
      if (!alive.current) return;
      onChanged(detail, target());
      setRemoveOpen(false);
      addToast("Companion removed", "success");
    } catch (err) {
      if (alive.current) fail(err, setRemoveError, "Could not remove the companion. Try again.");
    } finally {
      if (alive.current) setRemoving(false);
    }
  }

  return {
    edit: {
      open: editOpen,
      saving,
      error: editError,
      show: () => {
        setEditError(null);
        setEditOpen(true);
      },
      // Escape, Cancel and a click outside do nothing while the request runs: the button that started it is the busy control.
      cancel: () => {
        if (!saving) setEditOpen(false);
      },
      save,
    },
    removal: {
      open: removeOpen,
      busy: removing,
      error: removeError,
      show: () => {
        setRemoveError(null);
        setRemoveOpen(true);
      },
      cancel: () => {
        if (!removing) setRemoveOpen(false);
      },
      confirm: remove,
    },
  };
}
