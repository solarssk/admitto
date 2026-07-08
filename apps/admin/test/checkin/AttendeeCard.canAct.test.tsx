// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttendeeCardDto } from "../../src/api/types.js";
import { AttendeeCard } from "../../src/checkin/AttendeeCard.js";

afterEach(() => {
  cleanup();
});

const admittedCard: AttendeeCardDto = {
  id: "att-1",
  name: "Anna Alpha",
  company: null,
  department: null,
  ticket_type: "vip",
  check_in_status: "admitted",
  admitted_at: "2026-09-01T09:44:00.000Z",
  items: [],
  notes: [],
  warnings: [],
};

describe("AttendeeCard — Revoke check-in disabled while offline (bugbot)", () => {
  it("disables the footer trigger when canAct is false, same as Undo check-in", () => {
    render(
      <AttendeeCard
        card={admittedCard}
        eventTimezone="UTC"
        canAct={false}
        onUndo={vi.fn()}
        showUndo
        onRevokeCheckIn={vi.fn()}
      />,
    );

    const undoBtn = screen.getByRole("button", { name: "Undo check-in" }) as HTMLButtonElement;
    const revokeBtn = screen.getByRole("button", { name: "Revoke check-in" }) as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
    expect(revokeBtn.disabled).toBe(true);
  });

  it("enables the footer trigger when canAct is true", () => {
    render(
      <AttendeeCard
        card={admittedCard}
        eventTimezone="UTC"
        canAct={true}
        onRevokeCheckIn={vi.fn()}
      />,
    );

    const revokeBtn = screen.getByRole("button", { name: "Revoke check-in" }) as HTMLButtonElement;
    expect(revokeBtn.disabled).toBe(false);
  });
});
