// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttendeeCardDto } from "../../src/api/types.js";
import { AttendeeCard } from "../../src/checkin/AttendeeCard.js";

afterEach(() => {
  cleanup();
});

const cardWithItem: AttendeeCardDto = {
  id: "att-1",
  name: "Anna Alpha",
  company: null,
  department: null,
  ticket_type: "vip",
  check_in_status: "admitted",
  admitted_at: "2026-09-01T09:44:00.000Z",
  items: [{ key: "badge", label: "Badge", icon: null, state: "pending", actions: ["issued"] }],
  notes: [],
  warnings: [],
};

// Desktop counterpart of the mobile double-submit guard (CameraOverlay
// item-issuing tests) — same review finding: `pending` never reflects an
// item action's own in-flight state, so the button's `disabled` alone
// didn't stop a fast double-click from firing the request twice.
describe("AttendeeCard — item action button (review finding)", () => {
  it("clicking the item action button calls onItemAction with the item key and action", () => {
    const onItemAction = vi.fn().mockResolvedValue(true);
    render(
      <AttendeeCard card={cardWithItem} eventTimezone="UTC" canAct={true} onItemAction={onItemAction} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Issue badge" }));
    expect(onItemAction).toHaveBeenCalledWith("badge", "issued");
  });

  it("a same-tick double-click on the item action button only calls onItemAction once", () => {
    const onItemAction = vi.fn().mockResolvedValue(true);
    render(
      <AttendeeCard card={cardWithItem} eventTimezone="UTC" canAct={true} onItemAction={onItemAction} />,
    );

    const button = screen.getByRole("button", { name: "Issue badge" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(onItemAction).toHaveBeenCalledTimes(1);
  });

  it("re-enables the item action button once onItemAction settles, so a genuine retry after failure works", async () => {
    let resolveAction!: (success: boolean) => void;
    const onItemAction = vi.fn(() => new Promise<boolean>((resolve) => { resolveAction = resolve; }));
    render(
      <AttendeeCard card={cardWithItem} eventTimezone="UTC" canAct={true} onItemAction={onItemAction} />,
    );

    const button = screen.getByRole("button", { name: "Issue badge" }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(button.disabled).toBe(true);

    await act(async () => {
      resolveAction(false);
      await Promise.resolve();
    });
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(onItemAction).toHaveBeenCalledTimes(2);
  });

  it("a same-tick double-click on Undo check-in only calls onUndo once", () => {
    const onUndo = vi.fn().mockResolvedValue(undefined);
    render(
      <AttendeeCard
        card={cardWithItem}
        eventTimezone="UTC"
        canAct={true}
        onUndo={onUndo}
        showUndo
      />,
    );

    const button = screen.getByRole("button", { name: "Undo check-in" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
