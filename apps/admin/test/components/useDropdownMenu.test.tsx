// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { useDropdownMenu } from "../../src/components/useDropdownMenu.js";
import { mockVisualViewport } from "./panelPlacementMocks.js";

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

/** Right-aligned menu (every More actions style consumer). */
function EndAlignedMenu() {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
  });
  return (
    <div ref={rootRef}>
      <button ref={triggerRef} onClick={() => setOpen((o) => !o)}>
        Trigger
      </button>
      {open && (
        <div ref={panelRef} role="menu" style={panelStyle}>
          <button role="menuitem">Item</button>
        </div>
      )}
    </div>
  );
}

/** matchTriggerWidth without a minWidth floor (SearchableSelect/PhoneCountrySelect always pass
 * one, but the option itself is optional) - the panel should just track the trigger's own
 * width, not fall back to some nonzero default. */
function MatchWidthMenu() {
  const { open, setOpen, openUpward, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "start",
    matchTriggerWidth: true,
  });
  return (
    <div ref={rootRef}>
      <button ref={triggerRef} onClick={() => setOpen((o) => !o)}>
        Trigger
      </button>
      {open && <div ref={panelRef} role="menu" data-up={openUpward} style={panelStyle} />}
    </div>
  );
}

/** Same options SearchableSelect/PhoneCountrySelect always pass - `align: "start"`,
 * `matchTriggerWidth: true`, a 260px `minWidth` floor - to test the shared horizontal
 * viewport clamp with the exact configuration those consumers use. */
function MinWidthFloorMenu() {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "start",
    matchTriggerWidth: true,
    minWidth: 260,
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

type Box = { left: number; top: number; width: number; height: number };

/** jsdom has no layout. Floating UI reads the trigger from getBoundingClientRect and the panel's own
 * size from offsetWidth/offsetHeight, so those are what a test controls. `panel` is a function of the
 * element so a test can make the size depend on the style the hook has applied (max-height, width). */
function mockGeometry(opts: {
  trigger: () => Box;
  panel: (el: HTMLElement) => { width: number; height: number; natural?: number };
}) {
  const isPanel = (el: HTMLElement) => el.getAttribute("role") === "menu";
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (isPanel(this)) {
      const { width, height } = opts.panel(this);
      return { left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, width, height, toJSON() {} };
    }
    // Every other element (<html>, <body>, a scroll ancestor) sits at the origin; Floating UI subtracts
    // the root element's own offset.
    if (this.tagName !== "BUTTON") return { left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0, toJSON() {} };
    const t = opts.trigger();
    return { left: t.left, top: t.top, right: t.left + t.width, bottom: t.top + t.height, x: t.left, y: t.top, width: t.width, height: t.height, toJSON() {} };
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return isPanel(this) ? opts.panel(this).width : 0;
  });
  // scrollHeight is the content's natural height, whatever max-height clamps the box to.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    if (!isPanel(this)) return 0;
    const { height, natural } = opts.panel(this);
    return natural ?? height;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return isPanel(this) ? opts.panel(this).height : 0;
  });
}

/** A panel `natural` tall that is as tall as its max-height lets it be, like a real scroll container. */
const clamped = (el: HTMLElement, natural: number) => ({
  height: Math.min(natural, Number.parseFloat(el.style.maxHeight) || natural),
  natural,
});

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
  });
  return screen.getByRole("menu");
}

const translate = (x: number, y: number) => `translate(${x}px, ${y}px)`;

