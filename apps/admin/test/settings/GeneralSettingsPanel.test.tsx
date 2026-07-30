// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralSettingsPanel } from "../../src/settings/GeneralSettingsPanel.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchSecuritySettings: vi.fn(),
    patchSecuritySettings: vi.fn(),
    fetchSupportContact: vi.fn(),
    patchSupportContact: vi.fn(),
  };
});

import {
  ApiError,
  fetchSecuritySettings,
  fetchSupportContact,
  patchSecuritySettings,
  patchSupportContact,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchSecuritySettings);
const mockPatch = vi.mocked(patchSecuritySettings);
const mockFetchContact = vi.mocked(fetchSupportContact);
const mockPatchContact = vi.mocked(patchSupportContact);

const emptySettings = {
  session_ttl_ms: { value: 86_400_000, source: "default" as const },
  operator_session_ttl_ms: { value: 43_200_000, source: "default" as const },
  trusted_device_days: { value: 30, source: "default" as const },
  mfa_required_roles: { value: ["superadmin"], source: "default" as const },
  instance_url: { value: null as string | null, source: "default" as const },
};

const emptySupportContact = { support_contact_name: null, support_contact_email: null };

beforeEach(() => {
  // Save always calls both patch endpoints (Promise.allSettled), regardless of which section a
  // given test cares about - give both a harmless default resolution so a test that only wants
  // to assert on one side doesn't also need to mock the other just to avoid an unhandled
  // rejection when the component reads `.value` off the untouched settled result.
  mockPatch.mockResolvedValue(emptySettings);
  mockFetchContact.mockResolvedValue(emptySupportContact);
  mockPatchContact.mockResolvedValue(emptySupportContact);
});

afterEach(() => {
  cleanup();
  // resetAllMocks, not clearAllMocks - clearAllMocks leaves queued mockResolvedValueOnce values
  // in place, which can leak into the next test.
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("GeneralSettingsPanel", () => {
  it("shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(<GeneralSettingsPanel />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows operator-safe message when settings fail to load", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    const panel = document.querySelector(".sessions-status p");
    expect(panel?.textContent).toMatch(/Failed to load organisation settings/);
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("toasts partial save failure without leaking server detail", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    mockPatch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Instance URL")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Instance URL"), {
      target: { value: "https://tickets.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Part of your settings failed to save/,
      );
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("toasts clear failure without leaking server detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://old.example.com", source: "db" },
    });
    mockPatch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to clear Instance URL/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("shows a warning notice when instance URL is unset", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("No instance URL configured");
    });
  });

  it("shows env badge when managed by environment, hides Clear, keeps Save", async () => {
    mockFetch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://env.example.com", source: "env" },
    });
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Managed by environment")).toBeTruthy();
    });
    const status = screen.getByText("Instance URL is configured via environment.");
    expect(status.tagName).toBe("OUTPUT");
    expect(status.classList.contains("mail-field-hint")).toBe(true);
    expect(status.classList.contains("text-success")).toBe(true);
    // Clear acts on the locked field directly, so it's hidden - but Save is page-level and
    // still needed for Support contact, so it must stay.
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("saves valid HTTPS instance URL", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    mockPatch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://tickets.example.com", source: "db" },
    });
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Instance URL")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Instance URL"), {
      target: { value: "https://tickets.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith({ instance_url: "https://tickets.example.com" });
    });
  });

  it("rejects HTTP URL on save without calling either API", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Instance URL")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Instance URL"), {
      target: { value: "http://insecure.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/must use https/i);
    });
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockPatchContact).not.toHaveBeenCalled();
  });

  it("rejects query string on save without calling API", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Instance URL")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Instance URL"), {
      target: { value: "https://tickets.example.com?preview=1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/a query/i);
    });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects embedded credentials on save without calling API", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Instance URL")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Instance URL"), {
      target: { value: "https://user:pass@tickets.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/credentials/i);
    });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("clears instance URL via the Clear action", async () => {
    mockFetch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://old.example.com", source: "db" },
    });
    mockPatch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: null, source: "default" },
    });
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith({ instance_url: null });
    });
  });

  it("saves support contact name and email", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    mockPatchContact.mockResolvedValueOnce({
      support_contact_name: "Acme Events",
      support_contact_email: "support@acme.example.com",
    });
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Contact name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Contact name"), { target: { value: "Acme Events" } });
    fireEvent.change(screen.getByLabelText("Contact email"), {
      target: { value: "support@acme.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockPatchContact).toHaveBeenCalledWith({
        support_contact_name: "Acme Events",
        support_contact_email: "support@acme.example.com",
      });
    });
  });

  it("shows an inline error for an invalid contact email without calling either API", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Contact email")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    });
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockPatchContact).not.toHaveBeenCalled();
  });

  it("reverts both unsaved fields on Reset without calling either API", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    renderWithToast(<GeneralSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Instance URL")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Instance URL"), {
      target: { value: "https://tickets.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Contact name"), { target: { value: "Acme Events" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect((screen.getByLabelText("Instance URL") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Contact name") as HTMLInputElement).value).toBe("");
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockPatchContact).not.toHaveBeenCalled();
  });
});
