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
  };
});

import { ApiError, fetchOrgBranding, patchOrgBranding } from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchOrgBranding);
const mockPatch = vi.mocked(patchOrgBranding);

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

  it("shows an operator-safe message with Retry when loading fails", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<OrganisationBrandingPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to load organisation branding/);
    expect(screen.queryByText("secret_internal")).toBeNull();
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
});
