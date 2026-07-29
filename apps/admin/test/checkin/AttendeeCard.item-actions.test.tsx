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
  blocked: false,
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

    fireEvent.click(screen.getByRole("button", { name: "Mark badge issued" }));
    expect(onItemAction).toHaveBeenCalledWith("badge", "issued");
  });

  it("uses the canonical issued label for a gift bag action", () => {
    render(
      <AttendeeCard
        card={{
          ...cardWithItem,
          items: [{ key: "gift_bag", label: "Gift bag", icon: null, state: "pending", actions: ["issued"] }],
        }}
        eventTimezone="UTC"
        canAct={true}
        onItemAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Mark issued")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark gift bag issued" })).toBeTruthy();
  });

  it("a same-tick double-click on the item action button only calls onItemAction once", () => {
    const onItemAction = vi.fn().mockResolvedValue(true);
    render(
      <AttendeeCard card={cardWithItem} eventTimezone="UTC" canAct={true} onItemAction={onItemAction} />,
    );

    const button = screen.getByRole("button", { name: "Mark badge issued" });
    // Both clicks share one act() batch deliberately: fireEvent's own auto-wrapping would flush
    // React's re-render (and the button's disabled state) between two separate act() calls, so
    // the second click would just be silently ignored by a disabled <button> — that would test
    // the DOM's own disabled-button behavior, not the useInFlightIds guard this test exists to
    // cover (CodeRabbit review on PR #559 caught this act() removal breaking the race).
    act(() => { // NOSONAR — deliberate shared batch, see comment above
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

    const button = screen.getByRole("button", { name: "Mark badge issued" }) as HTMLButtonElement;
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
    // Same-tick race, same reasoning as the "Mark badge issued" test above: both clicks must
    // share one act() batch or the second click hits an already-disabled button instead of
    // exercising the useInFlightIds guard.
    act(() => { // NOSONAR — deliberate shared batch, see comment above
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

// Jadzia/PO review: the item list previously had no heading and never showed
// the item's admin-configured description, so it read as inert status text
// rather than something the operator needs to act on.
describe("AttendeeCard — items section heading and description (review)", () => {
  const cardWithDescribedItems: AttendeeCardDto = {
    id: "att-2",
    name: "Beata Beta",
    company: null,
    department: null,
    ticket_type: "standard",
    check_in_status: "admitted",
    admitted_at: "2026-09-01T09:44:00.000Z",
    items: [
      {
        key: "badge",
        label: "Badge",
        icon: null,
        state: "pending",
        actions: ["issued"],
        description: "Hand out at the badge desk by the entrance",
      },
      { key: "gift_bag", label: "Gift bag", icon: null, state: "pending", actions: ["issued"] },
    ],
    notes: [],
    blocked: false,
  };

  it('shows an "Items to hand out" heading above the item list', () => {
    render(<AttendeeCard card={cardWithDescribedItems} eventTimezone="UTC" canAct={true} />);
    expect(screen.getByRole("heading", { name: "Items to hand out" })).toBeTruthy();
  });

  it("shows an item's admin-configured description when set", () => {
    render(<AttendeeCard card={cardWithDescribedItems} eventTimezone="UTC" canAct={true} />);
    expect(screen.getByText("Hand out at the badge desk by the entrance")).toBeTruthy();
  });

  it("renders no description paragraph for an item without one", () => {
    render(<AttendeeCard card={cardWithDescribedItems} eventTimezone="UTC" canAct={true} />);
    const giftBagRow = screen.getByText("Gift bag").closest(".checkin-card__item") as HTMLElement;
    expect(giftBagRow.querySelector(".checkin-card__item-description")).toBeNull();
  });

  it("omits the heading entirely when the card has no items", () => {
    render(
      <AttendeeCard
        card={{ ...cardWithDescribedItems, items: [] }}
        eventTimezone="UTC"
        canAct={true}
      />,
    );
    expect(screen.queryByRole("heading", { name: "Items to hand out" })).toBeNull();
  });
});
