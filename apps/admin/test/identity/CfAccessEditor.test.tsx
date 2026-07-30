// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter } from "react-router";
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
  it("shows the loading spinner once the fetch has genuinely taken a moment", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderEditorAt();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText("Loading Cloudflare Access")).toBeTruthy();
    vi.useRealTimers();
  });

  it("shows the title and a working close button even while still loading (Sonar/PO review)", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    renderEditorAt();

    expect(screen.getByText("Cloudflare Access")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("providers-list")).toBeTruthy();
  });

  it("ignores a backdrop click, including while still loading", () => {
    // Backdrop-click is deliberately inert (not a close action) - a superadmin mid-edit
    // shouldn't lose work to a stray click outside the panel. The dialog renders via
    // createPortal(document.body), not inside the render() container.
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    const { router } = renderEditorAt();

    fireEvent.click(document.querySelector(".identity-modal__backdrop")!);

    expect(router.state.location.pathname).toBe("/admin/settings/identity/cloudflare");
  });

  it("moves focus into the modal once the load resolves, instead of leaving it stuck outside (Sonar/PO review)", async () => {
    mockFetch.mockResolvedValueOnce(summary());
    renderEditorAt();

    await waitFor(() => {
      const panel = document.querySelector(".identity-modal__panel");
      expect(panel?.contains(document.activeElement)).toBe(true);
    });
  });

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
    await screen.findByDisplayValue("https://team.cloudflareaccess.com");
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
    const teamInput = await screen.findByDisplayValue("https://old");
    fireEvent.change(teamInput, { target: { value: "https://new" } });
    fireEvent.change(screen.getByDisplayValue("a"), { target: { value: "a, b" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      teamDomain: "https://new",
      audience: ["a", "b"],
      enabled: false,
    });
    await screen.findByText("Cloudflare Access settings saved.");
  });

  it("navigates back to the providers list after a successful save", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://old", audience: ["a"] }));
    mockUpdate.mockResolvedValueOnce(summary({ teamDomain: "https://new", audience: ["a"] }));
    const { router } = renderEditorAt();
    const teamInput = await screen.findByDisplayValue("https://old");
    fireEvent.change(teamInput, { target: { value: "https://new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/settings/identity/providers"));
  });

  it("keeps the modal open when Close is clicked or Escape is pressed while saving", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://old", audience: ["a"] }));
    let resolveUpdate: (r: ReturnType<typeof summary>) => void = () => {};
    mockUpdate.mockImplementationOnce(
      () => new Promise((resolve) => { resolveUpdate = resolve; }),
    );
    const { router } = renderEditorAt();
    const teamInput = await screen.findByDisplayValue("https://old");
    fireEvent.change(teamInput, { target: { value: "https://new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));

    const closeButton = screen.getByRole("button", { name: "Close" });
    expect(closeButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(closeButton);
    expect(router.state.location.pathname).toBe("/admin/settings/identity/cloudflare");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(router.state.location.pathname).toBe("/admin/settings/identity/cloudflare");

    resolveUpdate(summary({ teamDomain: "https://new", audience: ["a"] }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/settings/identity/providers"));
  });

  it("blocks save with a toast when required fields are missing for an enabled config", async () => {
    mockFetch.mockResolvedValueOnce(summary({ enabled: false }));
    renderEditorAt();
    await screen.findByRole("switch", { name: "Enabled" });
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Please fix the highlighted fields.");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/Team URL is required/)).toBeTruthy();
    expect(screen.getByText(/At least one Application Audience/)).toBeTruthy();
  });

  it("parses comma-separated AUD + protected prefixes into arrays on save", async () => {
    mockFetch.mockResolvedValueOnce(summary());
    mockUpdate.mockResolvedValueOnce(summary({ audience: ["x", "y"], protectedPrefixes: ["/admin", "/api/admin"] }));
    renderEditorAt();
    await screen.findByPlaceholderText("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    fireEvent.change(screen.getByPlaceholderText("a1b2c3d4-e5f6-7890-abcd-ef1234567890"), { target: { value: "x, y" } });
    fireEvent.change(screen.getByPlaceholderText("/admin, /api/admin"), { target: { value: "/admin, /api/admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      audience: ["x", "y"],
      protectedPrefixes: ["/admin", "/api/admin"],
    });
  });

  it("parses a pasted JSON-array AUD list into clean values on save (server parity)", async () => {
    mockFetch.mockResolvedValueOnce(summary());
    mockUpdate.mockResolvedValueOnce(summary({ audience: ["aud-1", "aud-2"], protectedPrefixes: ["/admin"] }));
    renderEditorAt();
    const audInput = await screen.findByPlaceholderText("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    fireEvent.change(audInput, { target: { value: '["aud-1","aud-2"]' } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ audience: ["aud-1", "aud-2"] });
  });

  it("Test connection sends the draft team domain and toasts success", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://team.cloudflareaccess.com" }));
    mockTest.mockResolvedValueOnce({ ok: true });
    renderEditorAt();
    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(mockTest).toHaveBeenCalledWith("https://team.cloudflareaccess.com"));
    await screen.findByText("Connection verified.");
  });

  it("Test connection surfaces a failure payload as an error toast", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    mockTest.mockResolvedValueOnce({ ok: false, error: "JWKS unreachable" });
    renderEditorAt();
    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("JWKS unreachable")).toBeTruthy();
  });

  it("Test connection stays enabled when the team domain field is env-locked", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({ teamDomain: "https://t", locks: { enabled: false, teamDomain: true, audience: false, protectedPrefixes: false } }),
    );
    renderEditorAt();
    await screen.findByText("Locked by env");
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
      await screen.findByDisplayValue("https://t");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
      await screen.findByRole("button", { name: "Test connection" });
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
    await screen.findByText("Couldn't load the Cloudflare Access configuration.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("discards edits and navigates back on Cancel after confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    const { router } = renderEditorAt();
    const teamInput = await screen.findByDisplayValue("https://t");
    fireEvent.change(teamInput, { target: { value: "https://edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/settings/identity/providers"));
  });

  it("keeps the editor when Cancel is dismissed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    const { router } = renderEditorAt();
    const teamInput = await screen.findByDisplayValue("https://t");
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
    const teamInput = await screen.findByDisplayValue("https://t");
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
    const teamInput = await screen.findByDisplayValue("https://t");
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
    const teamInput = await screen.findByDisplayValue("https://t");
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
    await screen.findByDisplayValue("https://t");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Invalid configuration")).toBeTruthy();
  });

  it("shows an error toast when Test fails generically (non-401)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockTest.mockRejectedValueOnce(new ApiError(500, "Connection test failed."));
    renderEditorAt();
    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connection test failed.")).toBeTruthy();
  });

  it("maps invalid_team_domain to actionable team URL guidance", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "not-a-url", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockTest.mockRejectedValueOnce(new ApiError(400, "invalid_team_domain", "invalid_team_domain"));
    renderEditorAt();
    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText(/HTTPS Cloudflare Access team URL/);
    expect(screen.queryByText("Connection test failed.")).toBeNull();
  });

  it("maps team_domain_required when no team URL is configured", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockTest.mockRejectedValueOnce(new ApiError(400, "team_domain_required", "team_domain_required"));
    renderEditorAt();
    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText(/team URL before testing/i);
    expect(screen.queryByText("Connection test failed.")).toBeNull();
  });

  it("shows the default save toast when Save throws a non-ApiError", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockUpdate.mockRejectedValueOnce(new Error("network down"));
    renderEditorAt();
    await screen.findByDisplayValue("https://t");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Failed to save settings.")).toBeTruthy();
  });

  it("shows the default test toast when Test throws a non-ApiError", async () => {
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    mockTest.mockRejectedValueOnce(new Error("network down"));
    renderEditorAt();
    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connection test failed.")).toBeTruthy();
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
    await screen.findByText(/enabled and locked by environment/);
    // The enabled switch is disabled when env-locked.
    expect(screen.getByRole("switch", { name: "Enabled" }).hasAttribute("disabled")).toBe(true);
    // The header also carries an at-a-glance "Managed by environment" badge.
    expect(screen.getByText("Managed by environment")).toBeTruthy();
  });

  it("shows the before-enable warning only on the off→on transition", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({ enabled: false, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }),
    );
    renderEditorAt();
    await screen.findByRole("switch", { name: "Enabled" });
    expect(screen.queryByText(/Before you enable/)).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    const warning = await screen.findByText(/Before you enable/);
    expect(warning.closest(".at-notice--warning")).toBeTruthy();
  });

  it("does not show the before-enable warning for an already-active config", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({ enabled: true, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }),
    );
    renderEditorAt();
    await screen.findByText("Active");
    expect(screen.queryByText(/Before you enable/)).toBeNull();
  });

  it("preserves a trailing comma while typing the AUD list (raw text)", async () => {
    mockFetch.mockResolvedValueOnce(summary({ audience: ["a"] }));
    renderEditorAt();
    const audInput = await screen.findByDisplayValue("a");
    fireEvent.change(audInput, { target: { value: "a, " } });
    expect((audInput as HTMLInputElement).value).toBe("a, ");
  });

  it("blocks save when the team URL is http:// (not https://)", async () => {
    mockFetch.mockResolvedValueOnce(summary({ enabled: false, teamDomain: "https://t", audience: ["a"], protectedPrefixes: ["/admin"] }));
    renderEditorAt();
    const teamInput = await screen.findByDisplayValue("https://t");
    fireEvent.change(teamInput, { target: { value: "http://team.cloudflareaccess.com" } });
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Please fix the highlighted fields.");
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
    await screen.findByRole("switch", { name: "Enabled" });
    // Team domain input is disabled (env-locked) and seeded with the schemeless host.
    expect(screen.getByDisplayValue("team.cloudflareaccess.com").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    // Locked team domain is omitted from the body; the server keeps the env value.
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ enabled: true });
    expect((mockUpdate.mock.calls[0][0] as { teamDomain?: string }).teamDomain).toBeUndefined();
  });

  it("navigates back on Cancel without prompting when there are no edits", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    mockFetch.mockResolvedValueOnce(summary({ teamDomain: "https://t" }));
    const { router } = renderEditorAt();
    await screen.findByDisplayValue("https://t");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/settings/identity/providers"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("renders a Locked-by-env badge on every env-locked field and disables the inputs", async () => {
    mockFetch.mockResolvedValueOnce(
      summary({
        enabled: true,
        teamDomain: "https://t",
        audience: ["a"],
        protectedPrefixes: ["/admin"],
        locks: { enabled: true, teamDomain: true, audience: true, protectedPrefixes: true },
      }),
    );
    renderEditorAt();
    await screen.findByText(/enabled and locked by environment/);
    // Every field is env-locked → every input is disabled and carries a badge.
    expect(screen.getByRole("switch", { name: "Enabled" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByDisplayValue("https://t").hasAttribute("disabled")).toBe(true);
    expect(screen.getByDisplayValue("a").hasAttribute("disabled")).toBe(true);
    expect(screen.getByDisplayValue("/admin").hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Locked by env").length).toBeGreaterThanOrEqual(4);
    // Test connection stays enabled (only gated by testing/saving).
    expect(screen.getByRole("button", { name: "Test connection" }).hasAttribute("disabled")).toBe(false);
  });
});
