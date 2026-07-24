// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, Link, Outlet } from "react-router";
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
  };
});

import {
  fetchIdentityProvider,
  createIdentityProvider,
  updateIdentityProvider,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchIdentityProvider);
const mockCreate = vi.mocked(createIdentityProvider);
const mockUpdate = vi.mocked(updateIdentityProvider);

function renderEditorAt(path: string) {
  // createMemoryRouter + RouterProvider (not the component <MemoryRouter>) so the
  // editor's `useBlocker` has a DataRouterContext. The pathless layout route
  // renders a "Providers" link so in-app navigation away from a dirty draft can
  // be exercised — that path is what the router-level dirty guard must catch.
  const router = createMemoryRouter(
    [
      {
        element: (
          <div>
            <Link to="/admin/settings/identity/providers">Providers</Link>
            <Outlet />
          </div>
        ),
        children: [
          { path: "/admin/settings/identity/providers/new", element: <IdentityProviderEditor mode="create" /> },
          {
            path: "/admin/settings/identity/providers/:providerId",
            element: <IdentityProviderEditor mode="edit" />,
          },
          {
            path: "/admin/settings/identity/providers",
            element: <div>providers-list</div>,
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return { router, ...render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  ) };
}

const validDetail = {
  id: "p1",
  provider_type: "oidc",
  display_name: "Google",
  issuer: "https://accounts.google.com",
  client_id: "client-123",
  has_client_secret: true,
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
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

describe("IdentityProviderEditor — create", () => {
  it("blocks submit and shows validation errors when required fields are empty", async () => {
    renderEditorAt("/admin/settings/identity/providers/new");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create provider" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }));

    await waitFor(() => {
      expect(screen.getByText("Display name is required.")).toBeTruthy();
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates the provider and navigates back to the list on valid submit", async () => {
    mockCreate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/new");

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google" } });
    fireEvent.change(screen.getByLabelText("Issuer URL"), {
      target: { value: "https://accounts.google.com" },
    });
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "client-123" } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "secret-abc" } });

    fireEvent.click(screen.getByRole("button", { name: "Create provider" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
    const body = mockCreate.mock.calls[0][0];
    expect(body.display_name).toBe("Google");
    expect(body.client_secret).toBe("secret-abc");
    expect(body.mappings).toEqual([]);
    // Blank optional endpoint/claim fields are omitted (undefined), not sent as "".
    expect(body.authorization_endpoint).toBeUndefined();
    expect(body.claim_email).toBeUndefined();
    await waitFor(() => {
      expect(screen.getByText("providers-list")).toBeTruthy();
    });
  });
});

describe("IdentityProviderEditor — edit", () => {
  it("loads the provider and PUTs the full form with mappings carried through", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await waitFor(() => {
      expect(screen.getByDisplayValue("Google")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google SSO" } });
    // Leave client secret blank → must NOT be sent (kept).
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith("p1", expect.objectContaining({ display_name: "Google SSO" }));
    });
    const body = mockUpdate.mock.calls[0][1];
    expect(body.client_secret).toBeUndefined();
    expect(body.mappings).toEqual([{ group: "admins", role: "admin", scope_type: "instance", scope_id: null }]);
    expect(body.login_button_label).toBe("Continue with Google");
  });

  it("renders a not-found state when the provider is missing", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockRejectedValueOnce(new ApiError(404, "not_found", "not_found"));
    renderEditorAt("/admin/settings/identity/providers/missing");

    await waitFor(() => {
      expect(screen.getByText("This provider no longer exists.")).toBeTruthy();
    });
  });

  it("re-fetches when navigating from one provider edit URL to another (no stale save)", async () => {
    mockFetch.mockResolvedValueOnce(validDetail); // p1
    const p2Detail = { ...validDetail, id: "p2", display_name: "Okta", issuer: "https://okta.example.com" };
    mockFetch.mockResolvedValueOnce(p2Detail); // p2
    mockUpdate.mockResolvedValueOnce(p2Detail);
    const { router } = renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("Google");

    // In-app nav to a different provider's edit URL: the editor must re-fetch,
    // not keep p1's data on screen (which would let Save PUT p1's config onto p2).
    router.navigate("/admin/settings/identity/providers/p2");

    await screen.findByDisplayValue("Okta");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("p2", expect.anything()));
  });

  it("keeps the stored secret when the field is touched then cleared on edit", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("Google");

    // Type then clear the secret: touched=true, value="". Validation must pass
    // (blank = keep stored) and the save body must NOT send an empty secret.
    fireEvent.change(screen.getByLabelText(/client secret/i), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/client secret/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][1].client_secret).toBeUndefined();
  });

  it("redirects to login when the edit fetch returns 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/settings/identity/providers/p1", assign: assignSpy },
    });
    try {
      mockFetch.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
      renderEditorAt("/admin/settings/identity/providers/p1");

      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
      );
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("recovers from a load error via the Retry button", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockRejectedValueOnce(new ApiError(500, "boom"));
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByText("Couldn't load this provider.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByDisplayValue("Google")).toBeTruthy();
  });
});

