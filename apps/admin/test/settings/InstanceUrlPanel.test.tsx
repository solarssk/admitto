// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstanceUrlPanel } from "../../src/settings/InstanceUrlPanel.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchSecuritySettings: vi.fn(),
    patchSecuritySettings: vi.fn(),
  };
});

import { ApiError, fetchSecuritySettings, patchSecuritySettings } from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchSecuritySettings);
const mockPatch = vi.mocked(patchSecuritySettings);

const emptySettings = {
  session_ttl_ms: { value: 86_400_000, source: "default" as const },
  operator_session_ttl_ms: { value: 43_200_000, source: "default" as const },
  trusted_device_days: { value: 30, source: "default" as const },
  mfa_required_roles: { value: ["superadmin"], source: "default" as const },
  instance_url: { value: null as string | null, source: "default" as const },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InstanceUrlPanel", () => {
  it("shows operator-safe message when settings fail to load", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    const panel = document.querySelector(".sessions-status p");
    expect(panel?.textContent).toMatch(/Failed to load instance settings/);
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("toasts save failure without leaking server detail", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    mockPatch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Instance URL")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Instance URL"), {
      target: { value: "https://tickets.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save settings/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("toasts reset failure without leaking server detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://old.example.com", source: "db" },
    });
    mockPatch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to reset settings/);
    });
  });

  it("shows warning when instance URL is unset", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    renderWithToast(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("No instance URL configured");
    });
  });

  it("shows env badge when managed by environment", async () => {
    mockFetch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://env.example.com", source: "env" },
    });
    renderWithToast(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByText("Managed by environment")).toBeTruthy();
    });
    const status = screen.getByText("Instance URL is configured via environment.");
    expect(status.tagName).toBe("OUTPUT");
    expect(status.classList.contains("mail-field-hint")).toBe(true);
    expect(status.classList.contains("text-success")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves valid HTTPS instance URL", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    mockPatch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://tickets.example.com", source: "db" },
    });
    renderWithToast(<InstanceUrlPanel />);
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

  it("rejects HTTP URL on save without calling API", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    renderWithToast(<InstanceUrlPanel />);
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
  });

  it("rejects query string on save without calling API", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    renderWithToast(<InstanceUrlPanel />);
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
    renderWithToast(<InstanceUrlPanel />);
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

  it("clears instance URL via Clear button", async () => {
    mockFetch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://old.example.com", source: "db" },
    });
    mockPatch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: null, source: "default" },
    });
    renderWithToast(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith({ instance_url: null });
    });
  });
});
