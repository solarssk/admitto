import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tooltip } from "../src/components/Tooltip.js";

describe("Tooltip", () => {
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
});