describe("IdentityProviderEditor — dirty guard", () => {
  it("prompts on in-app navigation away from a dirty draft and discards on confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEditorAt("/admin/settings/identity/providers/new");

    // Make the draft dirty.
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google" } });

    // In-app navigation via the sidebar "Providers" link (not the Cancel button).
    fireEvent.click(screen.getByRole("link", { name: "Providers" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?");
    });
    // On confirm, the blocker proceeds and the providers list renders.
    await waitFor(() => {
      expect(screen.getByText("providers-list")).toBeTruthy();
    });
    confirmSpy.mockRestore();
  });

  it("keeps the dirty draft when the prompt is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditorAt("/admin/settings/identity/providers/new");

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google" } });
    fireEvent.click(screen.getByRole("link", { name: "Providers" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
    });
    // Cancelled → editor stays, the typed value is preserved, list does not render.
    expect(screen.getByDisplayValue("Google")).toBeTruthy();
    expect(screen.queryByText("providers-list")).toBeNull();
    confirmSpy.mockRestore();
  });

  it("does not prompt when navigating away from a clean draft", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEditorAt("/admin/settings/identity/providers/new");

    fireEvent.click(screen.getByRole("link", { name: "Providers" }));

    await waitFor(() => {
      expect(screen.getByText("providers-list")).toBeTruthy();
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("re-arms the dirty guard after a confirmed discard navigation (A→B)", async () => {
    mockFetch.mockResolvedValueOnce(validDetail); // p1
    const p2Detail = { ...validDetail, id: "p2", display_name: "Okta", issuer: "https://okta.example.com" };
    mockFetch.mockResolvedValueOnce(p2Detail); // p2
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { router } = renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("Google");

    // Dirty p1, then in-app nav to p2 → prompt → confirm → discard → p2 loads.
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google X" } });
    router.navigate("/admin/settings/identity/providers/p2");
    await screen.findByDisplayValue("Okta");

    // The bypass must be one-shot: dirty p2 + another navigation must prompt again.
    confirmSpy.mockClear();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Okta Y" } });
    router.navigate("/admin/settings/identity/providers");
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?"));
    confirmSpy.mockRestore();
  });

  it("clears stale field errors when navigating to another provider (A→B)", async () => {
    mockFetch.mockResolvedValueOnce(validDetail); // p1
    const p2Detail = { ...validDetail, id: "p2", display_name: "Okta", issuer: "https://okta.example.com" };
    mockFetch.mockResolvedValueOnce(p2Detail); // p2
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { router } = renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("Google");

    // Trigger a validation error on p1 by clearing a required field and submitting.
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Display name is required.");

    // Dirty (cleared field) → confirm discard → nav to p2 loads clean, no stale error.
    router.navigate("/admin/settings/identity/providers/p2");
    await screen.findByDisplayValue("Okta");
    expect(screen.queryByText("Display name is required.")).toBeNull();
    confirmSpy.mockRestore();
  });

  it("does not mark the draft dirty when the secret is touched then cleared (keep stored)", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("Google");

    // Type then clear the secret: no effective change (blank = keep stored), so
    // the dirty guard must not prompt on a subsequent in-app navigation.
    fireEvent.change(screen.getByLabelText(/client secret/i), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/client secret/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("link", { name: "Providers" }));

    await screen.findByText("providers-list");
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("IdentityProviderEditor — coverage", () => {
  it("shows an error toast when create rejects", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockCreate.mockRejectedValueOnce(new ApiError(409, "duplicate_issuer"));
    renderEditorAt("/admin/settings/identity/providers/new");

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google" } });
    fireEvent.change(screen.getByLabelText("Issuer URL"), { target: { value: "https://accounts.google.com" } });
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "client-123" } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "secret-abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }));

    expect(await screen.findByText(/issuer already exists/i)).toBeTruthy();
  });

  it("navigates back to the list from the not-found state", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockRejectedValueOnce(new ApiError(404, "not_found", "not_found"));
    renderEditorAt("/admin/settings/identity/providers/missing");

    await screen.findByText("This provider no longer exists.");
    fireEvent.click(screen.getByRole("button", { name: "Back to providers" }));
    expect(await screen.findByText("providers-list")).toBeTruthy();
  });

  it("edits endpoint, claim, label, and enabled fields and saves them", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    mockUpdate.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("Google");

    // Change every Endpoints / Claims / Login-button / Enabled input to a value
    // DIFFERENT from what validDetail loaded, so the onChange arrows must fire
    // (asserting the loaded values would pass without exercising them).
    fireEvent.change(screen.getByLabelText("Authorization endpoint"), { target: { value: "https://auth.example.com" } });
    fireEvent.change(screen.getByLabelText("Token endpoint"), { target: { value: "https://token.example.com" } });
    fireEvent.change(screen.getByLabelText("JWKS URI"), { target: { value: "https://jwks.example.com" } });
    fireEvent.change(screen.getByLabelText("UserInfo endpoint"), { target: { value: "https://userinfo.example.com" } });
    fireEvent.change(screen.getByLabelText("Email claim"), { target: { value: "upn" } });
    fireEvent.change(screen.getByLabelText("Name claim"), { target: { value: "displayName" } });
    fireEvent.change(screen.getByLabelText("Groups claim"), { target: { value: "memberOf" } });
    fireEvent.change(screen.getByLabelText("SSO login button label"), { target: { value: "Sign in with Google" } });
    // Toggle Enabled off (loaded as true).
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const body = mockUpdate.mock.calls[0][1];
    expect(body.authorization_endpoint).toBe("https://auth.example.com");
    expect(body.token_endpoint).toBe("https://token.example.com");
    expect(body.jwks_uri).toBe("https://jwks.example.com");
    expect(body.userinfo_endpoint).toBe("https://userinfo.example.com");
    expect(body.claim_email).toBe("upn");
    expect(body.claim_name).toBe("displayName");
    expect(body.claim_groups).toBe("memberOf");
    expect(body.login_button_label).toBe("Sign in with Google");
    expect(body.enabled).toBe(false);
  });

  it("Cancel with a dirty draft confirms discard then navigates to the list", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("Google");
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google X" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await screen.findByText("providers-list");
    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?");
    confirmSpy.mockRestore();
  });

  it("install a beforeunload handler while dirty (reload/close guard)", async () => {
    mockFetch.mockResolvedValueOnce(validDetail);
    renderEditorAt("/admin/settings/identity/providers/p1");

    await screen.findByDisplayValue("Google");
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google X" } });

    // Dispatching beforeunload should call preventDefault on the event.
    const event = new Event("beforeunload", { cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(preventDefault).toHaveBeenCalled();
  });
});
