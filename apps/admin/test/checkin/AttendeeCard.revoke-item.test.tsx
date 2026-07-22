// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      <AttendeeCard card={issuedItemCard} eventTimezone="UTC" canAct onRevokeItem={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Revoke Gift bag" })).toBeTruthy();
  });

  it("does not show Revoke when no onRevokeItem handler is wired (its presence alone gates visibility, like onRevokeCheckIn)", () => {
    render(<AttendeeCard card={issuedItemCard} eventTimezone="UTC" canAct />);
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
        onRevokeItem={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Revoke Gift bag" })).toBeNull();
  });

  it("clicking Revoke calls onRevokeItem with the item key", () => {
    const onRevokeItem = vi.fn().mockResolvedValue(true);
    render(
      <AttendeeCard card={issuedItemCard} eventTimezone="UTC" canAct onRevokeItem={onRevokeItem} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke Gift bag" }));
    expect(onRevokeItem).toHaveBeenCalledWith("gift_bag");
  });

  it("a same-tick double-click only calls onRevokeItem once (shared useInFlightIds guard)", () => {
    const onRevokeItem = vi.fn().mockResolvedValue(true);
    render(
      <AttendeeCard card={issuedItemCard} eventTimezone="UTC" canAct onRevokeItem={onRevokeItem} />,
    );
    const button = screen.getByRole("button", { name: "Revoke Gift bag" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onRevokeItem).toHaveBeenCalledTimes(1);
  });

  it("disables Revoke while offline (canAct=false), same as the other actions", () => {
    render(
      <AttendeeCard
        card={issuedItemCard}
        eventTimezone="UTC"
        canAct={false}
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
        onRevokeItem={vi.fn()}
        onItemAction={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Revoke Gift bag" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark gift bag given" })).toBeTruthy();
  });

  it("shows Revoke alongside the Mark returned action for an issued item that still requires return (bot review, #457)", () => {
    // A `requires_return: true` item still has a pending "returned" action
    // once issued, so it falls in the actions.length > 0 branch — but the
    // server's revoke path resets issued OR returned straight to pending,
    // so an admin shouldn't have to mark it returned first just to reset it.
    render(
      <AttendeeCard
        card={{
          ...issuedItemCard,
          items: [{ key: "headset", label: "Headset", icon: null, state: "issued", actions: ["returned"] }],
        }}
        eventTimezone="UTC"
        canAct
        onRevokeItem={vi.fn()}
        onItemAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Mark headset returned" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke Headset" })).toBeTruthy();
  });
});
