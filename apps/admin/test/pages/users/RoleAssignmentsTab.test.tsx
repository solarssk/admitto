// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleAssignmentsTab } from "../../../src/pages/users/RoleAssignmentsTab.js";
import { renderWithToast } from "../../test-utils.js";

const fetchRoleAssignments = vi.fn();

vi.mock("../../../src/api/client.js", () => ({
  fetchRoleAssignments: (...args: unknown[]) => fetchRoleAssignments(...args),
  revokeUserRole: vi.fn(),
}));

vi.mock("../../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [] }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RoleAssignmentsTab", () => {
  it("shows explicit empty placeholders for an unscoped, non-revocable assignment", async () => {
    fetchRoleAssignments.mockResolvedValue({
      assignments: [{
        id: "role-1",
        user_id: "user-1",
        user_email: "staff@example.com",
        user_display_name: null,
        role: "viewer",
        scope_type: "instance",
        scope_id: null,
        is_oidc: true,
        granted_at: "2026-01-01T00:00:00.000Z",
        event: null,
        organization: null,
      }],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderWithToast(<RoleAssignmentsTab />);

    await screen.findAllByText("staff@example.com");
    expect(within(screen.getByRole("table")).getAllByText("-")).toHaveLength(2);
  });
});
