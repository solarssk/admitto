// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { IdentityProviderEditor } from "../../src/identity/IdentityProviderEditor.js";
import type { ProviderDetailDto } from "../../src/api/types.js";
import { advanceTimers, deferred, hangUntilAborted, isOff } from "../test-utils.js";

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
    fetchAdminEvents: vi.fn(),
    fetchAdminOrganizations: vi.fn(),
  };
});

import {
  ApiError,
  createIdentityProvider,
  discoverIdentityProvider,
  fetchAdminEvents,
  fetchAdminOrganizations,
  fetchIdentityProvider,
  testIdentityProviderDraft,
  updateIdentityProvider,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchIdentityProvider);
const mockCreate = vi.mocked(createIdentityProvider);
const mockUpdate = vi.mocked(updateIdentityProvider);
const mockDiscover = vi.mocked(discoverIdentityProvider);
const mockTest = vi.mocked(testIdentityProviderDraft);

const detail: ProviderDetailDto = {
  id: "p1",
  provider_type: "oidc",
  display_name: "Google",
  issuer: "https://accounts.google.com",
  client_id: "client-123",
  has_client_secret: true,
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  userinfo_endpoint: null,
  claim_email: "email",
  claim_name: "name",
  claim_groups: "groups",
  claim_given_name: "given_name",
  claim_family_name: "family_name",
  claim_phone: "phone_number",
  enabled: true,
  login_button_label: null,
  mappings: [],
  redirect_uri: "https://tickets.example.com/api/auth/oidc/p1/callback",
} as ProviderDetailDto;

function renderEditorAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/admin/settings/identity/providers/new", element: <IdentityProviderEditor mode="create" /> },
      { path: "/admin/settings/identity/providers/:providerId", element: <IdentityProviderEditor mode="edit" /> },
      { path: "/admin/settings/identity/providers", element: <div>providers-list</div> },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return { router, ...view };
}

