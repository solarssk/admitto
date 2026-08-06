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

import { createAdminUser, fetchAdminEvents, fetchAdminOrganizations, grantUserRole } from "../../../src/api/client.js";

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

  it("sends must_change_password: false when the switch is turned off", async () => {
    vi.mocked(createAdminUser).mockResolvedValueOnce({
      user: { id: "usr-1" } as never,
    });
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByLabelText("Require password change on first login"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createAdminUser).toHaveBeenCalledWith(
        expect.objectContaining({ must_change_password: false }),
      );
    });
  });

  it("shows a taken-email message for an email_taken response", async () => {
    const { ApiError } = await import("../../../src/api/client.js");
    vi.mocked(createAdminUser).mockRejectedValueOnce(new ApiError("email_taken"));
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("A user with this email already exists.")).toBeTruthy();
  });

  it("shows a validation message for an invalid_request response", async () => {
    const { ApiError } = await import("../../../src/api/client.js");
    vi.mocked(createAdminUser).mockRejectedValueOnce(new ApiError("invalid_request"));
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Check the email address and the temporary password (at least 12 characters)."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
  });

  it("falls back to a generic message for a non-API error", async () => {
    vi.mocked(createAdminUser).mockRejectedValueOnce(new Error("network down"));
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Failed to invite user. Check the email address and password."),
    ).toBeTruthy();
  });

  it("grants an instance-wide superadmin role after creating the account", async () => {
    vi.mocked(createAdminUser).mockResolvedValueOnce({
      user: { id: "user-1" } as never,
    });
    vi.mocked(grantUserRole).mockResolvedValueOnce(undefined as never);
    const onCreated = vi.fn();
    render(<InviteUserModal open onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.change(screen.getByLabelText("Initial role"), { target: { value: "superadmin" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(grantUserRole).toHaveBeenCalledWith("user-1", { role: "superadmin", scope_type: "instance" });
    });
    expect(onCreated).toHaveBeenCalledWith({ user: { id: "user-1" } });
  });

  it("shows the organization picker for the Administrator role and grants org-scoped admin", async () => {
    vi.mocked(fetchAdminOrganizations).mockResolvedValueOnce([{ id: "org-1", name: "Acme" }]);
    vi.mocked(createAdminUser).mockResolvedValueOnce({
      user: { id: "user-2" } as never,
    });
    vi.mocked(grantUserRole).mockResolvedValueOnce(undefined as never);
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.change(screen.getByLabelText("Initial role"), { target: { value: "admin" } });

    const orgSelect = await screen.findByLabelText("Organization scope");
    expect(screen.getByRole("option", { name: "Acme" })).toBeTruthy();
    fireEvent.change(orgSelect, { target: { value: "org-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(grantUserRole).toHaveBeenCalledWith("user-2", { role: "admin", scope_type: "organization", scope_id: "org-1" });
    });
  });

  it("shows the event picker for the Operator role and grants event-scoped operator", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([{ id: "evt-1", title: "Summer Summit" } as never]);
    vi.mocked(createAdminUser).mockResolvedValueOnce({
      user: { id: "user-3" } as never,
    });
    vi.mocked(grantUserRole).mockResolvedValueOnce(undefined as never);
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.change(screen.getByLabelText("Initial role"), { target: { value: "operator" } });

    const eventSelect = await screen.findByLabelText("Event scope");
    expect(screen.getByRole("option", { name: "Summer Summit" })).toBeTruthy();
    fireEvent.change(eventSelect, { target: { value: "evt-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(grantUserRole).toHaveBeenCalledWith("user-3", { role: "operator", scope_type: "event", scope_id: "evt-1" });
    });
  });

  it("shows an inline warning when the account is created but the initial role grant fails", async () => {
    vi.mocked(createAdminUser).mockResolvedValueOnce({
      user: { id: "user-4" } as never,
    });
    vi.mocked(grantUserRole).mockRejectedValueOnce(new Error("grant failed"));
    const onCreated = vi.fn();
    render(<InviteUserModal open onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "long-enough-password" } });
    fireEvent.change(screen.getByLabelText("Initial role"), { target: { value: "superadmin" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({
        user: { id: "user-4" },
        warning: "User created, but role assignment failed: Failed to assign role.",
      });
    });
  });
});
