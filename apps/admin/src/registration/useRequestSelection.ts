import { useCallback, useEffect, useMemo, useState } from "react";
import type { RegistrationListItemDto } from "../api/types.js";

/** What the rows of a page need to draw their checkboxes. */
export interface RequestSelection {
  /** The selected requests that are on the page, in the order of the page. */
  rows: RegistrationListItemDto[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Every request of the page is selected (and the page has some). */
  allSelected: boolean;
  /** Selects the whole page, or none of it when it is selected already. */
  toggleAll: () => void;
  clear: () => void;
  /** Takes these requests out of the selection and leaves the others ticked: an action on one request does not undo the ticks of the rest. */
  drop: (ids: ReadonlySet<string>) => void;
}

/**
 * The requests ticked on the page, for the bulk bar. A selection is of one page of one query: `resetKey` names that (the page, its
 * size, the state, the age and the committed search), and another one starts with nothing ticked, in the render that sees it, so an
 * action can never be run on rows that are no longer there. A request that leaves the page (decided, deleted, or gone from the next
 * read) is dropped from the selection too.
 */
export function useRequestSelection(items: readonly RegistrationListItemDto[], resetKey: string): RequestSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setSelected(new Set());
  }

  useEffect(() => {
    setSelected((current) => {
      const onPage = new Set(items.map((row) => row.id));
      const kept = [...current].filter((id) => onPage.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [items]);

  const rows = useMemo(() => items.filter((row) => selected.has(row.id)), [items, selected]);
  const allSelected = items.length > 0 && rows.length === items.length;

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);
  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => setSelected(allSelected ? new Set() : new Set(items.map((row) => row.id))), [allSelected, items]);
  const clear = useCallback(() => setSelected(new Set()), []);
  const drop = useCallback((ids: ReadonlySet<string>) => setSelected((current) => new Set([...current].filter((id) => !ids.has(id)))), []);

  return { rows, isSelected, toggle, allSelected, toggleAll, clear, drop };
}