const placeholder = () => screen.queryByRole("status", { name: "Loading provider" });
const EDIT = "/admin/settings/identity/providers/p1";

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchAdminEvents).mockResolvedValue([]);
  vi.mocked(fetchAdminOrganizations).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("IdentityProviderEditor loading standard: the load of the provider", () => {
  it("holds the form's room invisibly for the first 200ms, then draws its cards under their real titles", async () => {
    mockFetch.mockImplementation(hangUntilAborted as never);
    renderEditorAt(EDIT);

    expect(placeholder()?.className).toContain("at-loading-hold");
    expect(screen.getByText("Edit identity provider")).toBeTruthy();
    expect(screen.getByText("Update this identity provider.")).toBeTruthy();

    await advanceTimers(200);
    expect(placeholder()?.className).not.toContain("at-loading-hold");
    for (const title of ["Basics", "Endpoints", "Claims", "Group → role mapping", "Login button"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.queryByLabelText("Display name")).toBeNull();
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
  });

  it("never draws the placeholder for an answer that comes within 200ms", async () => {
    const answer = deferred<ProviderDetailDto>();
    mockFetch.mockReturnValue(answer.promise);
    renderEditorAt(EDIT);

    await advanceTimers(100);
    await act(async () => answer.resolve(detail));
    expect(placeholder()).toBeNull();
    expect(screen.getByDisplayValue("Google")).toBeTruthy();
  });

  it("keeps a placeholder that did show for at least 400ms before the form replaces it", async () => {
    const answer = deferred<ProviderDetailDto>();
    mockFetch.mockReturnValue(answer.promise);
    renderEditorAt(EDIT);

    await advanceTimers(250);
    await act(async () => answer.resolve(detail));
    expect(placeholder()).not.toBeNull();
    expect(screen.queryByDisplayValue("Google")).toBeNull();

    // It was drawn at 200ms, so it stays until 600ms.
    await advanceTimers(349);
    expect(placeholder()).not.toBeNull();
    await advanceTimers(1);
    expect(placeholder()).toBeNull();
    expect(screen.getByDisplayValue("Google")).toBeTruthy();
  });

  it("says it is taking longer than usual after 8 seconds", async () => {
    mockFetch.mockImplementation(hangUntilAborted as never);
    renderEditorAt(EDIT);

    await advanceTimers(7_999);
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(/Taking longer than usual/)).toBeTruthy();
  });

  it("ends in an error with a Retry when the server does not answer in 30 seconds", async () => {
    mockFetch.mockImplementation(hangUntilAborted as never);
    renderEditorAt(EDIT);

    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(placeholder()).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("The server did not answer in time");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("gives the server's reason for a failed load, not a generic line", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "discovery_failed", "discovery_failed"));
    renderEditorAt(EDIT);
    await advanceTimers(0);

    expect(screen.getByRole("alert").textContent).toContain("Could not fetch OIDC discovery from the issuer URL");
    expect(screen.queryByText("Could not load this provider.")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("says 'Could not load this provider.' when the server gives no reason", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    renderEditorAt(EDIT);
    await advanceTimers(0);

    expect(screen.getByRole("alert").textContent).toContain("Could not load this provider.");
    expect(screen.getByRole("alert").querySelector("p > i.ti-circle-x.failure-icon--large")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the error on screen, with a busy Retry, until the retry's answer is in, then shows the form", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "boom", "internal_error"));
    renderEditorAt(EDIT);
    await advanceTimers(0);

    const retry = screen.getByRole("button", { name: "Retry" });
    const answer = deferred<ProviderDetailDto>();
    mockFetch.mockReturnValueOnce(answer.promise);
    fireEvent.click(retry);
    await advanceTimers(0);

    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(isOff(retry)).toBe(true);
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(placeholder()).toBeNull();
    fireEvent.click(retry);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await act(async () => answer.resolve(detail));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByDisplayValue("Google")).toBeTruthy();
    expect(document.querySelector(".identity-modal__panel")?.contains(document.activeElement)).toBe(true);
  });

  it("announces a failure again when the retry fails with the same message, without remounting the button", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    renderEditorAt(EDIT);
    await advanceTimers(0);

    const retry = screen.getByRole("button", { name: "Retry" });
    const message = screen.getByRole("alert").querySelector("p");
    fireEvent.click(retry);
    await advanceTimers(100);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    await advanceTimers(500);

    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("alert").querySelector("p")).not.toBe(message);
  });

  it("turns a Retry that finds the provider gone into the not-found state", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    renderEditorAt(EDIT);
    await advanceTimers(0);

    mockFetch.mockRejectedValueOnce(new ApiError(404, "not_found", "not_found"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(0);

    expect(screen.getByText("This provider no longer exists.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("covers the form of the provider that was open with the placeholder while the next one loads", async () => {
    mockFetch.mockResolvedValueOnce(detail);
    const { router } = renderEditorAt(EDIT);
    await advanceTimers(0);
    expect(screen.getByDisplayValue("Google")).toBeTruthy();

    mockFetch.mockImplementationOnce(hangUntilAborted as never);
    await act(async () => {
      await router.navigate("/admin/settings/identity/providers/p2");
    });
    await advanceTimers(250);

    expect(placeholder()).not.toBeNull();
    expect(screen.queryByDisplayValue("Google")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("drops the answer for the provider that was open when it arrives after the next one was asked for", async () => {
    const first = deferred<ProviderDetailDto>();
    mockFetch.mockReturnValueOnce(first.promise);
    const second = deferred<ProviderDetailDto>();
    mockFetch.mockReturnValueOnce(second.promise);
    const { router } = renderEditorAt(EDIT);
    await advanceTimers(0);

    await act(async () => {
      await router.navigate("/admin/settings/identity/providers/p2");
    });
    await act(async () => first.resolve({ ...detail, display_name: "Google" }));
    expect(screen.queryByDisplayValue("Google")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    await act(async () => second.resolve({ ...detail, id: "p2", display_name: "Okta" }));
    await advanceTimers(600);
    expect(screen.getByDisplayValue("Okta")).toBeTruthy();
    expect(screen.queryByDisplayValue("Google")).toBeNull();
  });

  it("abandons the request when the modal is left", async () => {
    let signal: AbortSignal | undefined;
    mockFetch.mockImplementation(((_id: string, requestSignal?: AbortSignal) => {
      signal = requestSignal;
      return hangUntilAborted(_id, requestSignal);
    }) as never);
    renderEditorAt(EDIT);
    await advanceTimers(0);
    expect(signal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await advanceTimers(0);
    expect(signal?.aborted).toBe(true);
  });

  it("has nothing to load, and no placeholder, in create mode", async () => {
    renderEditorAt("/admin/settings/identity/providers/new");
    await advanceTimers(250);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(placeholder()).toBeNull();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
  });
});

describe("IdentityProviderEditor loading standard: Discover, Test and Save", () => {
  async function loadEdit() {
    mockFetch.mockResolvedValue(detail);
    renderEditorAt(EDIT);
    await advanceTimers(0);
  }

  function dirty() {
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Google Workspace" } });
  }

  it("keeps Save off, focusable and never `disabled`, while nothing has changed, and a click on it submits nothing", async () => {
    await loadEdit();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.hasAttribute("disabled")).toBe(false);

    fireEvent.click(save);
    await advanceTimers(0);
    expect(mockUpdate).not.toHaveBeenCalled();

    dirty();
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("shows Save busy while it saves, label unchanged, focus kept, and the other actions off", async () => {
    await loadEdit();
    dirty();
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    const saved = deferred<ProviderDetailDto>();
    mockUpdate.mockReturnValue(saved.promise as never);

    fireEvent.click(save);
    await advanceTimers(0);

    const busy = screen.getByRole("button", { name: "Save" });
    expect(busy).toBe(save);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(busy);
    expect(screen.queryByText("Saving…")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Test connection" }))).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Discover" }))).toBe(true);

    fireEvent.click(busy);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    await act(async () => saved.resolve(detail));
  });

  it("says 'Creating…' on the create button while a new provider is created", async () => {
    renderEditorAt("/admin/settings/identity/providers/new");
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Okta" } });
    fireEvent.change(screen.getByLabelText("Issuer URL"), { target: { value: "https://okta.example.com" } });
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "client" } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "secret" } });
    const create = screen.getByRole("button", { name: "Create provider" });
    create.focus();
    const created = deferred<ProviderDetailDto>();
    mockCreate.mockReturnValue(created.promise as never);

    fireEvent.click(create);
    await advanceTimers(0);

    const busy = screen.getByRole("button", { name: "Creating…" });
    expect(busy).toBe(create);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(busy);
    await act(async () => created.resolve(detail));
  });

  it("shows Test busy as 'Testing…', keeps its focus, and ignores a second click", async () => {
    await loadEdit();
    const test = screen.getByRole("button", { name: "Test connection" });
    test.focus();
    const probe = deferred<{ ok: boolean }>();
    mockTest.mockReturnValue(probe.promise as never);

    fireEvent.click(test);
    await advanceTimers(0);

    const busy = screen.getByRole("button", { name: "Testing…" });
    expect(busy).toBe(test);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(mockTest).toHaveBeenCalledTimes(1);

    await act(async () => probe.resolve({ ok: true }));
    const idle = screen.getByRole("button", { name: "Test connection" });
    expect(idle.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(idle);
  });

  it("shows Discover busy with its label unchanged, since 'Discovering…' would be longer, and keeps its focus", async () => {
    await loadEdit();
    const discover = screen.getByRole("button", { name: "Discover" });
    discover.focus();
    const answer = deferred<Awaited<ReturnType<typeof discoverIdentityProvider>>>();
    mockDiscover.mockReturnValue(answer.promise);

    fireEvent.click(discover);
    await advanceTimers(0);

    const busy = screen.getByRole("button", { name: "Discover" });
    expect(busy).toBe(discover);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(busy);
    expect(screen.queryByText("Discovering…")).toBeNull();
    fireEvent.click(busy);
    expect(mockDiscover).toHaveBeenCalledTimes(1);

    await act(async () => answer.resolve({ endpoints: { issuer: "", authorization_endpoint: "", token_endpoint: "", jwks_uri: "" } } as never));
    expect(screen.getByRole("button", { name: "Discover" }).getAttribute("aria-busy")).toBeNull();
  });
});
