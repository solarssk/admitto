// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFloatingPlacement, type FloatingPlacementOptions } from "../../src/components/useFloatingPlacement.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Opts = Partial<Omit<FloatingPlacementOptions, "open" | "anchorRef" | "panelRef" | "onScrollClose">>;

/** An anchor and a panel that is open from the first render, with the hook options a test passes. */
function Harness({ opts, onScrollClose = () => {} }: Readonly<{ opts: Opts; onScrollClose?: () => void }>) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open] = useState(true);
  const { openUpward, alignedEnd, panelStyle } = useFloatingPlacement({
    open,
    anchorRef,
    panelRef,
    onScrollClose,
    widthFloorRef: floorRef,
    ...opts,
  });
  return (
    <div>
      <div ref={floorRef} data-testid="floor" />
      <div ref={anchorRef} data-testid="anchor" />
      <div ref={panelRef} role="menu" data-up={openUpward} data-end={alignedEnd} style={panelStyle} />
    </div>
  );
}

/** jsdom has no layout: the anchor reports `anchor`, the width-floor element `floorWidth`, and the panel
 * `panel` (its natural height, shortened by a max-height the hook applies). <html> sits at the origin. */
function mockLayout(o: {
  anchor: { left: number; top: number; width: number; height: number };
  panel: { width: number; height: number };
  floorWidth?: number;
  innerWidth?: number;
  innerHeight?: number;
}) {
  vi.stubGlobal("innerWidth", o.innerWidth ?? 1024);
  vi.stubGlobal("innerHeight", o.innerHeight ?? 768);
  const rect = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {},
  });
  const panelHeight = (el: HTMLElement) => Math.min(o.panel.height, Number.parseFloat(el.style.maxHeight) || o.panel.height);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") === "menu") return rect(0, 0, o.panel.width, panelHeight(this));
    if (this.dataset.testid === "floor") return rect(0, 0, o.floorWidth ?? 0, 0);
    if (this.dataset.testid === "anchor") return rect(o.anchor.left, o.anchor.top, o.anchor.width, o.anchor.height);
    return rect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "menu" ? o.panel.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "menu" ? panelHeight(this) : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "menu" ? o.panel.height : 0;
  });
}

async function renderOpen(opts: Opts, onScrollClose?: () => void) {
  await act(async () => {
    render(<Harness opts={opts} onScrollClose={onScrollClose} />);
  });
  return screen.getByRole("menu");
}

