// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserListItemDto } from "../../../src/api/types.js";
import { StaffUserTableRow } from "../../../src/pages/users/StaffUserListItem.js";

const user: UserListItemDto = {
  id: "user-1",
  email: "new-staff@example.com",
  display_name: null,
  is_active: true,
  must_change_password: true,
  created_at: "2026-01-01T00:00:00.000Z",
  last_login_at: null,
  active_sessions_count: 0,
  has_mfa: false,
  roles: [],
};

describe("StaffUserTableRow", () => {
  it("uses explicit empty-state labels for a staff member with no roles or prior login", () => {
    render(
      <table>
        <tbody>
          <StaffUserTableRow user={user} onEdit={vi.fn()} onRevokeSessions={vi.fn()} />
        </tbody>
      </table>,
    );

    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.getAllByText("-")).toHaveLength(1);
  });

  it("uses the shared relative-time format for staff who have signed in", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-01T13:00:00.000Z").getTime());
    try {
      render(
        <table>
          <tbody>
            <StaffUserTableRow
              user={{ ...user, last_login_at: "2026-01-01T12:30:00.000Z" }}
              onEdit={vi.fn()}
              onRevokeSessions={vi.fn()}
            />
          </tbody>
        </table>,
      );

      expect(screen.getByText("30 min ago")).toBeTruthy();
    } finally {
      now.mockRestore();
    }
  });
});
