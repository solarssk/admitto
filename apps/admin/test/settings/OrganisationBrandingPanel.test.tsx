// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganisationBrandingPanel } from "../../src/settings/OrganisationBrandingPanel.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchOrgBranding: vi.fn(),
    patchOrgBranding: vi.fn(),
    uploadFile: vi.fn(),
  };
});

import { ApiError, fetchOrgBranding, patchOrgBranding, uploadFile } from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchOrgBranding);
const mockPatch = vi.mocked(patchOrgBranding);
const mockUpload = vi.mocked(uploadFile);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrganisationBrandingPanel", () => {
  it("loads and displays the saved organisation name and logo preview", async () => {
    mockFetch.mockResolvedValueOnce({
      org_name: "Acme Corp",
      logo_url: "https://cdn.example.com/logo.png",
    });
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toHaveProperty("value", "Acme Corp");
    });
    expect(screen.getByAltText(/organisation logo preview/i)).toBeTruthy();
  });

  it("shows an operator-safe inline message with Retry when loading fails, without a toast", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Failed to load organisation branding/);
    expect(screen.queryByText("secret_internal")).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("blocks save with an empty organisation name, without calling the API", async () => {
    mockFetch.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "" });
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Organisation name"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await waitFor(() => {
      expect(screen.getByText("Organisation name is required.")).toBeTruthy();
    });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("saves the updated organisation name", async () => {
    mockFetch.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "" });
    mockPatch.mockResolvedValueOnce({ org_name: "New Name Inc", logo_url: "" });
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Organisation name"), {
      target: { value: "New Name Inc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith({ org_name: "New Name Inc", logo_url: null });
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Organisation branding saved/);
    });
  });

  it("saves with a valid external HTTPS logo URL, passing it through to the API", async () => {
    mockFetch.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "" });
    mockPatch.mockResolvedValueOnce({
      org_name: "Acme Corp",
      logo_url: "https://cdn.example.com/logo.png",
    });
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Use external HTTPS URL" }));
    fireEvent.change(screen.getByLabelText("External logo URL (HTTPS)"), {
      target: { value: "https://cdn.example.com/logo.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith({
        org_name: "Acme Corp",
        logo_url: "https://cdn.example.com/logo.png",
      });
    });
  });

  it("blocks save with a non-HTTPS logo URL, without calling the API", async () => {
    mockFetch.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "" });
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Use external HTTPS URL" }));
    fireEvent.change(screen.getByLabelText("External logo URL (HTTPS)"), {
      target: { value: "http://insecure.example.com/logo.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Logo must be a valid HTTPS URL/);
    });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("toasts save failure without leaking server detail", async () => {
    mockFetch.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "" });
    mockPatch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Failed to save organisation branding/,
      );
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("restores last saved values via Reset to saved", async () => {
    mockFetch.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "" });
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toHaveProperty("value", "Acme Corp");
    });
    fireEvent.change(screen.getByLabelText("Organisation name"), {
      target: { value: "Unsaved Draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset to saved" }));
    expect(screen.getByLabelText("Organisation name")).toHaveProperty("value", "Acme Corp");
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("disables Save and Reset while a logo upload is in flight, so a mid-upload click can't save a stale logo", async () => {
    mockFetch.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "" });
    let resolveUpload!: (result: { url: string }) => void;
    mockUpload.mockReturnValueOnce(new Promise((resolve) => (resolveUpload = resolve)));
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Save branding" }).hasAttribute("disabled")).toBe(
      false,
    );

    const [fileInput] = document.querySelectorAll('input[type="file"]');
    fireEvent.change(fileInput!, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Uploading…" }).hasAttribute("disabled")).toBe(
        true,
      );
    });
    expect(screen.getByRole("button", { name: "Reset to saved" }).hasAttribute("disabled")).toBe(
      true,
    );

    resolveUpload({ url: "/uploads/default/logo.png" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save branding" }).hasAttribute("disabled")).toBe(
        false,
      );
    });
  });
});
