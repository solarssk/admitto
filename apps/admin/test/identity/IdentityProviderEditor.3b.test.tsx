// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter } from "react-router";
import { render } from "@testing-library/react";
import { ToastProvider } from "@admitto/ui";
import { IdentityProviderEditor } from "../../src/identity/IdentityProviderEditor.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchIdentityProvider: vi.fn(),
    createIdentityProvider: vi.fn(),
    updateIdentityProvider: vi.fn(),
    discoverIdentityProvider: vi.fn(),
    discoverIdentityProviderPreview: vi.fn(),
    testIdentityProviderDraft: vi.fn(),
  };
});

import {
  fetchIdentityProvider,
  createIdentityProvider,
  updateIdentityProvider,
  discoverIdentityProvider,
  discoverIdentityProviderPreview,
  testIdentityProviderDraft,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchIdentityProvider);
const mockCreate = vi.mocked(createIdentityProvider);
const mockUpdate = vi.mocked(updateIdentityProvider);
const mockDiscover = vi.mocked(discoverIdentityProvider);
const mockDiscoverPreview = vi.mocked(discoverIdentityProviderPreview);
const mockTestDraft = vi.mocked(testIdentityProviderDraft);

function renderEditorAt(path: string) {
  // createMemoryRouter + RouterProvider (not <MemoryRouter>) so the editor's
  // `useBlocker` has a DataRouterContext. Returns the router so tests can
  // drive in-app navigation (e.g. A→B mid-discover for the stale-response guard).
  const router = createMemoryRouter(
    [
      {
        path: "/admin/settings/identity/providers/new",
        element: <IdentityProviderEditor mode="create" />,
      },
      {
        path: "/admin/settings/identity/providers/:providerId",
        element: <IdentityProviderEditor mode="edit" />,
      },
      {
        path: "/admin/settings/identity/providers",
        element: <div>providers-list</div>,
      },
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

const validDetail = {
  id: "p1",
  provider_type: "oidc",
  display_name: "Google",
  issuer: "https://accounts.google.com",
  client_id: "client-123",
  has_client_secret: true,
  authorization_endpoint: "",
  token_endpoint: "",
  jwks_uri: "",
  userinfo_endpoint: null,
  claim_email: "email",
  claim_name: "name",
  claim_groups: "groups",
  enabled: true,
  login_button_label: "Continue with Google",
  mappings: [{ group: "admins", role: "admin", scope_type: "instance", scope_id: "" }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IdentityProviderEditor — mapping repeater (slice 3b)", () => {
  it("adds a row, edits it, and sends the full mapping list on save", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("Google");

    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    // Two "Group" inputs now; the second is the new empty row.
    const groupInputs = screen.getAllByLabelText("Group");
    expect(groupInputs).toHaveLength(2);
    fireEvent.change(groupInputs[1], { target: { value: "ops" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const body = mockUpdate.mock.calls[0][1];
    expect(body.mappings).toHaveLength(2);
    expect(body.mappings[1]).toMatchObject({ group: "ops", scope_type: "instance", scope_id: null });
  });

  it("removes a mapping row", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("admins");
    fireEvent.click(screen.getByRole("button", { name: "Remove mapping" }));
    expect(screen.queryByDisplayValue("admins")).toBeNull();
    expect(screen.getByText(/No mappings yet/)).toBeTruthy();
  });

  it("blocks save when a mapping row is invalid (empty group)", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("admins");
    fireEvent.change(screen.getByDisplayValue("admins"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Group is required.");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("requires scope_id when switching a row to organization scope", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("admins");
    // Switch the row's Scope select to "organization".
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "organization" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Scope ID is required for this scope.");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("IdentityProviderEditor — discover & test (slice 3b)", () => {
  it("Discover autofills endpoints from the issuer", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockDiscover.mockResolvedValueOnce({
      ok: true,
      endpoints: {
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      },
      provider: validDetail,
    });
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByRole("button", { name: "Discover" });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));

    await waitFor(() => expect(mockDiscover).toHaveBeenCalledWith("p1"));
    await screen.findByDisplayValue("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("Test connection shows a success toast", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockTestDraft.mockResolvedValueOnce({ ok: true });
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(mockTestDraft).toHaveBeenCalledWith({
        issuer: "https://accounts.google.com",
      }),
    );
    await screen.findByText("Connection test passed.");
  });

  it("Test connection surfaces a failure message", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockTestDraft.mockResolvedValueOnce({ ok: false, error: "JWKS unreachable" });
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText("JWKS unreachable")).toBeTruthy();
  });

  it("Test connection on create sends the draft issuer", async () => {
    mockTestDraft.mockResolvedValueOnce({ ok: true });
    renderEditorAt("/admin/settings/identity/providers/new");

    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://accounts.google.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(mockTestDraft).toHaveBeenCalledWith({
        issuer: "https://accounts.google.com",
      }),
    );
    await screen.findByText("Connection test passed.");
  });

  it("Discover on create autofills endpoints from the preview API", async () => {
    mockDiscoverPreview.mockResolvedValueOnce({
      ok: true,
      endpoints: {
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      },
    });
    renderEditorAt("/admin/settings/identity/providers/new");

    await screen.findByRole("button", { name: "Discover" });
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://accounts.google.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));

    await waitFor(() =>
      expect(mockDiscoverPreview).toHaveBeenCalledWith("https://accounts.google.com"),
    );
    await screen.findByDisplayValue("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("Test connection includes non-empty endpoints in the draft body", async () => {
    // Fill in all endpoint fields manually in create mode so oidcTestBodyFromDraft
    // hits the truthy branches for authorization_endpoint, token_endpoint, jwks_uri.
    mockTestDraft.mockResolvedValueOnce({ ok: true });
    renderEditorAt("/admin/settings/identity/providers/new");

    await screen.findByLabelText("Issuer URL");
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://accounts.google.com" },
    });
    fireEvent.change(screen.getByLabelText("Authorization endpoint"), {
      target: { value: "https://accounts.google.com/o/oauth2/v2/auth" },
    });
    fireEvent.change(screen.getByLabelText("Token endpoint"), {
      target: { value: "https://oauth2.googleapis.com/token" },
    });
    fireEvent.change(screen.getByLabelText("JWKS URI"), {
      target: { value: "https://www.googleapis.com/oauth2/v3/certs" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(mockTestDraft).toHaveBeenCalledWith({
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      }),
    );
  });
});

