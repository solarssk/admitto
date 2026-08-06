import type { ReactNode } from "react";
import { Button, type ButtonSize } from "@admitto/ui";
import { useDropdownMenu } from "./useDropdownMenu.js";

interface FiltersMenuProps {
  readonly activeCount: number;
  readonly children: ReactNode;
  /** BEM "block" name for this instance's own page-scoped CSS (e.g. "attendees-filters-menu",
   * "reports-log-filters-menu") - `${className}__count`/`${className}__panel` derive the badge
   * and panel classes, matching the convention each page already hand-wrote before this was
   * extracted. Kept per-page rather than shared so each page's own visual sizing (e.g. Reports'
   * compact card-header trigger vs. Attendees' full-size toolbar trigger) stays independent. */
  readonly className: string;
  readonly size?: ButtonSize;
}

/** Single "Filters" trigger-button-plus-fieldset-panel, shared by the Attendees list's
 * FilterToolbar and the Reports admission log - both had their own copy of this exact
 * trigger/panel/badge/useDropdownMenu wiring before being extracted here. The panel's own
 * filter fields are passed as `children` rather than owned by this component, since each
 * caller's filters (and how many of them are "active") differ. */
export function FiltersMenu({ activeCount, children, className, size }: Readonly<FiltersMenuProps>) {
  const { open, setOpen, openUpward, rootRef, triggerRef, panelRef } = useDropdownMenu<
    HTMLButtonElement,
    HTMLFieldSetElement
  >();

  return (
    <div className={className} ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size={size}
        icon={<i className="ti ti-filter" aria-hidden="true" />}
        hasMenu
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Filters
        {activeCount > 0 && <span className={`${className}__count`}>{activeCount}</span>}
      </Button>
      {open && (
        // A native <fieldset> groups the fields below, not `role="menu"` (CodeRabbit review:
        // aria-haspopup="menu" previously advertised a menu useDropdownMenu couldn't find a
        // menuitem in, so focus never moved into the panel on open) nor `role="group"` on a
        // plain div (SonarCloud S6819: prefer the native grouping element over the ARIA role).
        // The trigger itself carries no aria-haspopup at all (not even "true", which the ARIA
        // spec treats as equivalent to "menu") - this is a disclosure button revealing a form,
        // not a menu, and aria-expanded alone is the correct pattern for that (CodeRabbit review).
        <fieldset
          className={`${className}__panel`}
          // Inline, not a CSS class: every page defining its own ${className}__panel means
          // there's no single stylesheet to add a shared modifier rule to. Flips the panel
          // above the trigger when it doesn't fit below - see useDropdownMenu's own comment.
          style={openUpward ? { top: "auto", bottom: "calc(100% + 4px)" } : undefined}
          ref={panelRef}
        >
          <legend className="sr-only">Filters</legend>
          {children}
        </fieldset>
      )}
    </div>
  );
}
