// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { ApiError } from "../../src/api/client.js";
import { UserMenu } from "../../src/components/UserMenu.js";
import type { AuthUser, RoleAssignment } from "../../src/api/types.js";
import {
  clearSignOutInProgress,
  isSignOutInProgress,
  markSignOutInProgress,
} from "../../src/auth/sign-out-in-progress.js";
import { LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";
import {
  advanceTimers,
  deferred,
  hangUntilAborted,
  isOff,
  makeOrgAdminAssignment,
  makeSuperadminAssignment,
} from "../test-utils.js";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  signOut: (...args: unknown[]) => signOut(...args),
}));

const USER: AuthUser = {
  id: "u1",
  email: "ola@example.com",
  display_name: "Ola Operator",
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

function renderMenu(assignments: RoleAssignment[]) {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<UserMenu user={USER} assignments={assignments} />} />
          <Route path="/account" element={<div>account-page</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(cleanup);

describe("UserMenu", () => {
  it("shows the display name on the trigger and opens the panel on click", () => {
    renderMenu([{ role: "operator", scope_type: "event", scope_id: "evt-1" }]);
    expect(screen.getByText("Ola Operator")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /My account/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    expect(screen.getByRole("menuitem", { name: /My account/ })).toBeTruthy();
  });

  it("falls back to the full email when there's no display name (codecov review)", () => {
    render(
      <ToastProvider>
        <MemoryRouter>
          <Routes>
            <Route
              path="/"
              element={
                <UserMenu
                  user={{ ...USER, display_name: null }}
                  assignments={[{ role: "operator", scope_type: "event", scope_id: "evt-1" }]}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(screen.getByText("ola@example.com")).toBeTruthy();
    expect(screen.queryByText("Ola Operator")).toBeNull();
  });

  it("shows the Superadmin role badge for a superadmin", () => {
    renderMenu([makeSuperadminAssignment()]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    expect(screen.getByText("Superadmin")).toBeTruthy();
  });

  it("shows the Administrator role badge for an org admin", () => {
    renderMenu([makeOrgAdminAssignment()]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    expect(screen.getByText("Administrator")).toBeTruthy();
  });

  it("shows the Operator role badge for an operator", () => {
    renderMenu([{ role: "operator", scope_type: "event", scope_id: "evt-1" }]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    expect(screen.getByText("Operator")).toBeTruthy();
  });

  it("navigates to /account when 'My account' is clicked", () => {
    renderMenu([{ role: "operator", scope_type: "event", scope_id: "evt-1" }]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /My account/ }));
    expect(screen.getByText("account-page")).toBeTruthy();
  });

  it("renders Sign out as a plain menu button, not a form post that depends on the browser following a redirect", () => {
    renderMenu([{ role: "operator", scope_type: "event", scope_id: "evt-1" }]);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    const signOutItem = screen.getByRole("menuitem", { name: /Sign out/ }) as HTMLButtonElement;
    expect(signOutItem.type).toBe("button");
    expect(signOutItem.closest("form")).toBeNull();
  });
});

describe("UserMenu sign out", () => {
  const OPERATOR: RoleAssignment[] = [{ role: "operator", scope_type: "event", scope_id: "evt-1" }];
  const END_SESSION_URL =
    "https://idp.example.com/end-session?client_id=admitto&post_logout_redirect_uri=https%3A%2F%2Ftickets.example.com%2Flogin";
  const FAILED = "Could not sign out. Try again.";
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signOut.mockReset().mockResolvedValue(null);
    assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearSignOutInProgress();
  });

  function openMenuAndFindSignOut(): HTMLButtonElement {
    renderMenu(OPERATOR);
    fireEvent.click(screen.getByRole("button", { name: /Ola Operator/ }));
    return screen.getByRole("menuitem", { name: /Sign out/ });
  }

  it("ends the session through the API and goes to the sign-in page when there is no identity provider to visit", async () => {
    fireEvent.click(openMenuAndFindSignOut());
    await act(async () => {});

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("goes to the identity provider's end-session address for a single sign-on session", async () => {
    signOut.mockResolvedValue(END_SESSION_URL);

    fireEvent.click(openMenuAndFindSignOut());
    await act(async () => {});

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(END_SESSION_URL);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "not an address", ""])(
    "does not follow %j from the server and goes to the sign-in page instead",
    async (fromServer) => {
      signOut.mockResolvedValue(fromServer);

      fireEvent.click(openMenuAndFindSignOut());
      await act(async () => {});

      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith("/login");
    },
  );

  it("shows the row busy while the request runs, keeps its keyboard focus and ignores further clicks", async () => {
    const pending = deferred<string | null>();
    signOut.mockReturnValue(pending.promise);
    const item = openMenuAndFindSignOut();
    item.focus();

    fireEvent.click(item);

    expect(item.getAttribute("aria-busy")).toBe("true");
    expect(isOff(item)).toBe(true);
    expect(item.disabled).toBe(false);
    expect(document.activeElement).toBe(item);
    fireEvent.click(item);
    fireEvent.click(item);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(END_SESSION_URL);
    });
    expect(assign).toHaveBeenCalledWith(END_SESSION_URL);
    // The page is being left for good: the row stays busy until the browser has gone.
    expect(item.getAttribute("aria-busy")).toBe("true");
  });

  it("tells the rest of the app that a Sign out is under way from the click until the page is left, and stops telling it when the request fails", async () => {
    const pending = deferred<string | null>();
    signOut.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(null);
    const item = openMenuAndFindSignOut();
    expect(isSignOutInProgress()).toBe(false);

    fireEvent.click(item);
    expect(isSignOutInProgress()).toBe(true);

    await act(async () => {
      pending.reject(new TypeError("Failed to fetch"));
    });
    expect(isSignOutInProgress()).toBe(false);

    fireEvent.click(item);
    await act(async () => {});
    // It worked this time: the page is on its way out, so the flag stays up.
    expect(isSignOutInProgress()).toBe(true);
  });

  it("says so and lets the user try again when the request fails, without showing the server's own text", async () => {
    signOut.mockRejectedValueOnce(new ApiError(500, "database secret", "internal_error"));
    const item = openMenuAndFindSignOut();

    fireEvent.click(item);
    await act(async () => {});

    expect(assign).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(FAILED);
    expect(alert.textContent).not.toContain("database secret");
    expect(item.getAttribute("aria-busy")).toBeNull();
    expect(isOff(item)).toBe(false);

    fireEvent.click(item);
    await act(async () => {});

    expect(signOut).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("says so when the network request itself fails", async () => {
    signOut.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    fireEvent.click(openMenuAndFindSignOut());
    await act(async () => {});

    expect(screen.getByRole("alert").textContent).toContain(FAILED);
    expect(assign).not.toHaveBeenCalled();
  });

  it("stops waiting after the 30 second limit, says so and lets the user try again", async () => {
    vi.useFakeTimers();
    signOut.mockImplementationOnce(hangUntilAborted);
    const item = openMenuAndFindSignOut();

    fireEvent.click(item);
    await advanceTimers(LOAD_TIMEOUT_MS - 1);
    expect(item.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();

    await advanceTimers(1);

    expect(screen.getByRole("alert").textContent).toContain(FAILED);
    expect(item.getAttribute("aria-busy")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it("carries on when Escape closes the menu while the request runs", async () => {
    const pending = deferred<string | null>();
    signOut.mockReturnValue(pending.promise);
    fireEvent.click(openMenuAndFindSignOut());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    await act(async () => {
      pending.resolve(END_SESSION_URL);
    });
    expect(assign).toHaveBeenCalledWith(END_SESSION_URL);
  });

  it("still tells the user about a failure after Escape closed the menu", async () => {
    const pending = deferred<string | null>();
    signOut.mockReturnValue(pending.promise);
    fireEvent.click(openMenuAndFindSignOut());
    fireEvent.keyDown(document, { key: "Escape" });

    await act(async () => {
      pending.reject(new TypeError("Failed to fetch"));
    });

    expect(screen.getByRole("alert").textContent).toContain(FAILED);
    expect(assign).not.toHaveBeenCalled();
  });
});
