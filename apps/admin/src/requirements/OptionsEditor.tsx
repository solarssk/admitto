import { useEffect, useRef, useState } from "react";
import { IconButton } from "@admitto/ui";
import "./options-editor.css";

export type OptionRow = { key: string; text: string; originalText: string };

/** Row state for a fresh field (create mode, or an option the operator just added) - no
 * usage data applies since nothing has been saved against it yet. */
export function newOptionRow(key: string, text = ""): OptionRow {
  return { key, text, originalText: "" };
}

/** Row state seeded from a saved field's current options - `originalText` anchors the
 * usage-count lookup and the rename-warning/dirty comparison even as `text` is edited. */
export function optionRowsFromOptions(options: string[] | null): OptionRow[] {
  return (options ?? []).map((text, i) => ({ key: `row-${i}`, text, originalText: text }));
}

function usageOf(usageCounts: Record<string, number> | null, originalText: string): number {
  if (!usageCounts || !originalText) return 0;
  return usageCounts[originalText] ?? 0;
}

export interface OptionsEditorProps {
  rows: OptionRow[];
  /** null while the usage-count fetch is still in flight - delete stays disabled and rename
   * warnings stay hidden until it resolves, rather than treating "not loaded yet" as "unused". */
  usageCounts: Record<string, number> | null;
  disabled?: boolean;
  onChange: (rows: OptionRow[]) => void;
}

/** Structured editor for a select field's option list - replaces the old plain "one per line"
 * textarea. Each row shows how many attendees currently have that value, warns inline when
 * renaming a value that's in use, and turns delete into an in-row confirm instead of removing
 * silently. Reordering is drag (mouse/touch/pen via Pointer Events - no DnD library in this
 * repo) with an Up/Down-arrow keyboard equivalent on the same handle. */
