// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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
  // `useBlocker` has a DataRouterContext.
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
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
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

// Silence unused import in some configs.
void createIdentityProvider;

describe("IdentityProviderEditor — discover baseline refresh (Codex P2)", () => {
  it("does not flag the form dirty after Discover (endpoints already saved)", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Pick a role.")).toBeTruthy());
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
