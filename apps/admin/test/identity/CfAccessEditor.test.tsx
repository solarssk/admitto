// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { render } from "@testing-library/react";
import { ToastProvider } from "@admitto/ui";
import { CfAccessEditor } from "../../src/identity/CfAccessEditor.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchCfAccessSummary: vi.fn(),
    updateCfAccess: vi.fn(),
    testCfAccess: vi.fn(),
  };
});

import {
  fetchCfAccessSummary,
  updateCfAccess,
  testCfAccess,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchCfAccessSummary);
const mockUpdate = vi.mocked(updateCfAccess);
const mockTest = vi.mocked(testCfAccess);

const noLocks = { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false };

function summary(over: Partial<Awaited<ReturnType<typeof fetchCfAccessSummary>>> = {}) {
  return {
    enabled: false,
    teamDomain: "",
    audience: [],
    protectedPrefixes: [],
    locks: noLocks,
    ...over,
  };
}

function renderEditorAt(path = "/admin/settings/identity/cloudflare") {
  const router = createMemoryRouter(
    [
      { path: "/admin/settings/identity/cloudflare", element: <CfAccessEditor /> },
      { path: "/admin/settings/identity/providers", element: <div>providers-list</div> },
    ],
    { initialEntries: [path] },
  );
  return {
    router,
    ...render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("CfAccessEditor (slice 4)", () => {
  it("loads the summary and renders the field values + status badges", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({
        enabled: true,
        teamDomain: "https://team.cloudflareaccess.com",
        audience: ["aud-1", "aud-2"],
        protectedPrefixes: ["/admin", "/api/admin"],
      }),
    );
    renderEditorAt();
    await waitFor(() => expect(screen.getByDisplayValue("https://team.cloudflareaccess.com")).toBeTruthy());
    expect(screen.getByDisplayValue("aud-1, aud-2")).toBeTruthy();
    expect(screen.getByDisplayValue("/admin, /api/admin")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("saves the edited config and shows a success toast", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://old", audience: ["a"] }));
    mockUpdate.mockResolvedValueOnce(
      summary({ enabled: false, teamDomain: "https://new", audience: ["a", "b"], protectedPrefixes: ["/admin"] }),
    );
    renderEditorAt();
    const teamInput = await waitFor(() => screen.getByDisplayValue("https://old"));
    fireEvent.change(teamInput, { target: { value: "https://new" } });
    fireEvent.change(screen.getByDisplayValue("a"), { target: { value: "a, b" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      teamDomain: "https://new",
      audience: ["a", "b"],
      enabled: false,
    });
    await waitFor(() => expect(screen.getByText("Cloudflare Access settings saved.")).toBeTruthy());
  });

  it("blocks save with a toast when required fields are missing for an enabled config", async () => {
    mockFetch.mockResolvedValueOnce(summary({ enabled: false }));
    renderEditorAt();
    await waitFor(() => expect(screen.getByRole("switch", { name: /Enable Cloudflare Access/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("switch", { name: /Enable Cloudflare Access/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Please fix the highlighted fields.")).toBeTruthy());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/Team URL is required/)).toBeTruthy();
    expect(screen.getByText(/At least one Application Audience/)).toBeTruthy();
  });

  it("parses comma-separated AUD + protected prefixes into arrays on save", async () => {
    mockFetch.mockResolvedValueOnce(summary());
    mockUpdate.mockResolvedValueOnce(summary({ audience: ["x", "y"], protectedPrefixes: ["/admin", "/api/admin"] }));
    renderEditorAt();
    await waitFor(() => expect(screen.getByPlaceholderText("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("a1b2c3d4-e5f6-7890-abcd-ef1234567890"), { target: { value: "x, y" } });
    fireEvent.change(screen.getByPlaceholderText("/admin, /api/admin"), { target: { value: "/admin, /api/admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      audience: ["x", "y"],
      protectedPrefixes: ["/admin", "/api/admin"],
    });
  });

  it("Test connection sends the draft team domain and toasts success", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://team.cloudflareaccess.com" }));
    mockTest.mockResolvedValueOnce({ ok: true });
    renderEditorAt();
    await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(mockTest).toHaveBeenCalledWith("https://team.cloudflareaccess.com"));
    await waitFor(() => expect(screen.getByText("Connection verified.")).toBeTruthy());
  });

  it("Test connection surfaces a failure payload as an error toast", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    mockTest.mockResolvedValueOnce({ ok: false, error: "JWKS unreachable" });
    renderEditorAt();
    await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByText("JWKS unreachable")).toBeTruthy());
  });

  it("Test connection stays enabled when the team domain field is env-locked", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({ teamDomain: "https://t", locks: { enabled: false, teamDomain: true, audience: false, protectedPrefixes: false } }),
    );
    renderEditorAt();
    await waitFor(() => expect(screen.getByText("Locked by env")).toBeTruthy());
    const testBtn = screen.getByRole("button", { name: "Test connection" });
    expect(testBtn.hasAttribute("disabled")).toBe(false);
  });

  it("redirects to login when the load GET returns 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/cloudflare", assign: assignSpy },
    });
    try {
      renderEditorAt();
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
      );
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("redirects to login when Save returns 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockUpdate.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/cloudflare", assign: assignSpy },
    });
    try {
      renderEditorAt();
      await waitFor(() => expect(screen.getByDisplayValue("https://t")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
      );
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("redirects to login when Test returns 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockTest.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/cloudflare", assign: assignSpy },
    });
    try {
      renderEditorAt();
      await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
      );
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("shows a Retry button when the load fails generically", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockRejectedValueOnce(new ApiError(500, "server_error"));
    renderEditorAt();
    await waitFor(() => expect(screen.getByText("Couldn't load the Cloudflare Access configuration.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("discards edits and navigates back on Cancel after confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    const { router } = renderEditorAt();
    const teamInput = await waitFor(() => screen.getByDisplayValue("https://t"));
    fireEvent.change(teamInput, { target: { value: "https://edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/settings/identity/providers"));
  });

  it("keeps the editor when Cancel is dismissed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    const { router } = renderEditorAt();
    const teamInput = await waitFor(() => screen.getByDisplayValue("https://t"));
    fireEvent.change(teamInput, { target: { value: "https://edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(router.state.location.pathname).toBe("/admin/settings/identity/cloudflare");
    expect(screen.getByDisplayValue("https://edited")).toBeTruthy();
  });

  it("prompts on in-app navigation while dirty and proceeds after confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    const { router } = renderEditorAt();
    const teamInput = await waitFor(() => screen.getByDisplayValue("https://t"));
    fireEvent.change(teamInput, { target: { value: "https://edited" } });
    act(() => {
      router.navigate("/admin/settings/identity/providers");
    });
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/settings/identity/providers"));
  });

  it("resets the in-app navigation when the dirty prompt is dismissed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    const { router } = renderEditorAt();
    const teamInput = await waitFor(() => screen.getByDisplayValue("https://t"));
    fireEvent.change(teamInput, { target: { value: "https://edited" } });
    act(() => {
      router.navigate("/admin/settings/identity/providers");
    });
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(router.state.location.pathname).toBe("/admin/settings/identity/cloudflare");
  });

  it("arms a beforeunload prompt while dirty", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    renderEditorAt();
    const teamInput = await waitFor(() => screen.getByDisplayValue("https://t"));
    fireEvent.change(teamInput, { target: { value: "https://edited" } });
    const event = new Event("beforeunload", { cancelable: true });
    const preventSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(preventSpy).toHaveBeenCalled();
  });

  it("shows an error toast when Save fails generically (non-401)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockUpdate.mockRejectedValueOnce(new ApiError(400, "Invalid configuration"));
    renderEditorAt();
    await waitFor(() => expect(screen.getByDisplayValue("https://t")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Invalid configuration")).toBeTruthy());
  });

  it("shows an error toast when Test fails generically (non-401)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockTest.mockRejectedValueOnce(new ApiError(500, "Connection test failed."));
    renderEditorAt();
    await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByText("Connection test failed.")).toBeTruthy());
  });

  it("shows the default save toast when Save throws a non-ApiError", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockUpdate.mockRejectedValueOnce(new Error("network down"));
    renderEditorAt();
    await waitFor(() => expect(screen.getByDisplayValue("https://t")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Failed to save settings.")).toBeTruthy());
  });

  it("shows the default test toast when Test throws a non-ApiError", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockTest.mockRejectedValueOnce(new Error("network down"));
    renderEditorAt();
    await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByText("Connection test failed.")).toBeTruthy());
  });

  it("renders the env-locked info block when enabled is locked", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({
        enabled: true,
        teamDomain: "https://t",
        audience: ["a"],
        protectedPrefixes: ["/admin"],
        locks: { enabled: true, teamDomain: false, audience: false, protectedPrefixes: false },
      }),
    );
    renderEditorAt();
    await waitFor(() =>
      expect(screen.getByText(/enabled and locked by environment/)).toBeTruthy(),
    );
    // The enabled switch is disabled when env-locked.
    expect(screen.getByRole("switch", { name: /Enable Cloudflare Access/ }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the before-enable warning only on the off→on transition", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({ enabled: false, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }),
    );
    renderEditorAt();
    await waitFor(() => expect(screen.getByRole("switch", { name: /Enable Cloudflare Access/ })).toBeTruthy());
    expect(screen.queryByText(/Before you enable/)).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /Enable Cloudflare Access/ }));
    await waitFor(() => expect(screen.getByText(/Before you enable/)).toBeTruthy());
  });

  it("does not show the before-enable warning for an already-active config", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({ enabled: true, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }),
    );
    renderEditorAt();
    await waitFor(() => expect(screen.getByText("Active")).toBeTruthy());
    expect(screen.queryByText(/Before you enable/)).toBeNull();
  });

  it("preserves a trailing comma while typing the AUD list (raw text)", async () => {
    mockFetch.mockResolvedValueOnce(summary({ audience: ["a"] }));
    renderEditorAt();
    const audInput = await waitFor(() => screen.getByDisplayValue("a"));
    fireEvent.change(audInput, { target: { value: "a, " } });
    expect((audInput as HTMLInputElement).value).toBe("a, ");
  });

  it("blocks save when the team URL is http:// (not https://)", async () => {
    mockFetch.mockResolvedValueOnce(summary({ enabled: false, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    renderEditorAt();
    const teamInput = await waitFor(() => screen.getByDisplayValue("https://t"));
    fireEvent.change(teamInput, { target: { value: "http://team.cloudflareaccess.com" } });
    fireEvent.click(screen.getByRole("switch", { name: /Enable Cloudflare Access/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Please fix the highlighted fields.")).toBeTruthy());
    expect(screen.getByText(/Team URL must use https/)).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not block save when an env-locked schemeless team domain is present (server parity)", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({
        enabled: false,
        teamDomain: "team.cloudflareaccess.com",
        audience: ["a"],
        protectedPrefixes: ["/admin"],
        locks: { enabled: false, teamDomain: true, audience: false, protectedPrefixes: false },
      }),
    );
    mockUpdate.mockResolvedValueOnce(
      summary({ enabled: true, teamDomain: "https://team.cloudflareaccess.com", audience: ["a"], protectedPrefixes: ["/admin"], locks: { enabled: false, teamDomain: true, audience: false, protectedPrefixes: false } }),
    );
    renderEditorAt();
    await waitFor(() => expect(screen.getByRole("switch", { name: /Enable Cloudflare Access/ })).toBeTruthy());
    // Team domain input is disabled (env-locked) and seeded with the schemeless host.
    expect(screen.getByDisplayValue("team.cloudflareaccess.com").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: /Enable Cloudflare Access/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    // Locked team domain is omitted from the body; the server keeps the env value.
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ enabled: true });
    expect((mockUpdate.mock.calls[0][0] as { teamDomain?: string }).teamDomain).toBeUndefined();
  });
});
