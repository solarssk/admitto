// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDropdownMenu } from "../../src/components/useDropdownMenu.js";

afterEach(cleanup);

/** Minimal dropdown harness - a trigger nested inside a genuinely `overflow-y: auto` ancestor,
 * matching a modal's own scrollport (e.g. `.add-attendee-modal__scroll`), to prove the panel
 * escapes it rather than being clipped/inflating its scroll height. Exposes `openUpward` as a
 * data attribute so geometry-driven tests can assert the flip decision without reaching into
 * the hook's internals. */
function TestMenu() {
  const { open, setOpen, openUpward, panelStyle, rootRef, triggerRef, panelRef } =
    useDropdownMenu<HTMLButtonElement>();
  return (
    <div data-testid="scrollport" style={{ overflowY: "auto" }}>
      <div ref={rootRef}>
        <button ref={triggerRef} onClick={() => setOpen((o) => !o)}>
          Trigger
        </button>
        {open && (
          <div ref={panelRef} role="menu" data-up={openUpward} style={panelStyle}>
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
  it("positions the panel with position: fixed instead of position: absolute inside a scrolling ancestor", () => {
    // Regression coverage for the PO-reported bug: an `absolute` panel is clipped by - and
    // inflates the scroll height of - the nearest `overflow: auto` ancestor (e.g. a modal body),
    // turning the popover into part of the scrollable content (a scrollbar appears) instead of
    // floating over it, and "bounces" the scroll position when it closes. `position: fixed`'s
    // containing block is the viewport, not this `overflow: auto` wrapper, so it escapes that
    // clipping without a portal.
    render(<TestMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    expect(screen.getByRole("menu").style.position).toBe("fixed");
  });

  it("flips the panel above the trigger when it doesn't fit below the viewport", () => {
    vi.stubGlobal("innerHeight", 400);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const base = { left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} };
      // Trigger sits near the bottom of a short viewport - only 40px of room below it, but a
      // 250px-tall panel needs more than that, and there's ample room above.
      if (this.getAttribute("role") === "menu") return { ...base, top: 0, bottom: 0, height: 250 };
      return { ...base, top: 350, bottom: 360, height: 10 }; // trigger
    });

    render(<TestMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    expect(screen.getByRole("menu").dataset.up).toBe("true");

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("closes when an ancestor scrolls, but not when the scroll originates inside the panel", () => {
    render(<TestMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    const menu = screen.getByRole("menu");

    const innerScroll = new Event("scroll", { bubbles: true });
    Object.defineProperty(innerScroll, "target", { value: menu });
    fireEvent(window, innerScroll);
    expect(screen.getByRole("menu")).toBeTruthy();

    const outsideScroll = new Event("scroll", { bubbles: true });
    Object.defineProperty(outsideScroll, "target", { value: document.body });
    fireEvent(window, outsideScroll);
    expect(screen.queryByRole("menu")).toBeNull();
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
