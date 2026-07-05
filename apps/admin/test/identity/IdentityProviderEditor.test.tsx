// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/settings/identity/providers/new" element={<IdentityProviderEditor mode="create" />} />
          <Route
            path="/admin/settings/identity/providers/:providerId"
            element={<IdentityProviderEditor mode="edit" />}
          />
          <Route
            path="/admin/settings/identity/providers"
            element={<div>providers-list</div>}
          />
        </Routes>
      </MemoryRouter>
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
});