export function OptionsEditor({ rows, usageCounts, disabled, onChange }: Readonly<OptionsEditorProps>) {
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const nextRowIdRef = useRef(rows.length);

  function updateRow(key: string, text: string) {
    onChange(rows.map((r) => (r.key === key ? { ...r, text } : r)));
  }

  function removeRow(key: string) {
    setConfirmingKey(null);
    onChange(rows.filter((r) => r.key !== key));
  }

  function handleDeleteClick(row: OptionRow) {
    if (usageOf(usageCounts, row.originalText) > 0) setConfirmingKey(row.key);
    else removeRow(row.key);
  }

  function addRow() {
    const key = `new-${nextRowIdRef.current++}`;
    onChange([...rows, newOptionRow(key)]);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLInputElement>(`input[data-key="${key}"]`)?.focus();
    });
  }

  function moveRow(key: string, delta: 1 | -1) {
    const idx = rowsRef.current.findIndex((r) => r.key === key);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= rowsRef.current.length) return;
    const next = rowsRef.current.slice();
    next.splice(idx, 1);
    next.splice(target, 0, rowsRef.current[idx]!);
    onChangeRef.current(next);
  }

  // Drag-to-reorder via native Pointer Events (mouse, touch, and pen through one code path).
  // Siblings shift visually (translateY, imperative DOM writes) to preview the drop slot while
  // dragging; the array itself only reorders once, on pointerup - avoids re-rendering React on
  // every pointermove and keeps this independent of whatever `rows`/`onChange` identity the
  // parent re-creates each render (read via refs, not captured in the effect's closure).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    let drag: {
      pointerId: number;
      key: string;
      row: HTMLElement;
      startIndex: number;
      currentIndex: number;
      startY: number;
      step: number;
      startIndexOf: Map<string, number>;
    } | null = null;

    function applyDragVisuals() {
      if (!drag || !list) return;
      const activeDrag = drag;
      for (const el of list.querySelectorAll<HTMLElement>(".options-editor__row")) {
        const key = el.dataset.key;
        if (!key || key === activeDrag.key) continue;
        const originalIndex = activeDrag.startIndexOf.get(key);
        if (originalIndex === undefined) continue;
        let offset = 0;
        if (activeDrag.startIndex < activeDrag.currentIndex && originalIndex > activeDrag.startIndex && originalIndex <= activeDrag.currentIndex) {
          offset = -1;
        } else if (activeDrag.startIndex > activeDrag.currentIndex && originalIndex < activeDrag.startIndex && originalIndex >= activeDrag.currentIndex) {
          offset = 1;
        }
        el.style.transform = offset ? `translateY(${offset * activeDrag.step}px)` : "";
      }
    }

    function resetVisuals() {
      for (const el of list?.querySelectorAll<HTMLElement>(".options-editor__row") ?? []) {
        el.style.transform = "";
      }
    }

    function onPointerDown(e: PointerEvent) {
      const handle = (e.target as HTMLElement).closest<HTMLElement>(".options-editor__handle");
      if (!handle || !list) return;
      const row = handle.closest<HTMLElement>(".options-editor__row");
      const key = row?.dataset.key;
      if (!row || !key) return;
      const startIndex = rowsRef.current.findIndex((r) => r.key === key);
      if (startIndex === -1) return;
      const allRows = list.querySelectorAll<HTMLElement>(".options-editor__row");
      const step = allRows.length > 1 ? allRows[1]!.offsetTop - allRows[0]!.offsetTop : row.offsetHeight + 6;
      drag = {
        pointerId: e.pointerId,
        key,
        row,
        startIndex,
        currentIndex: startIndex,
        startY: e.clientY,
        step,
        startIndexOf: new Map(rowsRef.current.map((r, i) => [r.key, i])),
      };
      row.classList.add("options-editor__row--dragging");
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function onPointerMove(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.pointerId || !list) return;
      const deltaY = e.clientY - drag.startY;
      drag.row.style.transform = `translateY(${deltaY}px)`;

      const listRect = list.getBoundingClientRect();
      const edge = 26;
      if (e.clientY - listRect.top < edge) list.scrollTop -= 9;
      else if (listRect.bottom - e.clientY < edge) list.scrollTop += 9;

      const rawIndex = drag.startIndex + Math.round(deltaY / drag.step);
      const targetIndex = Math.max(0, Math.min(rowsRef.current.length - 1, rawIndex));
      if (targetIndex !== drag.currentIndex) {
        drag.currentIndex = targetIndex;
        applyDragVisuals();
      }
    }

    function endDrag(commit: boolean) {
      if (!drag) return;
      const { row, startIndex, currentIndex } = drag;
      row.classList.remove("options-editor__row--dragging");
      row.style.transform = "";
      resetVisuals();
      drag = null;
      if (commit && currentIndex !== startIndex) {
        const next = rowsRef.current.slice();
        const [moved] = next.splice(startIndex, 1);
        next.splice(currentIndex, 0, moved!);
        onChangeRef.current(next);
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (drag && e.pointerId === drag.pointerId) endDrag(true);
    }
    function onPointerCancel(e: PointerEvent) {
      if (drag && e.pointerId === drag.pointerId) endDrag(false);
    }

    list.addEventListener("pointerdown", onPointerDown);
    list.addEventListener("pointermove", onPointerMove);
    list.addEventListener("pointerup", onPointerUp);
    list.addEventListener("pointercancel", onPointerCancel);
    return () => {
      list.removeEventListener("pointerdown", onPointerDown);
      list.removeEventListener("pointermove", onPointerMove);
      list.removeEventListener("pointerup", onPointerUp);
      list.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  return (
    <div className="options-editor">
      <div className="options-editor__list" ref={listRef}>
        {rows.map((row) => {
          const usage = usageOf(usageCounts, row.originalText);
          const trimmed = row.text.trim();
          const renamed = trimmed !== row.originalText && trimmed !== "" && usage > 0;
          const usageKnown = usageCounts !== null;

          if (confirmingKey === row.key) {
            return (
              <div className="options-editor__row" data-key={row.key} key={row.key}>
                <div className="options-editor__confirm">
                  <span>
                    Remove &ldquo;{row.originalText}&rdquo;? {usage} {usage === 1 ? "attendee" : "attendees"}{" "}
                    currently have this value, so it will show as unset for them.
                  </span>
                  <div className="options-editor__confirm-actions">
                    <button type="button" className="options-editor__confirm-btn" onClick={() => setConfirmingKey(null)}>
                      Keep
                    </button>
                    <button
                      type="button"
                      className="options-editor__confirm-btn options-editor__confirm-btn--danger"
                      onClick={() => removeRow(row.key)}
                    >
                      Remove anyway
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              className={`options-editor__row${renamed ? " options-editor__row--warning" : ""}`}
              data-key={row.key}
              key={row.key}
            >
              <button
                type="button"
                className="options-editor__handle"
                aria-label="Drag to reorder. With focus, use the up and down arrow keys instead."
                disabled={disabled}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    moveRow(row.key, -1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    moveRow(row.key, 1);
                  }
                }}
              >
                <i className="ti ti-grip-vertical" aria-hidden="true" />
              </button>
              <input
                className="at-input options-editor__input"
                data-key={row.key}
                value={row.text}
                disabled={disabled}
                aria-label="Option text"
                onChange={(e) => updateRow(row.key, e.target.value)}
              />
              <span className={`options-editor__usage${usage === 0 ? " options-editor__usage--unused" : ""}`}>
                {!usageKnown ? "…" : usage > 0 ? `${usage} ${usage === 1 ? "attendee" : "attendees"}` : "Unused"}
              </span>
              <IconButton
                label="Remove option"
                icon={<i className="ti ti-x" />}
                disabled={disabled || !usageKnown}
                onClick={() => handleDeleteClick(row)}
              />
              {renamed && (
                <div className="options-editor__warning">
                  <i className="ti ti-alert-triangle" aria-hidden="true" /> {usage} {usage === 1 ? "attendee" : "attendees"}{" "}
                  currently {usage === 1 ? "has" : "have"} &ldquo;{row.originalText}&rdquo;. Renaming creates a new
                  value, so they will need to be reassigned.
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="options-editor__add" disabled={disabled} onClick={addRow}>
        + Add option
      </button>
    </div>
  );
}
