/** Shared trigger/panel className builders for SearchableSelect and MultiSelect - same
 * floating-vs-inline styling rules for both, kept in one place instead of copied twice. */

export function searchableSelectTriggerClassName(
  invalid: boolean | undefined,
  isInline: boolean,
  open: boolean,
): string {
  let className = "searchable-select__trigger";
  if (invalid) className += " searchable-select__trigger--invalid";
  if (isInline && open) className += " searchable-select__trigger--open";
  return className;
}

/** "inline" panelMode never flips upward (it's not a floating overlay, so there's nothing to
 * flip relative to) - only the floating case's own `openUpward` decides the modifier. */
export function searchableSelectPanelClassName(isInline: boolean, openUpward: boolean): string {
  if (isInline) return "searchable-select__panel searchable-select__panel--inline";
  return `searchable-select__panel${openUpward ? " searchable-select__panel--up" : ""}`;
}
