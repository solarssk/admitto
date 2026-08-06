import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "../src/components/Tooltip.js";

/** Stubs getBoundingClientRect so the trigger and the tooltip bubble each report a fixed,
 * realistic size - jsdom's real layout engine always returns all-zero rects, which would hide
 * every viewport-collision bug this suite exists to catch (everything trivially "fits" at 0x0). */
function stubRects(triggerRect: Partial<DOMRect>, bubbleRect: Partial<DOMRect>) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const rect = this.getAttribute("role") === "tooltip" ? bubbleRect : triggerRect;
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rect };
  });
}

describe("Tooltip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children as-is and skips all tooltip wiring when content is empty", () => {
    render(
      <Tooltip content={undefined}>
        <button>Do thing</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "Do thing" })).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the bubble with the tooltip text on focus, hides it on blur", () => {
    render(
      <Tooltip content="Disabled because reasons">
        <button>Do thing</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Do thing" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe("Disabled because reasons");

    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the bubble on mouse hover too", () => {
    render(
      <Tooltip content="Hover reason">
        <button>Do thing</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Do thing" });
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Hover reason");
  });

  it("shows the bubble on hover even when the trigger is disabled (the real-world case: explaining why a control is disabled)", () => {
    render(
      <Tooltip content="Disabled because reasons">
        <button disabled>Do thing</button>
      </Tooltip>,
    );
    // A disabled element is never focusable in a real browser - only hover reaches it. Firing
    // focus() on the trigger itself here would be a false positive: jsdom doesn't enforce that
    // restriction the way a real browser does.
    const trigger = screen.getByRole("button", { name: "Do thing" });
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Disabled because reasons");
  });

  it("puts the wrapper in the tab order when the trigger has no focusable child (e.g. a plain icon hint)", () => {
    const { container } = render(
      <Tooltip content="OpenID Connect">
        <i aria-hidden="true" />
      </Tooltip>,
    );
    const wrapper = container.querySelector(".at-tooltip-trigger");
    expect(wrapper?.getAttribute("tabindex")).toBe("0");

    fireEvent.focus(wrapper as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toBe("OpenID Connect");
  });

  it("does not add a redundant tab stop when the trigger is already focusable (a live button)", () => {
    const { container } = render(
      <Tooltip content="Do the thing">
        <button>Do thing</button>
      </Tooltip>,
    );
    expect(container.querySelector(".at-tooltip-trigger")?.getAttribute("tabindex")).toBeNull();
  });

  it("reaches through nested markup to find a focusable descendant (Switch's <label><input/></label>)", () => {
    const { container } = render(
      <Tooltip content="Allow sign-in through this provider">
        <label>
          <input type="checkbox" />
        </label>
      </Tooltip>,
    );
    expect(container.querySelector(".at-tooltip-trigger")?.getAttribute("tabindex")).toBeNull();
  });

  it("picks up the tab stop once the only child goes from enabled to disabled (ArchivedGuard's pattern)", () => {
    function Example({ disabled }: Readonly<{ disabled: boolean }>) {
      return (
        <Tooltip content="This event is archived. Editing is disabled.">
          <button disabled={disabled}>Do thing</button>
        </Tooltip>
      );
    }
    const { container, rerender } = render(<Example disabled={false} />);
    const wrapper = () => container.querySelector(".at-tooltip-trigger");
    expect(wrapper()?.getAttribute("tabindex")).toBeNull();

    rerender(<Example disabled={true} />);
    expect(wrapper()?.getAttribute("tabindex")).toBe("0");
  });

  it("picks up the tab stop when the child is only disabled via an ancestor <fieldset disabled> (CommunicationPage/ImportPage/AttendeeDetailPage's archived-event pattern)", () => {
    function Example({ archived }: Readonly<{ archived: boolean }>) {
      return (
        <Tooltip content={archived ? "This event is archived. Editing is disabled." : undefined}>
          <fieldset disabled={archived}>
            <input aria-label="Subject" />
          </fieldset>
        </Tooltip>
      );
    }
    const { container, rerender } = render(<Example archived={false} />);
    const wrapper = () => container.querySelector(".at-tooltip-trigger");
    // Fieldset-inherited disabling never sets the `disabled` attribute on the input itself -
    // only `:disabled` (not `[disabled]`) sees through it, which is exactly what's under test.
    expect(wrapper()?.getAttribute("tabindex")).toBeNull();

    rerender(<Example archived={true} />);
    expect(wrapper()?.getAttribute("tabindex")).toBe("0");
  });

  it("never adds a tab stop when there is no content to show, regardless of the child", () => {
    const { container } = render(
      <Tooltip content={undefined}>
        <i aria-hidden="true" />
      </Tooltip>,
    );
    expect(container.querySelector(".at-tooltip-trigger")?.getAttribute("tabindex")).toBeNull();
  });

  it("renders the bubble into document.body (portal), not inside the trigger's own subtree", () => {
    const { container } = render(
      <Tooltip content="Portal check">
        <button>Do thing</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole("button", { name: "Do thing" }));
    const bubble = screen.getByRole("tooltip");
    expect(container.contains(bubble)).toBe(false);
    expect(document.body.contains(bubble)).toBe(true);
  });

  it('axis="horizontal" grows to whichever side has room, vertically centered on the trigger', () => {
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 720);
    // Plenty of room on both sides - room to the right of a left-hand trigger.
    stubRects({ top: 300, bottom: 340, left: 20, right: 60, width: 40, height: 40 }, { width: 220, height: 36 });
    render(
      <Tooltip axis="horizontal" content="Side reason">
        <button>Do thing</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Do thing" }).parentElement as HTMLElement);
    const bubble = screen.getByRole("tooltip");
    // Grows right (more room there than to the left of a trigger sitting at x=20).
    expect(bubble.style.left).toBe(`${60 + 5}px`);
    expect(bubble.style.top).toBe(`${300 + 40 / 2 - 36 / 2}px`);
    vi.unstubAllGlobals();
  });

  it("hides immediately if the trigger's own panel is already expanded by the time the tooltip would show", () => {
    render(
      <Tooltip content="Filter by role">
        <button aria-expanded="true">Filters</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Filters" }).parentElement as HTMLElement);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides the bubble the instant the trigger's own panel opens (aria-expanded flips to true) while hovered", async () => {
    render(
      <Tooltip content="Filter by role">
        <button aria-expanded="false">Filters</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Filters" });
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Filter by role");

    trigger.setAttribute("aria-expanded", "true");

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });

  it('axis="horizontal" falls back to vertical placement, never off-screen, when neither side has room (the mobile "More" menu case)', () => {
    // A narrow mobile viewport where the disabled menu item itself spans nearly the full width -
    // the exact layout that shipped with `left: -87px` (PO review): neither side has the ~225px
    // a wrapped 220px-wide bubble needs, so a naive left-or-right choice runs off-screen.
    vi.stubGlobal("innerWidth", 375);
    vi.stubGlobal("innerHeight", 812);
    stubRects(
      { top: 400, bottom: 440, left: 10, right: 365, width: 355, height: 40 },
      { width: 220, height: 36 },
    );
    render(
      <Tooltip axis="horizontal" content="None of the selected attendees are checked in.">
        <button>Revoke check-in</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Revoke check-in" }).parentElement as HTMLElement,
    );
    const bubble = screen.getByRole("tooltip");
    const left = parseFloat(bubble.style.left);
    const top = parseFloat(bubble.style.top);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 220).toBeLessThanOrEqual(375 - 8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + 36).toBeLessThanOrEqual(812 - 8);
    // Vertical fallback: sits directly above or below the trigger, not beside it.
    expect([400 - 36 - 5, 440 + 5]).toContain(top);
    vi.unstubAllGlobals();
  });
});
