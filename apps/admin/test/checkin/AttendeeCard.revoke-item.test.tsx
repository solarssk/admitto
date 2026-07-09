// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttendeeCardDto } from "../../src/api/types.js";
import { AttendeeCard } from "../../src/checkin/AttendeeCard.js";

afterEach(() => {
  cleanup();
});

// A handed-out item: no operator actions left (rendered as a state badge), so
// the admin per-item Revoke is the only thing that can put it back to pending.
const issuedItemCard: AttendeeCardDto = {
  id: "att-1",
  name: "Anna Alpha",
  company: null,
  department: null,
  ticket_type: "vip",
  check_in_status: "admitted",
  admitted_at: "2026-09-01T09:44:00.000Z",
  items: [{ key: "gift_bag", label: "Gift bag", icon: null, state: "issued", actions: [] }],
  notes: [],
  blocked: false,
};

describe("AttendeeCard — admin per-item Revoke (item revocation feature)", () => {
  it("shows Revoke for an admin/superadmin on a handed-out item", () => {
    render(
      <AttendeeCard
        card={issuedItemCard}
        eventTimezone="UTC"
        canAct
        canRevokeItems
        onRevokeItem={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Revoke Gift bag" })).toBeTruthy();
  });

  it("does not show Revoke for a regular operator (canRevokeItems falsy)", () => {
    render(
      <AttendeeCard card={issuedItemCard} eventTimezone="UTC" canAct onRevokeItem={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Revoke Gift bag" })).toBeNull();
  });

  it("does not show Revoke when no onRevokeItem handler is wired", () => {
    render(<AttendeeCard card={issuedItemCard} eventTimezone="UTC" canAct canRevokeItems />);
    expect(screen.queryByRole("button", { name: "Revoke Gift bag" })).toBeNull();
  });

  it("does not show Revoke on an item still actionable by the operator", () => {
    render(
      <AttendeeCard
        card={{
          ...issuedItemCard,
          items: [{ key: "gift_bag", label: "Gift bag", icon: null, state: "pending", actions: ["issued"] }],
        }}
        eventTimezone="UTC"
        canAct
        canRevokeItems
        onRevokeItem={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Revoke Gift bag" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark gift bag given" })).toBeTruthy();
  });

  it("hides Revoke on a blocked (revoked/invalid) pass", () => {
    render(
      <AttendeeCard
        card={issuedItemCard}
        eventTimezone="UTC"
        scanStatus="REVOKED"
        canAct
        canRevokeItems
        onRevokeItem={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Revoke Gift bag" })).toBeNull();
  });

  it("clicking Revoke calls onRevokeItem with the item key", () => {
    const onRevokeItem = vi.fn().mockResolvedValue(true);
    render(
      <AttendeeCard
        card={issuedItemCard}
        eventTimezone="UTC"
        canAct
        canRevokeItems
        onRevokeItem={onRevokeItem}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke Gift bag" }));
    expect(onRevokeItem).toHaveBeenCalledWith("gift_bag");
  });

  it("a same-tick double-click only calls onRevokeItem once (shared useInFlightIds guard)", () => {
    const onRevokeItem = vi.fn().mockResolvedValue(true);
    render(
      <AttendeeCard
        card={issuedItemCard}
        eventTimezone="UTC"
        canAct
        canRevokeItems
        onRevokeItem={onRevokeItem}
      />,
    );
    const button = screen.getByRole("button", { name: "Revoke Gift bag" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(onRevokeItem).toHaveBeenCalledTimes(1);
  });

  it("disables Revoke while offline (canAct=false), same as the other actions", () => {
    render(
      <AttendeeCard
        card={issuedItemCard}
        eventTimezone="UTC"
        canAct={false}
        canRevokeItems
        onRevokeItem={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Revoke Gift bag" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("once the card updates with the item back at pending, Revoke is gone and the Mark action returns", () => {
    const { rerender } = render(
      <AttendeeCard
        card={issuedItemCard}
        eventTimezone="UTC"
        canAct
        canRevokeItems
        onRevokeItem={vi.fn()}
        onItemAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Revoke Gift bag" })).toBeTruthy();

    rerender(
      <AttendeeCard
        card={{
          ...issuedItemCard,
          items: [{ key: "gift_bag", label: "Gift bag", icon: null, state: "pending", actions: ["issued"] }],
        }}
        eventTimezone="UTC"
        canAct
        canRevokeItems
        onRevokeItem={vi.fn()}
        onItemAction={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Revoke Gift bag" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark gift bag given" })).toBeTruthy();
  });
});
