// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDropdownMenu } from "../../src/components/useDropdownMenu.js";

afterEach(cleanup);

// jsdom doesn't implement ResizeObserver - same mock shape as MapPicker.test.tsx's own, letting
// a test fire the callback manually via .trigger() to simulate the panel's content shrinking.
class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

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

/** matchTriggerWidth without a minWidth floor (SearchableSelect/PhoneCountrySelect always pass
 * one, but the option itself is optional) - the panel should just track the trigger's own
 * width, not fall back to some nonzero default. */
function MatchWidthMenu() {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "start",
    matchTriggerWidth: true,
  });
  return (
    <div ref={rootRef}>
      <button ref={triggerRef} onClick={() => setOpen((o) => !o)}>
        Trigger
      </button>
      {open && <div ref={panelRef} role="menu" style={panelStyle} />}
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

  it("repositions an upward-flipped panel when its own content shrinks, not just on window resize", () => {
    // Regression coverage for the bot review finding: SearchableSelect/PhoneCountrySelect's
    // list can shrink by hundreds of pixels as the user types into the search box. A panel
    // flipped above the trigger anchors `top` from the panel's height at that moment
    // (`top = triggerTop - panelHeight - gap`) - without re-running that on the panel's own
    // resize, the stale `top` stays put while the now-shorter content renders under it, opening
    // a growing gap between the panel's bottom edge and the trigger it's meant to hug.
    let panelHeight = 200;
    vi.stubGlobal("innerHeight", 400);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const base = { left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} };
      if (this.getAttribute("role") === "menu") return { ...base, top: 0, bottom: 0, height: panelHeight };
      return { ...base, top: 350, bottom: 360, height: 10 }; // trigger, near the viewport bottom
    });

    render(<TestMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    const menu = screen.getByRole("menu");
    expect(menu.dataset.up).toBe("true");
    expect(menu.style.top).toBe("146px"); // 350 - 200 - 4 (gap)

    panelHeight = 50; // content shrank (e.g. a search query narrowed the list)
    act(() => MockResizeObserver.instances.at(-1)!.trigger());

    expect(screen.getByRole("menu").style.top).toBe("296px"); // 350 - 50 - 4, re-anchored

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("matches the panel width to the trigger when matchTriggerWidth has no minWidth floor", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const base = { top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} };
      if (this.tagName === "BUTTON") return { ...base, left: 0, right: 300, width: 300 };
      return { ...base, left: 0, right: 0, width: 0 }; // panel
    });

    render(<MatchWidthMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    expect(screen.getByRole("menu").style.width).toBe("300px");

    vi.restoreAllMocks();
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
