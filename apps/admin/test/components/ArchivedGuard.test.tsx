// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARCHIVED_ACTION_TOOLTIP,
  ArchivedGuard,
  isEventArchived,
} from "../../src/components/ArchivedGuard.js";

afterEach(() => {
  cleanup();
});

describe("isEventArchived", () => {
  it("is false for null/undefined events and events with no archived_at", () => {
    expect(isEventArchived(null)).toBe(false);
    expect(isEventArchived(undefined)).toBe(false);
    expect(isEventArchived({ archived_at: null })).toBe(false);
  });

  it("is true once archived_at is set", () => {
    expect(isEventArchived({ archived_at: "2026-01-01T00:00:00.000Z" })).toBe(true);
  });
});

describe("ArchivedGuard", () => {
  it("renders the control enabled with no tooltip when the event is active and there is no fallback condition", () => {
    render(
      <ArchivedGuard event={{ archived_at: null }} reasonId="r1">
        {(guard) => (
          <button type="button" {...guard}>
            Do thing
          </button>
        )}
      </ArchivedGuard>,
    );
    const button = screen.getByRole("button", { name: "Do thing" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(button.parentElement?.hasAttribute("data-tooltip")).toBe(false);
    expect(button.parentElement?.className).toBe("");
  });

  it("disables the control and shows the archived tooltip once the event is archived", () => {
    render(
      <ArchivedGuard event={{ archived_at: "2026-01-01T00:00:00.000Z" }} reasonId="r2">
        {(guard) => (
          <button type="button" {...guard}>
            Do thing
          </button>
        )}
      </ArchivedGuard>,
    );
    const button = screen.getByRole("button", { name: "Do thing" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe("r2");
    expect(screen.getByText(ARCHIVED_ACTION_TOOLTIP).id).toBe("r2");
    expect(button.closest(".at-tooltip")?.getAttribute("data-tooltip")).toBe(ARCHIVED_ACTION_TOOLTIP);
  });

  it("respects a fallback disabled/tooltip condition when the event is not archived", () => {
    render(
      <ArchivedGuard
        event={{ archived_at: null }}
        reasonId="r3"
        disabled={true}
        tooltip="Busy — try again shortly."
      >
        {(guard) => (
          <button type="button" {...guard}>
            Do thing
          </button>
        )}
      </ArchivedGuard>,
    );
    const button = screen.getByRole("button", { name: "Do thing" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe("r3");
    expect(screen.getByText("Busy — try again shortly.").id).toBe("r3");
  });

  it("the archived reason always overrides a fallback tooltip once the event is archived", () => {
    render(
      <ArchivedGuard
        event={{ archived_at: "2026-01-01T00:00:00.000Z" }}
        reasonId="r4"
        disabled={true}
        tooltip="Busy — try again shortly."
      >
        {(guard) => (
          <button type="button" {...guard}>
            Do thing
          </button>
        )}
      </ArchivedGuard>,
    );
    const button = screen.getByRole("button", { name: "Do thing" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(ARCHIVED_ACTION_TOOLTIP)).toBeTruthy();
    expect(screen.queryByText("Busy — try again shortly.")).toBeNull();
  });

  it("keeps a stable wrapper element across renders so a control never remounts as its disabled reason changes", () => {
    function Harness({ badgeInactive }: { badgeInactive: boolean }) {
      return (
        <ArchivedGuard
          event={{ archived_at: null }}
          reasonId="r5"
          disabled={badgeInactive}
          tooltip={badgeInactive ? "Can't enable this right now." : undefined}
        >
          {(guard) => <input type="checkbox" aria-label="Toggle" {...guard} />}
        </ArchivedGuard>
      );
    }
    const { rerender } = render(<Harness badgeInactive={false} />);
    const inputBefore = screen.getByRole("checkbox", { name: "Toggle" }) as HTMLInputElement;
    expect(inputBefore.disabled).toBe(false);

    rerender(<Harness badgeInactive={true} />);
    const inputAfter = screen.getByRole("checkbox", { name: "Toggle" }) as HTMLInputElement;
    expect(inputAfter).toBe(inputBefore); // same DOM node — no remount
    expect(inputAfter.disabled).toBe(true);
  });

  it("disabled fallback with no tooltip text disables the control without a describedby wrapper", () => {
    render(
      <ArchivedGuard event={{ archived_at: null }} reasonId="r6" disabled={true}>
        {(guard) => (
          <button type="button" {...guard}>
            Do thing
          </button>
        )}
      </ArchivedGuard>,
    );
    const button = screen.getByRole("button", { name: "Do thing" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("defaults to the upward tooltip placement, with no extra class, when archived", () => {
    render(
      <ArchivedGuard event={{ archived_at: "2026-01-01T00:00:00.000Z" }} reasonId="r7">
        {(guard) => (
          <button type="button" {...guard}>
            Do thing
          </button>
        )}
      </ArchivedGuard>,
    );
    const button = screen.getByRole("button", { name: "Do thing" }) as HTMLButtonElement;
    const wrapper = button.closest(".at-tooltip");
    expect(wrapper?.className).toBe("at-tooltip");
    expect(wrapper?.classList.contains("at-tooltip--below")).toBe(false);
  });

  it("adds the below-placement class when placement=\"below\" is requested, for controls near the page top", () => {
    render(
      <ArchivedGuard
        event={{ archived_at: "2026-01-01T00:00:00.000Z" }}
        reasonId="r8"
        placement="below"
      >
        {(guard) => (
          <button type="button" {...guard}>
            Do thing
          </button>
        )}
      </ArchivedGuard>,
    );
    const button = screen.getByRole("button", { name: "Do thing" }) as HTMLButtonElement;
    const wrapper = button.closest(".at-tooltip");
    expect(wrapper?.classList.contains("at-tooltip--below")).toBe(true);
  });
});
