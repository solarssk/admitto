import { createContext, useContext, useState, type Dispatch, type SetStateAction } from "react";

export interface InlineAccordionApi {
  openId: string | null;
  setOpenId: Dispatch<SetStateAction<string | null>>;
}

/** Provided by `FiltersMenu` around its own panel body - lets every `panelMode="inline"`
 * `SearchableSelect`/`MultiSelect` inside one filter panel share a single "which row is open"
 * slot, so opening one collapses whichever other row was open instead of stacking several
 * expanded lists at once (PO report, design mockup). Consumers outside a `FiltersMenu` panel
 * (or one not yet updated to provide it) see `null` here and fall back to their own local open
 * state - this is an enhancement, not a requirement, for `panelMode="inline"`. */
export const InlineAccordionContext = createContext<InlineAccordionApi | null>(null);

/** Shared `panelMode="inline"` open-state for `SearchableSelect`/`MultiSelect` - a plain local
 * toggle when `enabled` is false (floating mode ignores this return value entirely) or when no
 * `InlineAccordionContext` wraps this field, otherwise a slot in the shared accordion keyed by
 * `id` so opening this field collapses whichever sibling field was open. */
export function useInlineOpenState(
  id: string,
  enabled: boolean,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const accordion = useContext(InlineAccordionContext);
  const [localOpen, setLocalOpen] = useState(false);
  if (!enabled || !accordion) return [localOpen, setLocalOpen];
  const open = accordion.openId === id;
  const setOpen: Dispatch<SetStateAction<boolean>> = (updater) => {
    accordion.setOpenId((current) => {
      const wasOpen = current === id;
      const next = typeof updater === "function" ? (updater as (prev: boolean) => boolean)(wasOpen) : updater;
      return next ? id : null;
    });
  };
  return [open, setOpen];
}

export interface PanelOpenState {
  isInline: boolean;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}

/** Resolves `panelMode` to the open/setOpen pair SearchableSelect/MultiSelect actually render
 * with - floating mode defers entirely to the given `useDropdownMenu` state, inline mode to
 * `useInlineOpenState` above. Consolidates what would otherwise be 3 separate `isInline ? ... :
 * ...` ternaries repeated in both components. */
export function usePanelOpenState(
  dropdown: { open: boolean; setOpen: Dispatch<SetStateAction<boolean>> },
  id: string,
  panelMode: "floating" | "inline",
): PanelOpenState {
  const isInline = panelMode === "inline";
  const [inlineOpen, setInlineOpen] = useInlineOpenState(id, isInline);
  if (isInline) return { isInline, open: inlineOpen, setOpen: setInlineOpen };
  return { isInline, open: dropdown.open, setOpen: dropdown.setOpen };
}
