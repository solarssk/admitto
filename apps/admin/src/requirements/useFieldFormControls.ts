import { useEffect, useRef, type RefObject } from "react";
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
  /** Read the list again: after a move that was refused, which also puts the rows back where the server has them. When it
   * returns the read, the line of requests waits for it, so that a request queued behind the refused move does not land under it
   * and is not put back by an answer that was read before it. */
  readonly onChanged: () => void | Promise<void>;
  /** Shows a move at once, and what the server answers to a move or a switch, on the list the host has now; read again
   * (`onChanged`) after the answer when there is none. */
  readonly onUpdated?: (change: FieldsChange) => void;
  /** The card, to find the arrow that gets the focus back after a move. */
  readonly rootRef: RefObject<HTMLElement | null>;
}

/**
 * The rows in the order of `ids`, each with its place as its `display_order`: what a move shows at once, before the server
 * has answered. A row that `ids` does not name (one added meanwhile) goes last, and a name that is not a row is left out.
 */
function inOrder(ids: readonly string[]): FieldsChange {
  return (current) => {
    const byId = new Map(current.map((row) => [row.id, row]));
    const named = new Set(ids);
    const placed = ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
    return [...placed, ...current.filter((row) => !named.has(row.id))].map((row, place) => ({ ...row, display_order: place }));
  };
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
 * What the Fields tab's card does besides listing, adding, editing and deleting fields: an "On the form" switch for each field
 * and arrows that put a field one place up or down.
 *
 * A move shows its new order at once (`inOrder`) and its request follows. A reorder sends the whole list, and the answer of a
 * reorder or of a switch replaces rows, so every request of the card goes through one line, one at a time, in the order the
 * controls were pressed: a switch pressed during a move waits for it, and a move pressed during a switch waits for the switch,
 * so neither puts back what the other has just changed. The switch shows its busy mark from the click, on its own row only, also
 * while it waits, and an arrow shows its own while its move is out. Only the answer of the last move that is out is shown
 * (`inOrderOf`): an earlier one would put back a place that the next move has taken. It takes only the order from the answer,
 * so an edit or a delete made on the card meanwhile is not undone, and the answer of a switch keeps the place its row has on the
 * screen. A move that the server refuses puts the rows back by reading the list again (`onChanged`), and the moves queued behind
 * it are dropped: they were made from the order it had put on the screen.
 */
export function useFieldFormControls({ eventId, fields, onChanged, onUpdated, rootRef }: FieldFormControlsOptions) {
  const { addToast } = useToast();
  const { ids: switching, start: startSwitch, finish: finishSwitch } = useInFlightIds();
  const { ids: moving, start: startMove, finish: finishMove } = useInFlightIds();
  // The line that every request of the card goes through: the last task in it, or null while it is empty.
  const lineRef = useRef<Promise<void> | null>(null);
  // Raised when a move is refused: the moves queued behind it are dropped.
  const epochRef = useRef(0);
  // How many moves are queued or on their way.
  const movesOutRef = useRef(0);
  // The arrow that gets the focus back once the rows are in their new order.
  const refocusRef = useRef<{ fieldId: string; direction: MoveDirection } | null>(null);

  function show(change: FieldsChange) {
    if (onUpdated) onUpdated(change);
    else void onChanged();
  }

  /** Runs `task` when everything asked before it has finished, and at once when nothing is out. A task catches its own
   * failures, so the line never stops. */
  function inLine(task: () => Promise<void>): Promise<void> {
    const previous = lineRef.current;
    const run = previous ? previous.then(task) : task();
    const last: Promise<void> = run
      .catch(() => undefined)
      .finally(() => {
        if (lineRef.current === last) lineRef.current = null;
      });
    lineRef.current = last;
    return run;
  }

  async function toggleOnForm(field: EventCustomFieldDto): Promise<void> {
    if (!startSwitch(field.id)) return;
    await inLine(async () => {
      try {
        const updated = await updateEventCustomField(eventId, field.id, { show_on_form: !field.show_on_form });
        // A move made while this was out may be on the screen already, with a newer place for the row than the answer has.
        show((current) => current.map((item) => (item.id === updated.id ? { ...updated, display_order: item.display_order } : item)));
        addToast(updated.show_on_form ? "Added to the form" : "Removed from the form", "success");
      } catch (err) {
        addToast(operatorApiErrorMessage(err, "Failed to update the field."), "error");
      } finally {
        finishSwitch(field.id);
      }
    });
  }

  async function move(index: number, direction: MoveDirection): Promise<void> {
    const field = fields[index];
    const target = direction === "up" ? index - 1 : index + 1;
    if (!field || target < 0 || target >= fields.length) return;
    const key = moveKey(field.id, direction);
    if (!startMove(key)) return;
    const ids = fields.map((item) => item.id);
    ids.splice(index, 1);
    ids.splice(target, 0, field.id);
    // A host that has no way to show a change reads the list after the answer instead.
    refocusRef.current = { fieldId: field.id, direction };
    onUpdated?.(inOrder(ids));
    const epoch = epochRef.current;
    movesOutRef.current += 1;
    await inLine(async () => {
      try {
        if (epoch !== epochRef.current) return;
        const items = await reorderEventCustomFields(eventId, ids);
        if (movesOutRef.current === 1) show(inOrderOf(items));
      } catch (err) {
        epochRef.current += 1;
        if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "stale_write")) {
          addToast("The fields changed since this list was loaded, so it was refreshed. Move the field again.", "warning");
        } else {
          addToast(operatorApiErrorMessage(err, "Failed to move the field."), "error");
        }
        // The rows went to their new places before the server answered; reading the list puts them where it has them.
        await onChanged();
      } finally {
        movesOutRef.current -= 1;
        finishMove(key);
      }
    });
  }

  // The rows are in a new order, and a browser drops the focus of a button whose row has been moved in the page. The arrow
  // that was pressed gets it back, or, when its row is now at the end of the list, the other arrow of the same row. The end
  // is read from the order, not from the arrow being off: while its move is out the pressed arrow is busy, not off, and it
  // turns off when the answer is in, with the focus on it.
  useEffect(() => {
    const pressed = refocusRef.current;
    if (!pressed) return;
    refocusRef.current = null;
    const place = fields.findIndex((row) => row.id === pressed.fieldId);
    const atEnd = pressed.direction === "up" ? place <= 0 : place === fields.length - 1;
    const otherArrow = pressed.direction === "up" ? "down" : "up";
    const direction = atEnd ? otherArrow : pressed.direction;
    const arrows = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[data-reorder]") ?? []);
    arrows.find((button) => button.dataset.reorder === moveKey(pressed.fieldId, direction))?.focus();
  }, [fields, rootRef]);

  return { switching, moving, toggleOnForm, move };
}
