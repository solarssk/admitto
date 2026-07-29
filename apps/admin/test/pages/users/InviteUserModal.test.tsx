// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InviteUserModal } from "../../../src/pages/users/InviteUserModal.js";

vi.mock("../../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {},
  createAdminUser: vi.fn(),
  fetchAdminEvents: vi.fn().mockResolvedValue([]),
  fetchAdminOrganizations: vi.fn().mockResolvedValue([]),
  grantUserRole: vi.fn(),
}));

describe("InviteUserModal", () => {
  it("keeps invite email disabled and gives the administrator the manual next step", () => {
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByLabelText("Send invite email")).toHaveProperty("disabled", true);
    expect(screen.getByText("Coming soon. Share the password manually for now.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });
});
