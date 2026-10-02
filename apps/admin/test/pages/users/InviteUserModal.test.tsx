// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { advanceTimers, deferred, makeOrgAdminAssignment } from "../../test-utils.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS } from "../../../src/utils/loading-timing.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(fetchAdminEvents).mockReset().mockResolvedValue([]);
  vi.mocked(fetchAdminOrganizations).mockReset().mockResolvedValue([]);
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
    // Busy, but still a button that keeps keyboard focus: `aria-disabled`, not `disabled`, and the label does not change.
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.getAttribute("aria-busy")).toBe("true");
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(send).toHaveProperty("disabled", false);
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

    expect(await screen.findByRole("button", { name: "Event scope, none selected" })).toBeTruthy();
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
      expect(grantUserRole).toHaveBeenCalledWith("user-2", makeOrgAdminAssignment());
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
    fireEvent.click(await screen.findByRole("button", { name: "Event scope, none selected" }));
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

  describe("its two lookups", () => {
    const pickRole = (name: "Operator" | "Administrator") => {
      fireEvent.click(screen.getByRole("button", { name: /^Initial role,/ }));
      fireEvent.click(screen.getByRole("button", { name }));
    };

    it("holds the place of the event picker from the first frame, draws it after 200ms, and swaps it for the picker when the events are in", async () => {
      const events = deferred<Array<{ id: string; title: string }>>();
      vi.mocked(fetchAdminEvents).mockReturnValue(events.promise as never);
      vi.useFakeTimers();
      render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
      pickRole("Operator");

      const place = () => screen.queryByLabelText("Loading events");
      expect(place()?.className).toContain("at-loading-hold");
      await advanceTimers(200);
      expect(place()?.className).not.toContain("at-loading-hold");

      await act(async () => events.resolve([{ id: "evt-1", title: "Summer Summit" }]));
      await advanceTimers(400);
      expect(place()).toBeNull();
      expect(screen.getByRole("button", { name: "Event scope, none selected" })).toBeTruthy();
    });

    it("says so, with a Retry that reruns only the events, when they could not be loaded, and the organizations are not touched", async () => {
      vi.mocked(fetchAdminEvents)
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce([{ id: "evt-1", title: "Summer Summit" }] as never);
      vi.mocked(fetchAdminOrganizations).mockResolvedValue([{ id: "org-1", name: "Acme Events" }]);
      render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
      fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
      pickRole("Operator");

      // An alert, not an empty picker: the picker is off, and says why.
      const hint = await screen.findByRole("alert");
      expect(within(hint).getByText("Could not load events.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Event scope, none selected" })).toHaveProperty("disabled", true);

      fireEvent.click(within(hint).getByRole("button", { name: /^Retry/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Event scope, none selected" })).toHaveProperty("disabled", false));
      expect(screen.queryByRole("alert")).toBeNull();
      // What was typed stays, and only the events were read again.
      expect((screen.getByLabelText("Email address *") as HTMLInputElement).value).toBe("new@example.com");
      expect(fetchAdminEvents).toHaveBeenCalledTimes(2);
      expect(fetchAdminOrganizations).toHaveBeenCalledTimes(1);
    });

    it("keeps the organization picker working when only the events failed", async () => {
      vi.mocked(fetchAdminEvents).mockRejectedValue(new Error("network down"));
      vi.mocked(fetchAdminOrganizations).mockResolvedValue([{ id: "org-1", name: "Acme Events" }]);
      render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
      pickRole("Administrator");
      expect(await screen.findByRole("button", { name: "Organization scope, Acme Events" })).toHaveProperty("disabled", false);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("keeps the event picker working when only the organizations failed", async () => {
      vi.mocked(fetchAdminOrganizations).mockRejectedValue(new Error("network down"));
      vi.mocked(fetchAdminEvents).mockResolvedValue([{ id: "evt-1", title: "Summer Summit" }] as never);
      render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
      pickRole("Operator");
      expect(await screen.findByRole("button", { name: "Event scope, none selected" })).toHaveProperty("disabled", false);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("reads the events without the archived ones: an invitation is not scoped to an event that is over", async () => {
      render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
      await waitFor(() => expect(fetchAdminEvents).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: false })));
    });

    it("says that the organizations could not be loaded, instead of claiming that there are none", async () => {
      vi.mocked(fetchAdminOrganizations).mockRejectedValue(new Error("network down"));
      render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
      pickRole("Administrator");

      expect(await screen.findByText("Could not load organizations.")).toBeTruthy();
      expect(screen.getByText("Could not load organizations")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry loading organizations" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Organization scope, none selected" })).toBeTruthy();
      expect(screen.queryByText("No organizations available")).toBeNull();
    });

    it("gives up on the events after 30 seconds, in the time limit's own words", async () => {
      vi.mocked(fetchAdminEvents).mockImplementation(
        (options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
          }),
      );
      vi.useFakeTimers();
      render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
      pickRole("Operator");
      await advanceTimers(LOAD_TIMEOUT_MS);
      await advanceTimers(0);
      expect(screen.getByRole("alert").textContent).toContain(`Could not load events. ${LOAD_TIMEOUT_MESSAGE}`);
    });

    it("reads them afresh each time the dialog opens", async () => {
      const { rerender } = render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
      await waitFor(() => expect(fetchAdminEvents).toHaveBeenCalledTimes(1));
      rerender(<InviteUserModal open={false} onClose={vi.fn()} onCreated={vi.fn()} />);
      rerender(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
      await waitFor(() => expect(fetchAdminEvents).toHaveBeenCalledTimes(2));
      expect(fetchAdminOrganizations).toHaveBeenCalledTimes(2);
    });
  });

  it("runs the invitation once when Send is pressed again while it works", async () => {
    vi.mocked(createAdminUser).mockImplementationOnce(() => new Promise(() => {}));
    render(<InviteUserModal open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password *"), { target: { value: "long-enough-password" } });
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    fireEvent.click(send);
    await waitFor(() => expect(createAdminUser).toHaveBeenCalledTimes(1));

    fireEvent.click(send);
    expect(createAdminUser).toHaveBeenCalledTimes(1);
    // The button the keyboard user pressed is still the focused one.
    expect(document.activeElement).toBe(send);
  });
});