describe("IdentityProviderEditor — discover & test error paths", () => {
  it("shows error toast when Discover is clicked without an issuer (create mode)", async () => {
    renderEditorAt("/admin/settings/identity/providers/new");
    await screen.findByRole("button", { name: "Discover" });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    await screen.findByText("Issuer URL is required for discovery.");
    expect(mockDiscoverPreview).not.toHaveBeenCalled();
  });

  it("shows error toast when Test is clicked without an issuer", async () => {
    renderEditorAt("/admin/settings/identity/providers/new");
    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText("Issuer URL is required to test the connection.");
    expect(mockTestDraft).not.toHaveBeenCalled();
  });

  it("redirects to login when discover preview returns 401 (create mode)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockDiscoverPreview.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/providers/new", assign: assignSpy },
    });
    try {
      renderEditorAt("/admin/settings/identity/providers/new");
      await screen.findByRole("button", { name: "Discover" });
      fireEvent.change(screen.getByLabelText("Issuer URL"), {
        target: { value: "https://accounts.google.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Discover" }));
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
      );
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("shows error toast when discover preview fails generically (create mode)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockDiscoverPreview.mockRejectedValueOnce(new ApiError(400, "No OIDC metadata found."));
    renderEditorAt("/admin/settings/identity/providers/new");
    await screen.findByRole("button", { name: "Discover" });
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://accounts.google.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(await screen.findByText("No OIDC metadata found.")).toBeTruthy();
  });

  it("redirects to login when Discover returns 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(validDetail);
    mockDiscover.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/providers/p1", assign: assignSpy },
    });
    try {
      renderEditorAt("/admin/settings/identity/providers/p1");
      await screen.findByRole("button", { name: "Discover" });
      fireEvent.click(screen.getByRole("button", { name: "Discover" }));
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
      );
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("shows an error toast when Discover fails generically", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(validDetail);
    mockDiscover.mockRejectedValueOnce(new ApiError(400, "Discovery failed."));
    renderEditorAt("/admin/settings/identity/providers/p1");
    await screen.findByRole("button", { name: "Discover" });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(await screen.findByText("Discovery failed.")).toBeTruthy();
  });

  it("maps discovery_failed machine code to actionable issuer guidance", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(validDetail);
    mockDiscover.mockRejectedValueOnce(new ApiError(400, "discovery_failed", "discovery_failed"));
    renderEditorAt("/admin/settings/identity/providers/p1");
    await screen.findByRole("button", { name: "Discover" });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    await screen.findByText(/OIDC discovery/);
    expect(screen.queryByText("Discovery failed.")).toBeNull();
  });

  it("redirects to login when Test returns 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(validDetail);
    mockTestDraft.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/providers/p1", assign: assignSpy },
    });
    try {
      renderEditorAt("/admin/settings/identity/providers/p1");
      await screen.findByRole("button", { name: "Test connection" });
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
      );
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("shows an error toast when Test fails generically", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(validDetail);
    mockTestDraft.mockRejectedValueOnce(new ApiError(500, "Connection test failed."));
    renderEditorAt("/admin/settings/identity/providers/p1");
    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connection test failed.")).toBeTruthy();
  });

  it("maps invalid_issuer machine code to HTTPS guidance on test", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(validDetail);
    mockTestDraft.mockRejectedValueOnce(new ApiError(400, "invalid_issuer", "invalid_issuer"));
    renderEditorAt("/admin/settings/identity/providers/p1");
    await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText(/Issuer URL must use HTTPS/);
    expect(screen.queryByText("Connection test failed.")).toBeNull();
  });

  it("ignores stale draft-test response when issuer changed mid-flight (edit mode)", async () => {
    let resolveTest!: (v: { ok: boolean }) => void;
    mockFetch.mockResolvedValueOnce(validDetail);
    mockTestDraft.mockReturnValueOnce(new Promise((res) => { resolveTest = res; }));
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByRole("button", { name: "Test connection" });
    // Test request fires with current issuer (accounts.google.com).
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    // Change issuer while test request is in flight — draft diverges from testedBody.
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://different.example.com" },
    });

    // Resolve the stale response — should not show a toast.
    resolveTest({ ok: true });
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText("Connection test passed.")).toBeNull();
  });

  it("Save is disabled while discover preview is in flight (create mode)", async () => {
    let resolveDiscover!: (v: Awaited<ReturnType<typeof mockDiscoverPreview>>) => void;
    mockDiscoverPreview.mockReturnValueOnce(new Promise((res) => { resolveDiscover = res; }));
    renderEditorAt("/admin/settings/identity/providers/new");

    await screen.findByLabelText("Issuer URL");
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://accounts.google.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));

    // Save must be disabled while discovering is true.
    expect(
      (screen.getByRole("button", { name: "Create provider" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveDiscover({
      ok: true,
      endpoints: {
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/auth",
        token_endpoint: "https://accounts.google.com/token",
        jwks_uri: "https://accounts.google.com/jwks",
        userinfo_endpoint: null,
      },
    });

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create provider" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("ignores stale discover-preview response when issuer changed mid-flight (create mode)", async () => {
    let resolveDiscover!: (v: ReturnType<typeof mockDiscoverPreview.mock.results[0]["value"]>) => void;
    mockDiscoverPreview.mockReturnValueOnce(
      new Promise((res) => {
        resolveDiscover = res as typeof resolveDiscover;
      }),
    );
    renderEditorAt("/admin/settings/identity/providers/new");

    await screen.findByLabelText("Issuer URL");
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://a.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));

    // Change issuer while request is in flight — triggers nonce mismatch.
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://b.example.com" },
    });

    // Resolve the stale (A) response — should not touch the draft or show a toast.
    resolveDiscover({
      ok: true,
      endpoints: {
        issuer: "https://a.example.com",
        authorization_endpoint: "https://a.example.com/auth",
        token_endpoint: "https://a.example.com/token",
        jwks_uri: "https://a.example.com/jwks",
        userinfo_endpoint: null,
      },
    } as Awaited<ReturnType<typeof mockDiscoverPreview>>);

    // Give React a chance to flush any state updates the stale response might cause.
    await new Promise((r) => setTimeout(r, 50));

    // Issuer must remain B, and no endpoints for A should appear.
    expect(screen.getByDisplayValue("https://b.example.com")).toBeTruthy();
    expect(screen.queryByDisplayValue("https://a.example.com/auth")).toBeNull();
    expect(screen.queryByText("Endpoints discovered from the issuer.")).toBeNull();
  });

  it("ignores stale draft-test response when issuer changed mid-flight (create mode)", async () => {
    let resolveTest!: (v: { ok: boolean }) => void;
    mockTestDraft.mockReturnValueOnce(new Promise((res) => { resolveTest = res; }));
    renderEditorAt("/admin/settings/identity/providers/new");

    await screen.findByLabelText("Issuer URL");
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://a.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    // Change issuer while test request is in flight.
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://b.example.com" },
    });

    // Resolve the stale (A) test — should not show a toast.
    resolveTest({ ok: true });

    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText("Connection test passed.")).toBeNull();
  });

  it("ignores stale draft-test response when endpoint changed mid-flight (create mode)", async () => {
    let resolveTest!: (v: { ok: boolean }) => void;
    mockTestDraft.mockReturnValueOnce(new Promise((res) => { resolveTest = res; }));
    renderEditorAt("/admin/settings/identity/providers/new");

    await screen.findByLabelText("Issuer URL");
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://idp.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    // Change an endpoint while issuer stays the same — old guard would not catch this.
    fireEvent.change(screen.getByLabelText("Authorization endpoint"), {
      target: { value: "https://idp.example.com/new-auth" },
    });

    // Resolve the stale test — should not show a toast.
    resolveTest({ ok: true });

    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText("Connection test passed.")).toBeNull();
  });
});

