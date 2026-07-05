// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
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
    testIdentityProvider: vi.fn(),
  };
});

import {
  fetchIdentityProvider,
  createIdentityProvider,
  updateIdentityProvider,
  discoverIdentityProvider,
  testIdentityProvider,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchIdentityProvider);
const mockCreate = vi.mocked(createIdentityProvider);
const mockUpdate = vi.mocked(updateIdentityProvider);
const mockDiscover = vi.mocked(discoverIdentityProvider);
const mockTest = vi.mocked(testIdentityProvider);

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

    await waitFor(() => expect(screen.getByDisplayValue("Google")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    // Two "Group" inputs now; the second is the new empty row.
    const groupInputs = screen.getAllByLabelText("Group");
    expect(groupInputs).toHaveLength(2);
    fireEvent.change(groupInputs[1], { target: { value: "ops" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const body = mockUpdate.mock.calls[0][1];
    expect(body.mappings).toHaveLength(2);
    expect(body.mappings[1]).toMatchObject({ group: "ops", scope_type: "instance", scope_id: null });
  });

  it("removes a mapping row", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await waitFor(() => expect(screen.getByDisplayValue("admins")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove mapping" }));
    expect(screen.queryByDisplayValue("admins")).toBeNull();
    expect(screen.getByText(/No mappings yet/)).toBeTruthy();
  });

  it("blocks save when a mapping row is invalid (empty group)", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await waitFor(() => expect(screen.getByDisplayValue("admins")).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue("admins"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Group is required.")).toBeTruthy());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("requires scope_id when switching a row to organization scope", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await waitFor(() => expect(screen.getByDisplayValue("admins")).toBeTruthy());
    // Switch the row's Scope select to "organization".
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "organization" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Scope ID is required for this scope.")).toBeTruthy());
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

    await waitFor(() => expect(screen.getByRole("button", { name: "Discover" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));

    await waitFor(() => expect(mockDiscover).toHaveBeenCalledWith("p1"));
    await waitFor(() =>
      expect(screen.getByDisplayValue("https://accounts.google.com/o/oauth2/v2/auth")).toBeTruthy(),
    );
  });

  it("Test connection shows a success toast", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockTest.mockResolvedValueOnce({ ok: true });
    renderEditorAt("/admin/settings/identity/providers/p1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(mockTest).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(screen.getByText("Connection test passed.")).toBeTruthy());
  });

  it("Test connection surfaces a failure message", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockTest.mockResolvedValueOnce({ ok: false, error: "JWKS unreachable" });
    renderEditorAt("/admin/settings/identity/providers/p1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText("JWKS unreachable")).toBeTruthy());
  });
});

describe("IdentityProviderEditor — SSO preview (slice 3b)", () => {
  it("renders the custom label in the preview", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await waitFor(() => expect(screen.getByDisplayValue("Continue with Google")).toBeTruthy());
    expect(screen.getByText("Continue with Google")).toBeTruthy();
  });

  it("falls back to the product default when the label is cleared", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await waitFor(() => expect(screen.getByDisplayValue("Continue with Google")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("SSO login button label"), { target: { value: "" } });
    // Preview now shows the default copy.
    expect(screen.getByText("Continue with SSO")).toBeTruthy();
  });
});

describe("IdentityProviderEditor — discover & test error paths", () => {
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
      await waitFor(() => expect(screen.getByRole("button", { name: "Discover" })).toBeTruthy());
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Discover" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    await waitFor(() => expect(screen.getByText("Discovery failed.")).toBeTruthy());
  });

  it("redirects to login when Test returns 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockResolvedValueOnce(validDetail);
    mockTest.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/providers/p1", assign: assignSpy },
    });
    try {
      renderEditorAt("/admin/settings/identity/providers/p1");
      await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy());
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
    mockTest.mockRejectedValueOnce(new ApiError(500, "Connection test failed."));
    renderEditorAt("/admin/settings/identity/providers/p1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByText("Connection test failed.")).toBeTruthy());
  });
});

describe("IdentityProviderEditor — repeater onChange coverage", () => {
  it("changing the Role select updates the saved mapping role", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");
    await waitFor(() => expect(screen.getByDisplayValue("admins")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "operator" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].mappings[0].role).toBe("operator");
  });

  it("typing into the scope_id field is carried through on save", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");
    await waitFor(() => expect(screen.getByDisplayValue("admins")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "organization" } });
    fireEvent.change(screen.getByLabelText("Organization ID"), { target: { value: "org-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].mappings[0]).toMatchObject({
      scope_type: "organization",
      scope_id: "org-1",
    });
  });
});

describe("IdentityProviderEditor — create with a mapping", () => {
  it("POSTs a new provider with the repeater mapping carried through", async () => {
    mockCreate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/new");

    await waitFor(() => expect(screen.getByRole("button", { name: "Create provider" })).toBeTruthy());
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

    await waitFor(() => expect(screen.getByRole("button", { name: "Discover" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));

    await waitFor(() => expect(mockDiscover).toHaveBeenCalledWith("p1"));
    // Wait for the discovered endpoint to land in the field so setDraft/setBaseline
    // have both applied before we exercise the dirty guard.
    await waitFor(() =>
      expect(screen.getByDisplayValue("https://accounts.google.com/o/oauth2/v2/auth")).toBeTruthy(),
    );
    // Endpoints were persisted by Discover, so the form must not be dirty —
    // Cancel navigates away WITHOUT a discard prompt.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("providers-list")).toBeTruthy());
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

    await waitFor(() => expect(screen.getByRole("button", { name: "Discover" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("https://accounts.google.com/o/oauth2/v2/auth")).toBeTruthy(),
    );
    // Fallback path patches baseline with the discovered fields, so the form
    // is not dirty and Cancel navigates without a prompt.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("providers-list")).toBeTruthy());
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
      await waitFor(() => expect(screen.getByDisplayValue("Google")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
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

    await waitFor(() => expect(screen.getByDisplayValue("admins")).toBeTruthy());
    // The legacy role is outside MAPPING_ROLES → an "(invalid — pick a role)"
    // option is rendered so the operator sees the bad value.
    expect(screen.getByText(/owner \(invalid/)).toBeTruthy();
    // The Role Select shows a visible invalid state (CodeRabbit).
    const roleSelect = screen.getByLabelText("Role") as HTMLSelectElement;
    expect(roleSelect.className).toContain("at-select--invalid");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Pick a role.")).toBeTruthy());
    expect(mockUpdate).not.toHaveBeenCalled();

    // Bug 2: the role/scope error spans must not become extra grid items — each
    // Select + its error span is wrapped in a single grid cell, so the row keeps
    // exactly 5 direct children (Group, Role cell, Scope cell, ScopeId/hidden,
    // Remove) regardless of which errors are showing.
    const row = document.querySelector(".identity-mappings__row");
    expect(row).toBeTruthy();
    expect(row!.children).toHaveLength(5);
    // The role error span is nested inside the Role cell, not a direct grid child.
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
    await waitFor(() => expect(screen.getByDisplayValue("Provider A")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));

    // Navigate to B while A's discover is still in flight.
    await act(async () => {
      await router.navigate("/admin/settings/identity/providers/b");
    });
    await waitFor(() => expect(screen.getByDisplayValue("Provider B")).toBeTruthy());

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
