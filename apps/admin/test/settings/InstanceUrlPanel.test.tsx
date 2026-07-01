// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstanceUrlPanel } from "../../src/settings/InstanceUrlPanel.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchSecuritySettings: vi.fn(),
    patchSecuritySettings: vi.fn(),
  };
});

import { fetchSecuritySettings, patchSecuritySettings } from "../../src/api/client.js";

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
  it("shows warning when instance URL is unset", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    render(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("No instance URL configured");
    });
  });

  it("shows env badge when managed by environment", async () => {
    mockFetch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://env.example.com", source: "env" },
    });
    render(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByText("Managed by environment")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves valid HTTPS instance URL", async () => {
    mockFetch.mockResolvedValueOnce(emptySettings);
    mockPatch.mockResolvedValueOnce({
      ...emptySettings,
      instance_url: { value: "https://tickets.example.com", source: "db" },
    });
    render(<InstanceUrlPanel />);
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
    render(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Instance URL")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Instance URL"), {
      target: { value: "http://insecure.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/must use https/i)).toBeTruthy();
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
    render(<InstanceUrlPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith({ instance_url: null });
    });
  });
});