describe("IdentityProviderEditor — repeater onChange coverage", () => {
  it("changing the Role select updates the saved mapping role", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");
    await screen.findByDisplayValue("admins");
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "operator" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].mappings[0].role).toBe("operator");
  });

  it("typing into the scope_id field is carried through on save", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");
    await screen.findByDisplayValue("admins");
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "organization" } });
    fireEvent.change(screen.getByLabelText("Organization ID"), { target: { value: "org-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].mappings[0]).toMatchObject({
      scope_type: "organization",
      scope_id: "org-1",
    });
  });

  it("labels the scope_id field 'Event ID' for event scope, and clears it on switching back to instance", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");
    await screen.findByDisplayValue("admins");

    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "event" } });
    expect(screen.getByLabelText("Event ID")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Event ID"), { target: { value: "evt-1" } });

    // Switching back to instance drops the scope_id field entirely, and clears
    // the value it held — a stale org/event id must not silently survive under
    // the "instance" scope it no longer applies to.
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "instance" } });
    expect(screen.queryByLabelText("Event ID")).toBeNull();
    expect(screen.queryByLabelText("Organization ID")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].mappings[0]).toMatchObject({
      scope_type: "instance",
      scope_id: null,
    });
  });
});

describe("IdentityProviderEditor — legacy invalid mapping scope_type (Codex P2)", () => {
  it("renders the invalid scope inline and blocks save with row errors", async () => {
    const legacyDetail = {
      ...validDetail,
      mappings: [{ group: "admins", role: "admin", scope_type: "legacy_scope", scope_id: "" }],
    };
    mockFetch.mockResolvedValueOnce(legacyDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("admins");
    // The legacy scope is outside MAPPING_SCOPES → an "(invalid — pick a scope)"
    // option is rendered, same treatment as an out-of-range role.
    expect(screen.getByText(/legacy_scope \(invalid/)).toBeTruthy();
    const scopeSelect = screen.getByLabelText("Scope") as HTMLSelectElement;
    expect(scopeSelect.className).toContain("at-select--invalid");
    // Any non-"instance" scope_type (valid or not) still requires a scope_id.
    expect(screen.getByLabelText("Event ID")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Pick a scope.");
    expect(screen.getByText("Scope ID is required for this scope.")).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("IdentityProviderEditor — create with a mapping", () => {
  it("POSTs a new provider with the repeater mapping carried through", async () => {
    mockCreate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/new");

    await screen.findByRole("button", { name: "Create provider" });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google" } });
    fireEvent.change(screen.getByLabelText("Issuer URL"), { target: { value: "https://accounts.google.com" } });
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "client-123" } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "secret-abc" } });

    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    fireEvent.change(screen.getAllByLabelText("Group")[0], { target: { value: "admins" } });

    fireEvent.click(screen.getByRole("button", { name: "Create provider" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const body = mockCreate.mock.calls[0][0];
    expect(body.mappings).toEqual([{ group: "admins", role: "operator", scope_type: "instance", scope_id: null }]);
  });
});

describe("IdentityProviderEditor — discover baseline refresh (Codex P2)", () => {
  it("does not flag the form dirty after Discover (endpoints already saved)", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    const discoveredProvider = {
      ...validDetail,
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    };
    mockDiscover.mockResolvedValueOnce({
      ok: true,
      endpoints: {
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      },
      provider: discoveredProvider,
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByRole("button", { name: "Discover" });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));

    await waitFor(() => expect(mockDiscover).toHaveBeenCalledWith("p1"));
    // Wait for the discovered endpoint to land in the field so setDraft/setBaseline
    // have both applied before we exercise the dirty guard.
    await screen.findByDisplayValue("https://accounts.google.com/o/oauth2/v2/auth");
    // Endpoints were persisted by Discover, so the form must not be dirty —
    // Cancel navigates away WITHOUT a discard prompt.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    await screen.findByText("providers-list");
    confirmSpy.mockRestore();
  });

  it("falls back to a targeted baseline patch when Discover returns no provider echo", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockDiscover.mockResolvedValueOnce({
      ok: true,
      endpoints: {
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      },
      provider: null,
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByRole("button", { name: "Discover" });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    await screen.findByDisplayValue("https://accounts.google.com/o/oauth2/v2/auth");
    // Fallback path patches baseline with the discovered fields, so the form
    // is not dirty and Cancel navigates without a prompt.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    await screen.findByText("providers-list");
    confirmSpy.mockRestore();
  });
});

describe("IdentityProviderEditor — submit error paths", () => {
  it("redirects to login when the update PUT returns 401", async () => {    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/providers/p1", assign: assignSpy },
    });
    try {
      renderEditorAt("/admin/settings/identity/providers/p1");
      await screen.findByDisplayValue("Google");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
      );
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });
});

describe("IdentityProviderEditor — legacy invalid mapping role (Codex P2)", () => {
  it("renders the invalid role inline and blocks save with a row error", async () => {
    const legacyDetail = {
      ...validDetail,
      mappings: [{ group: "admins", role: "owner", scope_type: "instance", scope_id: "" }],
    };
    mockFetch.mockResolvedValueOnce(legacyDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("admins");
    // The legacy role is outside MAPPING_ROLES → an "(invalid — pick a role)"
    // option is rendered so the operator sees the bad value.
    expect(screen.getByText(/owner \(invalid/)).toBeTruthy();
    // The Role Select shows a visible invalid state (CodeRabbit).
    const roleSelect = screen.getByLabelText("Role") as HTMLSelectElement;
    expect(roleSelect.className).toContain("at-select--invalid");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Pick a role.");
    expect(mockUpdate).not.toHaveBeenCalled();

    // Bug 2: the role/scope error spans must not become extra flex items — each
    // Select + its error span is wrapped in a single cell. This mapping's scope
    // is "instance" (no Organization/Event ID field), so the row has 4 direct
    // children: Group cell, Role cell, Scope cell, Remove.
    const row = document.querySelector(".identity-mappings__row");
    expect(row).toBeTruthy();
    expect(row!.children).toHaveLength(4);
    // The role error span is nested inside the Role cell, not a direct flex child.
    const roleError = screen.getByText("Pick a role.");
    expect(row!.contains(roleError)).toBe(true);
    expect(Array.from(row!.children).includes(roleError as Element)).toBe(false);
  });
});

describe("IdentityProviderEditor — stale discover guard (Bugbot high)", () => {
  it("does not merge A's discovered endpoints onto B after an A→B navigation mid-discover", async () => {
    const detailA = {
      ...validDetail,
      id: "a",
      display_name: "Provider A",
      authorization_endpoint: "https://a.example/auth",
      token_endpoint: "https://a.example/token",
      jwks_uri: "https://a.example/jwks",
      userinfo_endpoint: "https://a.example/userinfo",
    };
    const detailB = {
      ...validDetail,
      id: "b",
      display_name: "Provider B",
      authorization_endpoint: "https://b.example/auth",
      token_endpoint: "https://b.example/token",
      jwks_uri: "https://b.example/jwks",
      userinfo_endpoint: "https://b.example/userinfo",
      mappings: [],
    };
    mockFetch.mockResolvedValueOnce(detailA);
    mockFetch.mockResolvedValueOnce(detailB);

    // A pending discover we resolve manually after navigating to B.
    let resolveDiscover!: (value: {
      ok: true;
      endpoints: {
        issuer: string;
        authorization_endpoint: string;
        token_endpoint: string;
        jwks_uri: string;
        userinfo_endpoint: string | null;
      };
      provider: typeof validDetail;
    }) => void;
    mockDiscover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDiscover = resolve;
        }),
    );

    const { router } = renderEditorAt("/admin/settings/identity/providers/a");
    await screen.findByDisplayValue("Provider A");
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));

    // Navigate to B while A's discover is still in flight.
    await act(async () => {
      await router.navigate("/admin/settings/identity/providers/b");
    });
    await screen.findByDisplayValue("Provider B");

    // Now resolve A's discover — it must NOT touch B's draft.
    resolveDiscover({
      ok: true,
      endpoints: {
        issuer: "https://a.example",
        authorization_endpoint: "https://a.example/auth",
        token_endpoint: "https://a.example/token",
        jwks_uri: "https://a.example/jwks",
        userinfo_endpoint: "https://a.example/userinfo",
      },
      provider: detailA,
    });

    // Give the stale resolution a chance to (incorrectly) apply.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Endpoints discovered from the issuer.")).toBeNull();
    // B's endpoints are unchanged — A's values did not leak across.
    expect(screen.getByDisplayValue("https://b.example/auth")).toBeTruthy();
    // Bug 1: the busy flags must be reset on B, so Discover/Test/Save are not
    // permanently disabled by A's in-flight request.
    await waitFor(() => {
      const discoverBtn = screen.getByRole("button", { name: "Discover" });
      expect(discoverBtn.hasAttribute("disabled")).toBe(false);
    });
  });
});
