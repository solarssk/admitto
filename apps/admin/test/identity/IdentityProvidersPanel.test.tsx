// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityProvidersPanel } from "../../src/identity/IdentityProvidersPanel.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchIdentityProviders: vi.fn(),
    fetchCfAccessSummary: vi.fn(),
    toggleIdentityProvider: vi.fn(),
  };
});

import {
  fetchIdentityProviders,
  fetchCfAccessSummary,
  toggleIdentityProvider,
} from "../../src/api/client.js";

const mockProviders = vi.mocked(fetchIdentityProviders);
const mockCf = vi.mocked(fetchCfAccessSummary);
const mockToggle = vi.mocked(toggleIdentityProvider);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IdentityProvidersPanel", () => {
  it("renders provider rows and CF summary after load", async () => {
    mockProviders.mockResolvedValueOnce({
      providers: [
        { id: "p1", display_name: "Google", issuer: "https://accounts.google.com", enabled: true },
        { id: "p2", display_name: "Okta", issuer: "https://okta.example.com", enabled: false },
      ],
    });
    mockCf.mockResolvedValueOnce({
      enabled: true,
      teamDomain: "team.example.com",
      audience: ["aud-1"],
      protectedPrefixes: ["/admin"],
      locks: { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false },
    });

    renderWithToast(<IdentityProvidersPanel />);

    await waitFor(() => {
      expect(screen.getByText("Google")).toBeTruthy();
      expect(screen.getByText("Okta")).toBeTruthy();
      expect(screen.getByText(/Team domain: team.example.com/)).toBeTruthy();
    });
    // Two provider switches rendered (CF "Enabled" badge is not a switch role).
    expect(screen.getAllByRole("switch").length).toBe(2);
    expect(screen.getByText("Add provider")).toBeTruthy();
  });

  it("shows empty state when there are no providers", async () => {
    mockProviders.mockResolvedValueOnce({ providers: [] });
    mockCf.mockResolvedValueOnce({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: [],
      locks: { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false },
    });

    renderWithToast(<IdentityProvidersPanel />);

    await waitFor(() => {
      expect(screen.getByText("No identity providers yet")).toBeTruthy();
    });
  });

  it("shows error state with retry when providers fail to load", async () => {
    mockProviders.mockRejectedValueOnce(new Error("boom"));
    mockCf.mockResolvedValueOnce({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: [],
      locks: { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false },
    });

    renderWithToast(<IdentityProvidersPanel />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load providers")).toBeTruthy();
    });
    const retry = screen.getByRole("button", { name: "Retry" });
    mockProviders.mockResolvedValueOnce({ providers: [] });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByText("No identity providers yet")).toBeTruthy();
    });
  });

  it("toggles a provider optimistically and persists the result", async () => {
    mockProviders.mockResolvedValueOnce({
      providers: [
        { id: "p1", display_name: "Google", issuer: "https://accounts.google.com", enabled: true },
      ],
    });
    mockCf.mockResolvedValueOnce({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: [],
      locks: { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false },
    });
    mockToggle.mockResolvedValueOnce({ id: "p1", enabled: false });

    renderWithToast(<IdentityProvidersPanel />);

    const toggleInput = await screen.findByRole("switch", { name: "Enabled" });
    expect(toggleInput).property("checked", true);
    fireEvent.click(toggleInput);
    expect(mockToggle).toHaveBeenCalledWith("p1");
    await waitFor(() => {
      expect(mockToggle).toHaveBeenCalledTimes(1);
    });
  });
});