describe("useDropdownMenu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("positions the panel with position: fixed instead of position: absolute inside a scrolling ancestor", async () => {
    // Regression coverage for the PO-reported bug: an `absolute` panel is clipped by - and
    // inflates the scroll height of - the nearest `overflow: auto` ancestor (e.g. a modal body),
    // turning the popover into part of the scrollable content (a scrollbar appears) instead of
    // floating over it, and "bounces" the scroll position when it closes. `position: fixed`'s
    // containing block is the viewport, not this `overflow: auto` wrapper, so it escapes that
    // clipping without a portal.
    render(<TestMenu />);
    const menu = await openMenu();
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.left).toBe("0px");
    expect(menu.style.top).toBe("0px");
  });

  it("flips the panel above the trigger when it doesn't fit below the viewport", async () => {
    vi.stubGlobal("innerHeight", 400);
    // Trigger near the bottom of a short viewport: 40px of room below, a 250px panel needs more,
    // and there is ample room above.
    mockGeometry({ trigger: () => ({ left: 0, top: 350, width: 10, height: 10 }), panel: () => ({ width: 100, height: 250 }) });

    render(<TestMenu />);
    const menu = await openMenu();

    expect(menu.dataset.up).toBe("true");
    expect(menu.style.transform).toBe(translate(8, 96)); // 350 - 250 - 4 (gap); x kept 8px from the edge
  });

  it("repositions for the smaller visual viewport when the mobile keyboard opens", async () => {
    let visualHeight = 900;
    const visualViewport = mockVisualViewport(390, () => visualHeight);
    vi.stubGlobal("innerHeight", 900);
    mockGeometry({
      trigger: () => ({ left: 0, top: 350, width: 260, height: 10 }),
      panel: (el) => ({ width: 260, ...clamped(el, 450) }),
    });

    render(<TestMenu />);
    expect((await openMenu()).dataset.up).toBe("false");

    visualHeight = 400;
    await act(async () => {
      visualViewport.dispatchEvent(new Event("resize"));
    });
    const menu = screen.getByRole("menu");
    expect(menu.dataset.up).toBe("true");
    expect(menu.style.transform).toBe(translate(8, 8));
    expect(menu.style.maxHeight).toBe("338px");
    expect(menu.style.overflowY).toBe("auto");
  });

  it("keeps a dropdown within the panned visual viewport", async () => {
    const visualViewport = mockVisualViewport(390, () => 400, () => 300);
    mockGeometry({
      trigger: () => ({ left: 50, top: 500, width: 260, height: 10 }),
      panel: (el) => ({ width: 260, ...clamped(el, 450) }),
    });

    render(<TestMenu />);
    const menu = await openMenu();
    expect(menu.dataset.up).toBe("true");
    expect(menu.style.transform).toBe(translate(50, 308));
    expect(menu.style.maxHeight).toBe("188px");

    await act(async () => {
      visualViewport.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByRole("menu").style.transform).toBe(translate(50, 308));
  });

  it("never raises a dropdown above less than 160px of available viewport space", async () => {
    vi.stubGlobal("innerHeight", 120);
    mockGeometry({
      trigger: () => ({ left: 0, top: 50, width: 260, height: 10 }),
      panel: (el) => ({ width: 260, ...clamped(el, 300) }),
    });

    render(<TestMenu />);
    const menu = await openMenu();
    expect(menu.style.maxHeight).toBe("48px");
    expect(menu.style.overflowY).toBe("auto");
  });

  it("flips instead of clamping a short panel that fits raw space below but not once the gap+pad margin is reserved", async () => {
    // Regression coverage for a real 3-option picker (Communication's "By wallet status" filter): a
    // 35px panel fits the raw 40px below the trigger, but not once gap (4) and the viewport padding
    // (8) are reserved, which left only 28px. It must flip into the 350px above, not be clamped with
    // a barely-there scrollbar.
    vi.stubGlobal("innerHeight", 400);
    mockGeometry({ trigger: () => ({ left: 0, top: 350, width: 10, height: 10 }), panel: () => ({ width: 100, height: 35 }) });

    render(<TestMenu />);
    const menu = await openMenu();

    expect(menu.dataset.up).toBe("true");
    expect(menu.style.maxHeight).toBe("");
    expect(menu.style.transform).toBe(translate(8, 311)); // 350 - 35 - 4 (gap)
  });

  it("repositions an upward-flipped panel when its own content shrinks, not just on window resize", async () => {
    // SearchableSelect/PhoneCountrySelect's list can shrink by hundreds of pixels as the user types.
    // A panel above the trigger is anchored by its bottom edge, so without re-running placement on the
    // panel's own resize a growing gap opens between its bottom edge and the trigger.
    let panelHeight = 200;
    vi.stubGlobal("innerHeight", 400);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    mockGeometry({ trigger: () => ({ left: 0, top: 350, width: 10, height: 10 }), panel: () => ({ width: 100, height: panelHeight }) });

    render(<TestMenu />);
    const menu = await openMenu();
    expect(menu.dataset.up).toBe("true");
    expect(menu.style.transform).toBe(translate(8, 146)); // 350 - 200 - 4 (gap)

    panelHeight = 50;
    await act(async () => MockResizeObserver.instances.at(-1)!.trigger());

    expect(screen.getByRole("menu").style.transform).toBe(translate(8, 296)); // 350 - 50 - 4, re-anchored
  });

  it("never flips a panel back down just because its shrinking content would now fit below", async () => {
    // SearchableSelect's list can shrink enough while typing that the shorter content would fit below
    // the trigger, even though the original, full list did not. Re-deciding the side from the new
    // height alone flipped the panel below the trigger mid-keystroke, a visible jump.
    let panelHeight = 200;
    vi.stubGlobal("innerHeight", 400);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    mockGeometry({ trigger: () => ({ left: 0, top: 350, width: 10, height: 10 }), panel: () => ({ width: 100, height: panelHeight }) });

    render(<TestMenu />);
    expect((await openMenu()).dataset.up).toBe("true");

    panelHeight = 30; // shorter than the 40px below the trigger
    await act(async () => MockResizeObserver.instances.at(-1)!.trigger());

    const menu = screen.getByRole("menu");
    expect(menu.dataset.up).toBe("true");
    expect(menu.style.transform).toBe(translate(8, 316)); // 350 - 30 - 4, still anchored above
  });

  it("still flips when the available space itself genuinely changes, not just the content", async () => {
    // The lock must not freeze the side forever: a real viewport change still re-decides.
    let triggerTop = 90;
    vi.stubGlobal("innerHeight", 400);
    mockGeometry({ trigger: () => ({ left: 0, top: triggerTop, width: 10, height: 10 }), panel: () => ({ width: 100, height: 200 }) });

    render(<TestMenu />);
    // Plenty of room below (300px) and only 90px above: opens downward.
    expect((await openMenu()).dataset.up).toBe("false");

    // The trigger moves near the bottom (the page scrolled): 40px below, 350px above.
    triggerTop = 350;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByRole("menu").dataset.up).toBe("true");
  });

  it("matches the panel width to the trigger when matchTriggerWidth has no minWidth floor", async () => {
    mockGeometry({ trigger: () => ({ left: 0, top: 0, width: 300, height: 0 }), panel: () => ({ width: 0, height: 0 }) });

    render(<MatchWidthMenu />);

    expect((await openMenu()).style.width).toBe("300px");
  });

  it("measures a match-trigger panel at the trigger's width, so its height decides which side it opens on", async () => {
    // Long option labels wrap at the trigger's width and make the panel taller than at its natural
    // width. Placement is settled after the width is applied, not on the shorter first measurement.
    vi.stubGlobal("innerWidth", 1100);
    vi.stubGlobal("innerHeight", 600);
    mockGeometry({
      trigger: () => ({ left: 0, top: 400, width: 260, height: 30 }),
      panel: (el) => ({ width: 260, height: el.style.width === "260px" ? 500 : 100 }),
    });

    render(<MatchWidthMenu />);

    expect((await openMenu()).dataset.up).toBe("true");
  });

  it("keeps a 260px-floor panel inside a narrow viewport when its trigger sits flush against the right edge", async () => {
    // The Reports pagination footer's "Rows per page" SearchableSelect can be the only control in its
    // row, flush against the container's right edge; its 260px floor must not push the panel past the
    // viewport.
    vi.stubGlobal("innerWidth", 375);
    mockGeometry({
      trigger: () => ({ left: 300, top: 100, width: 67, height: 30 }),
      panel: (el) => ({ width: Number.parseFloat(el.style.width) || 0, height: 40 }),
    });

    render(<MinWidthFloorMenu />);
    const menu = await openMenu();

    expect(menu.style.width).toBe("260px");
    const x = Number.parseFloat(/translate\((-?[\d.]+)px/.exec(menu.style.transform)![1]!);
    expect(x).toBeGreaterThanOrEqual(8);
    expect(x + 260).toBeLessThanOrEqual(375 - 8);
  });

  it("places a right-aligned panel using its width including the scrollbar it gets from the height clamp", async () => {
    // A tall menu is clamped to the space below and starts scrolling, which makes it wider by the
    // scrollbar. `align: "end"` derives its position from that width.
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 400);
    mockGeometry({
      trigger: () => ({ left: 900, top: 100, width: 100, height: 30 }),
      panel: (el) => ({ width: el.style.overflowY === "auto" ? 308 : 300, ...clamped(el, 900) }),
    });

    render(<EndAlignedMenu />);
    const menu = await openMenu();

    expect(menu.style.overflowY).toBe("auto");
    expect(menu.style.transform).toBe(translate(692, 134)); // 1000 (trigger right edge) - 308 (width with scrollbar)
  });

  it("caps the panel to the padded viewport on a viewport narrower than its natural width", async () => {
    // A long-hint menu on a phone wraps inside the margins instead of overflowing the right edge.
    vi.stubGlobal("innerWidth", 375);
    vi.stubGlobal("innerHeight", 600);
    mockGeometry({
      trigger: () => ({ left: 330, top: 100, width: 28, height: 30 }),
      panel: (el) => ({ width: Math.min(500, Number.parseFloat(el.style.maxWidth) || 500), height: 100 }),
    });

    render(<EndAlignedMenu />);
    const menu = await openMenu();

    expect(menu.style.maxWidth).toBe("359px"); // 375 - 2 * 8
    expect(menu.style.transform).toBe(translate(8, 134));
  });

  it("also caps a CSS min-width that is wider than the padded viewport", async () => {
    // `min-width` beats `max-width`, so capping only the max left a panel with a 300px minimum
    // overflowing the right edge of a 280px viewport.
    const style = document.createElement("style");
    style.textContent = '[role="menu"] { min-width: 300px; }';
    document.head.append(style);
    // Removed even when an assertion fails, so one failure cannot leak a min-width into other tests.
    onTestFinished(() => style.remove());
    vi.stubGlobal("innerWidth", 280);
    vi.stubGlobal("innerHeight", 600);
    mockGeometry({
      trigger: () => ({ left: 230, top: 100, width: 28, height: 30 }),
      panel: (el) => ({
        width: Math.max(Number.parseFloat(getComputedStyle(el).minWidth), Math.min(400, Number.parseFloat(el.style.maxWidth) || 400)),
        height: 100,
      }),
    });

    render(<EndAlignedMenu />);
    const menu = await openMenu();

    expect(menu.style.minWidth).toBe("264px"); // 280 - 2 * 8
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

describe("useDropdownMenu keeps focus in an open panel", () => {
  /** A menu whose first row can go away, like Mark all as read once everything is read. */
  function MenuWithDisappearingRow() {
    const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();
    const [showMarkAll, setShowMarkAll] = useState(true);
    return (
      <div ref={rootRef}>
        <button ref={triggerRef} onClick={() => setOpen((o) => !o)}>
          Trigger
        </button>
        {open && (
          <div ref={panelRef} role="menu" style={panelStyle}>
            {showMarkAll && (
              <button role="menuitem" onClick={() => setShowMarkAll(false)}>
                Mark all
              </button>
            )}
            <button role="menuitem">Clear all</button>
          </div>
        )}
      </div>
    );
  }

  const settle = () => act(async () => {});

  it("moves focus to the first remaining control when the focused one disappears, instead of dropping it on <body>", async () => {
    render(<MenuWithDisappearingRow />);
    fireEvent.click(screen.getByText("Trigger"));
    const markAll = screen.getByRole("menuitem", { name: "Mark all" });
    markAll.focus();
    expect(document.activeElement).toBe(markAll);

    fireEvent.click(markAll);
    await settle();

    expect(screen.queryByRole("menuitem", { name: "Mark all" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Clear all" }));
  });

  it("does not take focus when the panel is closed", async () => {
    render(<MenuWithDisappearingRow />);
    fireEvent.click(screen.getByText("Trigger"));
    screen.getByRole("menuitem", { name: "Mark all" }).focus();
    fireEvent.click(screen.getByText("Trigger"));
    await settle();

    expect(screen.queryByRole("menu")).toBeNull();
    // The panel went away with the control that held focus; nothing was moved into it or anywhere else.
    expect(document.activeElement).toBe(document.body);
  });
});
