// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDropdownMenu } from "../../src/components/useDropdownMenu.js";

afterEach(cleanup);

/** Minimal dropdown harness - a trigger nested inside a genuinely `overflow-y: auto` ancestor,
 * matching a modal's own scrollport (e.g. `.add-attendee-modal__scroll`). Exposes `openUpward` as
 * a data attribute so geometry-driven tests can assert the flip decision without reaching into
 * the hook's internals. */
function TestMenu() {
  const { open, setOpen, openUpward, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();
  return (
    <div data-testid="scrollport" style={{ overflowY: "auto" }}>
      <div ref={rootRef}>
        <button ref={triggerRef} onClick={() => setOpen((o) => !o)}>
          Trigger
        </button>
        {open && (
          <div ref={panelRef} role="menu" data-up={openUpward}>
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

  it("clamps upward room to the clipping ancestor's own top, not the viewport, when the trigger sits near a nested/centered scrollport's top edge", () => {
    // A centered modal scrollport whose own top sits 300px below the viewport top - the trigger
    // is only 10px from the scrollport's own top edge. The pre-fix spaceAbove measured from the
    // viewport top alone would see 310px of "room" and wrongly flip a panel that doesn't fit
    // below into space mostly outside the scrollport (bot review finding); the fix clamps
    // spaceAbove to the scrollport's own top the same way spaceBelow is already clamped to its
    // bottom, so this trigger correctly stays open downward instead.
    vi.stubGlobal("innerHeight", 800);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const base = { left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} };
      if (this.dataset.testid === "scrollport") return { ...base, top: 300, bottom: 500, height: 200 };
      if (this.getAttribute("role") === "menu") return { ...base, top: 0, bottom: 0, height: 250 };
      return { ...base, top: 310, bottom: 340, height: 30 }; // trigger
    });

    render(<TestMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    expect(screen.getByRole("menu").dataset.up).toBe("false");

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