describe("useFloatingPlacement", () => {
  it("keeps the requested alignment when the panel fits", async () => {
    mockLayout({ anchor: { left: 50, top: 100, width: 100, height: 30 }, panel: { width: 200, height: 100 } });
    const menu = await renderOpen({ align: "start", flipAlignment: true });

    expect(menu.dataset.end).toBe("false");
    expect(menu.style.transform).toBe("translate(50px, 134px)");
  });

  it("aligns to the anchor's right edge instead when flipAlignment is set and the panel would not fit", async () => {
    // A field near the right edge: left-aligned, a 300px panel would end past the 1024px viewport.
    mockLayout({ anchor: { left: 900, top: 100, width: 100, height: 30 }, panel: { width: 300, height: 100 } });
    const menu = await renderOpen({ align: "start", flipAlignment: true });

    expect(menu.dataset.end).toBe("true");
    expect(menu.style.transform).toBe("translate(700px, 134px)"); // 1000 (anchor right) - 300
  });

  it("only shifts the panel into the viewport without flipAlignment", async () => {
    mockLayout({ anchor: { left: 900, top: 100, width: 100, height: 30 }, panel: { width: 300, height: 100 } });
    const menu = await renderOpen({ align: "start" });

    expect(menu.dataset.end).toBe("false");
    expect(menu.style.transform).toBe("translate(716px, 134px)"); // 1024 - 8 - 300
  });

  it("matches the anchor's width, and at least the width-floor element's and minWidth", async () => {
    mockLayout({ anchor: { left: 50, top: 100, width: 100, height: 30 }, panel: { width: 0, height: 100 }, floorWidth: 240 });
    expect((await renderOpen({ matchWidth: true })).style.width).toBe("240px");
    cleanup();

    mockLayout({ anchor: { left: 50, top: 100, width: 100, height: 30 }, panel: { width: 0, height: 100 }, floorWidth: 0 });
    expect((await renderOpen({ matchWidth: true, minWidth: 180 })).style.width).toBe("180px");
  });

  it("never lets the list be taller than maxHeight, nor shorter than minMaxHeight", async () => {
    // 768 - 130 - 12 = 626px below: the cap wins.
    mockLayout({ anchor: { left: 50, top: 100, width: 100, height: 30 }, panel: { width: 200, height: 900 } });
    expect((await renderOpen({ maxHeight: 320 })).style.maxHeight).toBe("320px");
    cleanup();

    // 150 - 130 - 12 = 8px below, 100 - 12 = 88px above, so it opens below (more overflow above) and
    // the floor keeps the list usable.
    mockLayout({ anchor: { left: 50, top: 100, width: 100, height: 30 }, panel: { width: 200, height: 900 }, innerHeight: 150 });
    expect((await renderOpen({ minMaxHeight: 120 })).style.maxHeight).toBe("120px");
  });

  it("chooses the side from the height capped by maxHeight, not from the full list", async () => {
    // 400px below, 488px above, and a 600px list capped at 320px: the 320px panel fits below.
    mockLayout({
      anchor: { left: 50, top: 500, width: 100, height: 30 },
      panel: { width: 200, height: 600 },
      innerHeight: 942,
    });
    const menu = await renderOpen({ maxHeight: 320 });

    expect(menu.dataset.up).toBe("false");
    expect(menu.style.maxHeight).toBe("320px");
  });

  it("opens above without the cap when the full list does not fit below", async () => {
    mockLayout({
      anchor: { left: 50, top: 500, width: 100, height: 30 },
      panel: { width: 200, height: 600 },
      innerHeight: 942,
    });

    expect((await renderOpen({})).dataset.up).toBe("true");
  });

  it("keeps the side it opened on when only the remeasure key changes", async () => {
    // Opens above (only 20px below), then the list shrinks to 5px and the key changes, as when typing
    // narrows a search: the 5px panel would fit below (8px of room), but it must stay where it is.
    let panelHeight = 200;
    mockLayout({
      anchor: { left: 50, top: 400, width: 100, height: 30 },
      panel: {
        width: 200,
        get height() {
          return panelHeight;
        },
      },
      innerHeight: 450,
    });
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<Harness opts={{ remeasureKey: 1 }} />);
    });
    expect(screen.getByRole("menu").dataset.up).toBe("true");

    panelHeight = 5;
    await act(async () => {
      view.rerender(<Harness opts={{ remeasureKey: 2 }} />);
    });

    expect(screen.getByRole("menu").dataset.up).toBe("true");
    expect(screen.getByRole("menu").style.transform).toBe("translate(50px, 391px)"); // 400 - 5 - 4 (gap)
  });

  it("decides the side again after the panel was closed and opened", async () => {
    let panelHeight = 200;
    mockLayout({
      anchor: { left: 50, top: 400, width: 100, height: 30 },
      panel: {
        width: 200,
        get height() {
          return panelHeight;
        },
      },
      innerHeight: 450,
    });
    const Toggle = ({ open }: Readonly<{ open: boolean }>) => (open ? <Harness opts={{}} /> : null);
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<Toggle open />);
    });
    expect(screen.getByRole("menu").dataset.up).toBe("true");

    await act(async () => view.rerender(<Toggle open={false} />));
    panelHeight = 5;
    await act(async () => view.rerender(<Toggle open />));

    expect(screen.getByRole("menu").dataset.up).toBe("false");
  });

  it("hangs from the reference rect when one is given, not from the anchor's own", async () => {
    mockLayout({ anchor: { left: 50, top: 100, width: 100, height: 30 }, panel: { width: 200, height: 100 } });
    const menu = await renderOpen({
      getReferenceRect: () => ({ left: 20, top: 300, width: 400, height: 40 }),
      matchWidth: true,
    });

    expect(menu.style.transform).toBe("translate(20px, 344px)"); // 300 + 40 + 4 (gap)
    expect(menu.style.width).toBe("400px");
  });

  it("applies the z-index, and starts out invisible but in the accessibility tree", async () => {
    mockLayout({ anchor: { left: 50, top: 100, width: 100, height: 30 }, panel: { width: 200, height: 100 } });
    // Rendered synchronously, before the placement promise resolves.
    render(<Harness opts={{ zIndex: 1100 }} />);
    const menu = screen.getByRole("menu");
    expect(menu.style.opacity).toBe("0");
    expect(menu.style.pointerEvents).toBe("none");

    await act(async () => {});
    expect(menu.style.opacity).toBe("");
    expect(menu.style.zIndex).toBe("1100");
  });

  it("asks to close when something outside the panel scrolls", async () => {
    mockLayout({ anchor: { left: 50, top: 100, width: 100, height: 30 }, panel: { width: 200, height: 100 } });
    const onScrollClose = vi.fn();
    await renderOpen({}, onScrollClose);

    const scroll = new Event("scroll", { bubbles: true });
    Object.defineProperty(scroll, "target", { value: document.body });
    window.dispatchEvent(scroll);

    expect(onScrollClose).toHaveBeenCalledTimes(1);
  });
});
