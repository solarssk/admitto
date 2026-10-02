// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefetchRegion } from "../../src/components/RefetchRegion.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("RefetchRegion", () => {
  it("is just its content while nothing is refreshing", () => {
    render(
      <RefetchRegion refreshing={false} label="Refreshing users">
        <button type="button">Next</button>
      </RefetchRegion>,
    );
    expect(screen.getByRole("button", { name: "Next" }).closest(".refetch-card")).toBeNull();
  });

  it("stops every click at once, without taking focus off the control that started the work", () => {
    const onClick = vi.fn();
    render(
      <RefetchRegion refreshing label="Refreshing users">
        <button type="button" onClick={onClick}>
          Next
        </button>
      </RefetchRegion>,
    );
    const button = screen.getByRole("button", { name: "Next" });
    const region = button.closest(".refetch-card--busy") as HTMLElement;
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.hasAttribute("inert")).toBe(false);
    button.focus();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it("dims and runs the bar only once the wait is noticeable, and tells a screen reader then", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <RefetchRegion refreshing label="Refreshing users">
        <p>rows</p>
      </RefetchRegion>,
    );
    await advance(199);
    expect(document.querySelector(".refetch-card--dim")).toBeNull();
    expect(screen.queryByLabelText("Refreshing users")).toBeNull();
    await advance(1);
    expect(document.querySelector(".refetch-card--dim")).not.toBeNull();
    expect(screen.getByLabelText("Refreshing users")).toBeTruthy();
    expect(screen.getByText("Refreshing users. Actions are paused until it finishes.")).toBeTruthy();

    rerender(
      <RefetchRegion refreshing={false} label="Refreshing users">
        <p>rows</p>
      </RefetchRegion>,
    );
    // Not dropped before the bar has had its minimum: the box it is positioned in stays for as long as it does.
    expect(document.querySelector(".refetch-card")).not.toBeNull();
    await advance(1000);
    expect(document.querySelector(".refetch-card")).toBeNull();
  });
});
