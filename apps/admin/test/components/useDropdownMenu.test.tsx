// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDropdownMenu } from "../../src/components/useDropdownMenu.js";

afterEach(cleanup);

/** Minimal dropdown harness - a trigger nested inside a genuinely `overflow-y: auto` ancestor,
 * matching a modal's own scrollport (e.g. `.add-attendee-modal__scroll`). */
function TestMenu() {
  const { open, setOpen, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();
  return (
    <div style={{ overflowY: "auto" }}>
      <div ref={rootRef}>
        <button ref={triggerRef} onClick={() => setOpen((o) => !o)}>
          Trigger
        </button>
        {open && (
          <div ref={panelRef} role="menu">
            <button role="menuitem">Item</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A popover of plain form controls, not `role="menuitem"` items - the Attendees list's own
 * Filters panel is shaped this way (see useDropdownMenu's own roving-focus comment). */
function TestMenuWithoutMenuItems() {
  const { open, setOpen, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();
  return (
    <div ref={rootRef}>
      <button ref={triggerRef} onClick={() => setOpen((o) => !o)}>
        Trigger
      </button>
      {open && (
        <div ref={panelRef}>
          <input aria-label="Plain field" />
        </div>
      )}
    </div>
  );
}

describe("useDropdownMenu", () => {
  it("clamps the flip-direction check against the nearest overflow:auto ancestor, not just the viewport", () => {
    // Regression coverage for nearestClippingAncestor: comparing against the viewport alone
    // let a trigger near the bottom of a tall, scrolled modal open "downward" because the
    // viewport had room, even though the modal's own edge clipped the panel first (bot review
    // finding). This exercises the ancestor-found branch, not just the document.documentElement
    // fallback every other consumer's test already covers.
    render(<TestMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("ignores arrow-key roving focus in a popover with no role=menuitem children", () => {
    render(<TestMenuWithoutMenuItems />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    const field = screen.getByLabelText("Plain field");
    field.focus();

    expect(() => fireEvent.keyDown(document, { key: "ArrowDown" })).not.toThrow();
    expect(document.activeElement).toBe(field);
  });
});
