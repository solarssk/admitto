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

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createAdminUser).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "long-enough-password",
        display_name: null,
        phone_country_code: null,
        phone_number: null,
        must_change_password: true,
      });
    });
    expect(screen.getByRole("button", { name: "Sending…" })).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Email address *")).toHaveProperty("disabled", true);
  });

  it("resists browser/password-manager autofill on email, phone, and temporary password", () => {
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    const email = screen.getByLabelText("Email address *") as HTMLInputElement;
    expect(email.autocomplete).toBe("off");
    expect(email.getAttribute("data-1p-ignore")).toBe("true");
    expect(email.getAttribute("data-lpignore")).toBe("true");

    const phone = screen.getByLabelText("Phone number", { selector: "input[type=tel]" }) as HTMLInputElement;
    expect(phone.autocomplete).toBe("off");
    expect(phone.getAttribute("data-1p-ignore")).toBe("true");
    expect(phone.getAttribute("data-lpignore")).toBe("true");

    const password = screen.getByLabelText("Temporary password *") as HTMLInputElement;
    expect(password.autocomplete).toBe("new-password");
  });

  it("includes an optional phone number when filled in", async () => {
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.change(screen.getByLabelText("Phone number", { selector: "input[type=tel]" }), {
      target: { value: "555 0100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createAdminUser).toHaveBeenCalledWith(
        expect.objectContaining({ phone_country_code: null, phone_number: "555 0100" }),
      );
    });
  });

  it("sends must_change_password: false when the switch is turned off", async () => {
    vi.mocked(createAdminUser).mockResolvedValueOnce({
      user: { id: "usr-1" } as never,
    });
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByLabelText("Require password change on first login"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createAdminUser).toHaveBeenCalledWith(
        expect.objectContaining({ must_change_password: false }),
      );
    });
  });

  it("reveals the event scope picker after picking Operator as the initial role", async () => {
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /^Event scope,/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Operator" }));

    expect(screen.getByRole("button", { name: "Event scope, none selected" })).toBeTruthy();
  });

  it("reveals the organization scope picker after picking Administrator as the initial role", async () => {
    vi.mocked(fetchAdminOrganizations).mockResolvedValueOnce([{ id: "org-1", name: "Acme Events" }]);
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /^Organization scope,/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Administrator" }));

    // Defaults to the first fetched org - unlike the event picker, which has no such default.
    expect(await screen.findByRole("button", { name: "Organization scope, Acme Events" })).toBeTruthy();
  });

  it("shows an inline error and does not create the account when Operator is picked with no event selected", async () => {
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Operator" }));

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Select an event for the operator role.")).toBeTruthy();
    expect(createAdminUser).not.toHaveBeenCalled();
  });

  it("shows an inline error and does not create the account when Administrator is picked with no organization available to default to", async () => {
    vi.mocked(fetchAdminOrganizations).mockResolvedValueOnce([]);
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Administrator" }));

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Select an organization for the admin role.")).toBeTruthy();
    expect(createAdminUser).not.toHaveBeenCalled();
  });

  it("resets the form when Cancel is clicked, so the fields are empty next time it opens", () => {
    const onClose = vi.fn();
    render(<InviteUserModal open onClose={onClose} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect((screen.getByLabelText("Email address *") as HTMLInputElement).value).toBe("");
  });

  it("lists actual fetched events as options once Operator is picked", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([
      { id: "evt-1", title: "Summer Summit", slug: "summer-summit", date: "2026-07-01", timezone: "UTC", location: null, organization_id: "org-1", archived_at: null },
    ]);
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Operator" }));
    fireEvent.click(await screen.findByRole("button", { name: "Event scope, none selected" }));

    expect(await screen.findByRole("button", { name: "Summer Summit" })).toBeTruthy();
  });

  it("shows a validation message for an already-taken email", async () => {
    const { ApiError } = await import("../../../src/api/client.js");
    vi.mocked(createAdminUser).mockRejectedValueOnce(new ApiError("email_taken"));
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "taken@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("A user with this email already exists.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
  });

  it("shows a validation message for an invalid_request response", async () => {
    const { ApiError } = await import("../../../src/api/client.js");
    vi.mocked(createAdminUser).mockRejectedValueOnce(new ApiError("invalid_request"));
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Check the email address and the temporary password (at least 12 characters)."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
  });

  it("falls back to a generic message for a non-API error", async () => {
    vi.mocked(createAdminUser).mockRejectedValueOnce(new Error("network down"));
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
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

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));
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

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Administrator" }));
    // Organizations pre-fill to the first fetched org (see InviteUserModal's own load effect).
    await screen.findByRole("button", { name: "Organization scope, Acme" });
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

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Operator" }));
    fireEvent.click(screen.getByRole("button", { name: "Event scope, none selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Summer Summit" }));
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

    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Superadmin" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({
        user: { id: "user-4" },
        warning: "User created, but role assignment failed: Failed to assign role.",
      });
    });
  });
});
