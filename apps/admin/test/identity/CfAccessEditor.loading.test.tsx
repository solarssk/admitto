// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { CfAccessEditor } from "../../src/identity/CfAccessEditor.js";
import { advanceTimers, deferred, hangUntilAborted, isOff } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchCfAccessSummary: vi.fn(),
    updateCfAccess: vi.fn(),
    testCfAccess: vi.fn(),
  };
});

import { fetchCfAccessSummary, testCfAccess, updateCfAccess } from "../../src/api/client.js";

type Summary = Awaited<ReturnType<typeof fetchCfAccessSummary>>;

const mockFetch = vi.mocked(fetchCfAccessSummary);
const mockUpdate = vi.mocked(updateCfAccess);
const mockTest = vi.mocked(testCfAccess);

const noLocks = { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false, sourceProviderId: false };

function summary(over: Partial<Summary> = {}): Summary {
  return {
    enabled: false,
    teamDomain: "https://acme.cloudflareaccess.com",
    audience: ["aud-1"],
    protectedPrefixes: ["/admin"],
    sourceProviderId: "authentik",
    sourceProviders: [{ id: "authentik", displayName: "Authentik", enabled: true }],
    locks: noLocks,
    ...over,
  };
}

function renderEditor() {
  const router = createMemoryRouter(
    [
      { path: "/admin/settings/identity/cloudflare", element: <CfAccessEditor /> },
      { path: "/admin/settings/identity/providers", element: <div>providers-list</div> },
    ],
    { initialEntries: ["/admin/settings/identity/cloudflare"] },
  );
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
}

const placeholder = () => screen.queryByRole("status", { name: "Loading Cloudflare Access" });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("CfAccessEditor loading standard: the first load", () => {
  it("holds the form's room invisibly for the first 200ms, then draws the form's own skeleton under the real title", async () => {
    mockFetch.mockImplementation(hangUntilAborted as never);
    renderEditor();

    expect(placeholder()?.className).toContain("at-loading-hold");
    // The static parts of the modal are there from the start, and the form's cards keep their real titles.
    expect(screen.getByText("Cloudflare Access")).toBeTruthy();
    expect(screen.getByText(/Require a Cloudflare Zero Trust Access JWT/)).toBeTruthy();

    await advanceTimers(200);
    expect(placeholder()?.className).not.toContain("at-loading-hold");
    expect(screen.getByText("Configuration")).toBeTruthy();
    expect(screen.queryByLabelText("Cloudflare team URL")).toBeNull();
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
  });

  it("never draws the placeholder for an answer that comes within 200ms", async () => {
    const answer = deferred<Summary>();
    mockFetch.mockReturnValue(answer.promise);
    renderEditor();

    await advanceTimers(100);
    await act(async () => answer.resolve(summary()));
    expect(placeholder()).toBeNull();
    expect(screen.getByLabelText("Cloudflare team URL")).toBeTruthy();
  });

  it("keeps a placeholder that did show for at least 400ms before the form replaces it", async () => {
    const answer = deferred<Summary>();
    mockFetch.mockReturnValue(answer.promise);
    renderEditor();

    await advanceTimers(250);
    await act(async () => answer.resolve(summary()));
    expect(placeholder()).not.toBeNull();
    expect(screen.queryByLabelText("Cloudflare team URL")).toBeNull();

    // It was drawn at 200ms, so it stays until 600ms.
    await advanceTimers(349);
    expect(placeholder()).not.toBeNull();
    await advanceTimers(1);
    expect(placeholder()).toBeNull();
    expect(screen.getByLabelText("Cloudflare team URL")).toBeTruthy();
  });

  it("says it is taking longer than usual after 8 seconds", async () => {
    mockFetch.mockImplementation(hangUntilAborted as never);
    renderEditor();

    await advanceTimers(7_999);
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(/Taking longer than usual/)).toBeTruthy();
  });

  it("ends in an error with a Retry when the server does not answer in 30 seconds", async () => {
    mockFetch.mockImplementation(hangUntilAborted as never);
    renderEditor();

    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(placeholder()).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("The server did not answer in time");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows the reason of a failed load, and a Retry that keeps the error on screen, busy, until the answer is in", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetch.mockRejectedValueOnce(new ApiError(500, "boom", "internal_error"));
    renderEditor();
    await advanceTimers(0);

    const retry = screen.getByRole("button", { name: "Retry" });
    const answer = deferred<Summary>();
    mockFetch.mockReturnValueOnce(answer.promise);
    fireEvent.click(retry);
    await advanceTimers(0);

    // The same button, busy, with the error still there and no placeholder in its place.
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(isOff(retry)).toBe(true);
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(placeholder()).toBeNull();

    // A second click on the busy Retry does not start another request.
    fireEvent.click(retry);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await act(async () => answer.resolve(summary()));
    // The answer is in: the error goes and the form takes its place.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByLabelText("Cloudflare team URL")).toBeTruthy();
    // The modal's own focus handling puts the focus into the form, not on <body>.
    expect(document.querySelector(".identity-modal__panel")?.contains(document.activeElement)).toBe(true);
  });

  it("announces a failure again when the retry fails with the same message", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    renderEditor();
    await advanceTimers(0);

    const retry = screen.getByRole("button", { name: "Retry" });
    const message = screen.getByRole("alert").querySelector("p");
    fireEvent.click(retry);
    // Busy for at least 400ms from the click, so a retry that fails at once still shows that it ran.
    await advanceTimers(100);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    await advanceTimers(500);

    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBeNull();
    // The paragraph is a new node, so a live region says it again; the button was not remounted.
    expect(screen.getByRole("alert").querySelector("p")).not.toBe(message);
  });
});

describe("CfAccessEditor loading standard: Test and Save", () => {
  async function loadForm(over: Partial<Summary> = {}) {
    mockFetch.mockResolvedValue(summary(over));
    renderEditor();
    await advanceTimers(0);
  }

  function dirtyTeamUrl() {
    fireEvent.change(screen.getByLabelText("Cloudflare team URL"), { target: { value: "https://other.cloudflareaccess.com" } });
  }

  it("keeps Save off, but focusable and never `disabled`, while nothing has changed, and a click on it submits nothing", async () => {
    await loadForm();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.hasAttribute("disabled")).toBe(false);

    fireEvent.click(save);
    await advanceTimers(0);
    expect(mockUpdate).not.toHaveBeenCalled();

    dirtyTeamUrl();
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("shows Save busy while it saves, with its label unchanged and its focus kept, and ignores a second click", async () => {
    await loadForm();
    dirtyTeamUrl();
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    const saved = deferred<Summary>();
    mockUpdate.mockReturnValue(saved.promise);

    fireEvent.click(save);
    await advanceTimers(0);

    const busy = screen.getByRole("button", { name: "Save" });
    expect(busy).toBe(save);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(isOff(busy)).toBe(true);
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(busy);
    expect(screen.queryByText("Saving…")).toBeNull();
    // The rest of the row is inert while it works: Cancel is off, and so is Test.
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Test connection" }))).toBe(true);

    fireEvent.click(busy);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    await act(async () => saved.resolve(summary({ teamDomain: "https://other.cloudflareaccess.com" })));
    await advanceTimers(0);
    expect(screen.getByText("providers-list")).toBeTruthy();
  });

  it("shows Test busy as 'Testing…' while it probes, keeps its focus, and leaves Save and Cancel to the guard", async () => {
    await loadForm();
    dirtyTeamUrl();
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
});
