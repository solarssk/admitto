import { useEffect, useRef, useState, type RefObject } from "react";
import { useToast } from "@admitto/ui";
import { ApiError, reorderEventCustomFields, updateEventCustomField } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventCustomFieldDto } from "../api/types.js";
import { useInFlightIds } from "../hooks/useInFlightIds.js";

export type FieldsChange = (fields: EventCustomFieldDto[]) => EventCustomFieldDto[];
export type MoveDirection = "up" | "down";

/** What an arrow is called while its reorder is on its way, and in the `data-reorder` attribute that finds it again. */
export function moveKey(fieldId: string, direction: MoveDirection): string {
  return `${fieldId}:${direction}`;
}

interface FieldFormControlsOptions {
  readonly eventId: string;
  /** The event's fields as the card shows them, in order: a move sends the ids of all of them. */
  readonly fields: readonly EventCustomFieldDto[];
  /** Read the list again: after a move that was refused because the list is out of date. */
  readonly onChanged: () => void;
  /** Shows what the server has just answered on the list the host has now; read again (`onChanged`) when there is none. */
  readonly onUpdated?: (change: FieldsChange) => void;
  /** The card, to find the arrow that gets the focus back after a move. */
  readonly rootRef: RefObject<HTMLElement | null>;
}

/**
 * The order the server has just answered, put on the rows the host has now. A move takes only the order from the answer:
 * a field edited or deleted while the move was on its way stays as it is now, and one added meanwhile, which the answer
 * does not know, goes last.
 */
function inOrderOf(answer: readonly EventCustomFieldDto[]): FieldsChange {
  return (current) => {
    const byId = new Map(current.map((row) => [row.id, row]));
    const answered = new Set(answer.map((item) => item.id));
    const placed = answer.flatMap((item) => {
      const row = byId.get(item.id);
      return row ? [{ ...row, display_order: item.display_order }] : [];
    });
    return [...placed, ...current.filter((row) => !answered.has(row.id))];
  };
}

/**
 * What the Registration page's card does besides what the Requirements card does: an "On the form" switch for each field
 * and arrows that put a field one place up or down. A switch has a request of its own for each field; reorders run one at a
 * time, because a reorder sends the whole list and a second one made from the list before the first has landed would put
 * the first back. For the same reason a switch and a reorder do not run together: the answer of a reorder is the whole list,
 * and it would put back a switch whose request is still out (or the other way round). The one that comes second is ignored.
 * The answer is shown at once (`onUpdated`), so nothing is read again except after a refused move. A move shows only the
 * order of its answer (`inOrderOf`), so an edit or a delete made on the card while the move was out is not undone.
 */
export function useFieldFormControls({ eventId, fields, onChanged, onUpdated, rootRef }: FieldFormControlsOptions) {
  const { addToast } = useToast();
  const { ids: switching, start: startSwitch, finish: finishSwitch } = useInFlightIds();
  // The arrow whose reorder is on its way; the ref is the same fact, read before the next render can have it.
  const [moving, setMoving] = useState<string | null>(null);
  const movingRef = useRef(false);
  // How many switch requests are out, read before the next render can have it.
  const switchesOutRef = useRef(0);
  // The arrow that gets the focus back once the rows are in their new order.
  const refocusRef = useRef<{ fieldId: string; direction: MoveDirection } | null>(null);

  function show(change: FieldsChange) {
    if (onUpdated) onUpdated(change);
    else onChanged();
  }

  async function toggleOnForm(field: EventCustomFieldDto) {
    if (movingRef.current || !startSwitch(field.id)) return;
    switchesOutRef.current += 1;
    try {
      const updated = await updateEventCustomField(eventId, field.id, { show_on_form: !field.show_on_form });
      show((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      addToast(updated.show_on_form ? "Added to the form" : "Removed from the form", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to update the field."), "error");
    } finally {
      switchesOutRef.current -= 1;
      finishSwitch(field.id);
    }
  }

  async function move(index: number, direction: MoveDirection) {
    const field = fields[index];
    const target = direction === "up" ? index - 1 : index + 1;
    if (!field || target < 0 || target >= fields.length || movingRef.current || switchesOutRef.current > 0) return;
    movingRef.current = true;
    const key = moveKey(field.id, direction);
    setMoving(key);
    const ids = fields.map((item) => item.id);
    ids.splice(index, 1);
    ids.splice(target, 0, field.id);
    try {
      const items = await reorderEventCustomFields(eventId, ids);
      refocusRef.current = { fieldId: field.id, direction };
      show(inOrderOf(items));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "stale_write")) {
        addToast("The fields changed since this list was loaded, so it was refreshed. Move the field again.", "warning");
        onChanged();
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to move the field."), "error");
      }
    } finally {
      movingRef.current = false;
      setMoving(null);
    }
  }

  // The rows are in a new order, and a browser drops the focus of a button whose row has been moved in the page. The arrow
  // that was pressed gets it back, or, when its row is now at the end of the list, the other arrow of the same row.
  useEffect(() => {
    const pressed = refocusRef.current;
    if (!pressed) return;
    refocusRef.current = null;
    const arrows = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[data-reorder]") ?? []);
    const arrow = (direction: MoveDirection) =>
      arrows.find((button) => button.dataset.reorder === moveKey(pressed.fieldId, direction) && !button.disabled);
    (arrow(pressed.direction) ?? arrow(pressed.direction === "up" ? "down" : "up"))?.focus();
  }, [fields, rootRef]);

  return { switching, moving, toggleOnForm, move };
}
