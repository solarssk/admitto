// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InviteUserModal } from "../../../src/pages/users/InviteUserModal.js";

vi.mock("../../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {},
  createAdminUser: vi.fn(),
  fetchAdminEvents: vi.fn().mockResolvedValue([]),
  fetchAdminOrganizations: vi.fn().mockResolvedValue([]),
  grantUserRole: vi.fn(),
}));

import { createAdminUser } from "../../../src/api/client.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InviteUserModal", () => {
  it("has no send-invite-email switch and shows a password length hint", () => {
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.queryByLabelText("Send invite email")).toBeNull();
    expect(screen.getByText("At least 12 characters.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("shows the sending state while creating a manual-password account", async () => {
    vi.mocked(createAdminUser).mockImplementationOnce(() => new Promise(() => {}));
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createAdminUser).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "long-enough-password",
        display_name: null,
        must_change_password: true,
      });
    });
    expect(screen.getByRole("button", { name: "Sending…" })).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Email address")).toHaveProperty("disabled", true);
  });
});
