// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRowSlide } from "../../src/hooks/useRowSlide.js";

const animate = vi.fn();
const originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
/** How high a row is: jsdom has no layout, so the places of the rows stack by this, in the order they are drawn. */
let rowHeight = 40;

beforeEach(() => {
  rowHeight = 40;
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: animate });
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      const row = this.closest("[data-row-id]");
      return row?.parentElement ? [...row.parentElement.children].indexOf(row) * rowHeight : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  animate.mockReset();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  if (originalOffsetTop) Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
});

function List({ order }: Readonly<{ order: string[] }>) {
  const ref = useRef<HTMLUListElement>(null);
  useRowSlide(ref, order);
  return (
    <ul ref={ref}>
      {order.map((id) => (
        <li key={id} data-row-id={id}>
          {id}
        </li>
      ))}
    </ul>
  );
}

/** Which rows were slid, and from where: the `translateY` the row starts at, by the id of the row. */
const slides = () =>
  Object.fromEntries(
    animate.mock.calls.map(([frames], call) => [(animate.mock.contexts[call] as HTMLElement).dataset.rowId, (frames as { transform: string[] }).transform[0]]),
  );

describe("useRowSlide", () => {
  it("slides nothing when the rows are drawn the first time", () => {
    render(<List order={["a", "b", "c"]} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it("slides a row that has moved, and the row it changed places with, from the place each had to the place it has now", () => {
    const view = render(<List order={["a", "b", "c"]} />);

    view.rerender(<List order={["b", "a", "c"]} />);

    expect(slides()).toEqual({ a: "translateY(-40px)", b: "translateY(40px)" });
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenCalledWith({ transform: ["translateY(-40px)", "translateY(0)"] }, { duration: 180, easing: "ease-out", composite: "add" });
  });

  it("adds the slide of a row that is moved again to the one that is still running, so that it does not jump", () => {
    const view = render(<List order={["a", "b", "c"]} />);
    view.rerender(<List order={["b", "a", "c"]} />);
    animate.mockClear();

    // Moved back before the first slide has finished: the places are the layout's, and the slide that is running stays underneath.
    view.rerender(<List order={["a", "b", "c"]} />);

    expect(slides()).toEqual({ a: "translateY(40px)", b: "translateY(-40px)" });
    expect(animate).toHaveBeenCalledTimes(2);
    for (const [, options] of animate.mock.calls) expect(options).toMatchObject({ composite: "add" });
  });

  it("slides the rows under a row that is taken out, and a row that is added slides nothing itself", () => {
    const view = render(<List order={["a", "b", "c"]} />);

    view.rerender(<List order={["a", "c"]} />);
    expect(slides()).toEqual({ c: "translateY(40px)" });

    animate.mockClear();
    view.rerender(<List order={["a", "c", "d"]} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("slides nothing when the rows are drawn again in the same order", () => {
    const view = render(<List order={["a", "b", "c"]} />);

    view.rerender(<List order={["a", "b", "c"]} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it("reads the places after every render, so a row that grew meanwhile is not taken for a move later", () => {
    const view = render(<List order={["a", "b", "c"]} />);
    rowHeight = 60;
    view.rerender(<List order={["a", "b", "c"]} />);
    expect(animate).not.toHaveBeenCalled();

    view.rerender(<List order={["b", "a", "c"]} />);

    expect(slides()).toEqual({ a: "translateY(-60px)", b: "translateY(60px)" });
  });

  it("slides nothing for a person who asked for less motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    const view = render(<List order={["a", "b", "c"]} />);

    view.rerender(<List order={["b", "a", "c"]} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it("does nothing while the list is not on the page", () => {
    const view = renderHook(({ order }) => useRowSlide({ current: null }, order), { initialProps: { order: ["a", "b"] } });

    expect(() => view.rerender({ order: ["b", "a"] })).not.toThrow();
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not fail where a row cannot animate", () => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
    const view = render(<List order={["a", "b", "c"]} />);

    expect(() => view.rerender(<List order={["b", "a", "c"]} />)).not.toThrow();
  });
});
