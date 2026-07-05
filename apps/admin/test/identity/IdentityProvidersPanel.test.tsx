// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
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
      locks: { enabled: true, teamDomain: false, audience: false, protectedPrefixes: false },
    });

    renderWithToast(<IdentityProvidersPanel />);

    await waitFor(() => {
      expect(screen.getByText("Google")).toBeTruthy();
      expect(screen.getByText("Okta")).toBeTruthy();
      expect(screen.getByText(/Team domain: team.example.com/)).toBeTruthy();
    });
    // Two provider switches rendered (CF "Enabled" badge is not a switch role).
    expect(screen.getAllByRole("switch").length).toBe(2);
    expect(screen.getByText("Managed by environment")).toBeTruthy();
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
    // Persisted state: the switch settles to unchecked once { enabled: false } resolves.
    await waitFor(() => expect(toggleInput).property("checked", false));
  });

  it("keeps both switches disabled while two providers toggle concurrently", async () => {
    mockProviders.mockResolvedValueOnce({
      providers: [
        { id: "p1", display_name: "Google", issuer: "https://accounts.google.com", enabled: true },
        { id: "p2", display_name: "Okta", issuer: "https://okta.example.com", enabled: false },
      ],
    });
    mockCf.mockResolvedValueOnce({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: [],
      locks: { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false },
    });
    // Resolve both toggles only after we assert; lets us observe the in-flight state.
    let resolveP1: (value: { id: string; enabled: boolean }) => void = () => {};
    let resolveP2: (value: { id: string; enabled: boolean }) => void = () => {};
    mockToggle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveP1 = resolve;
        }),
    );
    mockToggle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveP2 = resolve;
        }),
    );

    renderWithToast(<IdentityProvidersPanel />);

    const switches = await screen.findAllByRole("switch");
    fireEvent.click(switches[0]!);
    fireEvent.click(switches[1]!);

    // Both switches are disabled while their respective toggles are in flight —
    // the second click must not re-enable the first row.
    await waitFor(() => expect(switches[0]).property("disabled", true));
    expect(switches[1]).property("disabled", true);

    resolveP1({ id: "p1", enabled: false });
    // After p1 settles, only p1's switch re-enables; p2 stays disabled.
    await waitFor(() => expect(switches[0]).property("disabled", false));
    expect(switches[1]).property("disabled", true);

    resolveP2({ id: "p2", enabled: true });
    await waitFor(() => expect(switches[1]).property("disabled", false));
  });

  it("refetches the list when a toggle fails (e.g. 409 race) instead of reverting to a stale value", async () => {
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
    // After the failed toggle, the refetch returns the server truth: a concurrent
    // toggle won, so the provider is still enabled.
    mockProviders.mockResolvedValueOnce({
      providers: [
        { id: "p1", display_name: "Google", issuer: "https://accounts.google.com", enabled: true },
      ],
    });
    mockToggle.mockRejectedValueOnce(new ApiError(409, "toggle_race"));

    renderWithToast(<IdentityProvidersPanel />);

    const toggleInput = await screen.findByRole("switch", { name: "Enabled" });
    fireEvent.click(toggleInput);
    await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1));
    // Initial load + refetch after the failed toggle.
    await waitFor(() => expect(mockProviders).toHaveBeenCalledTimes(2));
    // The switch reflects the server truth (enabled), not the optimistic flip (disabled).
    await waitFor(() => expect(toggleInput).property("checked", true));
  });

  it("redirects to login when the providers fetch returns 401", async () => {
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/providers", assign: assignSpy },
    });
    try {
      mockProviders.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
      mockCf.mockResolvedValueOnce({
        enabled: false,
        teamDomain: "",
        audience: [],
        protectedPrefixes: [],
        locks: { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false },
      });

      renderWithToast(<IdentityProvidersPanel />);

      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
      );
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("renders the CF Access summary card for a disabled, unconfigured CF Access", async () => {
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
      expect(screen.getByText("(disabled)")).toBeTruthy();
      expect(screen.getByText("No team domain configured.")).toBeTruthy();
      expect(screen.getByText("Disabled")).toBeTruthy();
    });
  });

  it("shows CF error state with retry and recovers", async () => {
    mockProviders.mockResolvedValueOnce({ providers: [] });
    mockCf.mockRejectedValueOnce(new Error("cf boom"));

    renderWithToast(<IdentityProvidersPanel />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load Cloudflare Access")).toBeTruthy();
    });
    mockCf.mockResolvedValueOnce({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: [],
      locks: { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByText("No team domain configured.")).toBeTruthy();
    });
  });
});
