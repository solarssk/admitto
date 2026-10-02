// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { IdentityProvidersPanel } from "../../src/identity/IdentityProvidersPanel.js";
import { IDENTITY_PROVIDERS_ROUTE } from "../../src/identity/routes.js";
import { advanceTimers, deferred, hangUntilAborted, isOff, renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchIdentityProviders: vi.fn(),
    fetchCfAccessSummary: vi.fn(),
    toggleIdentityProvider: vi.fn(),
  };
});

import { fetchCfAccessSummary, fetchIdentityProviders, toggleIdentityProvider } from "../../src/api/client.js";
import type { CfAccessSummaryDto, IdentityProviderListItem } from "../../src/api/types.js";

const mockProviders = vi.mocked(fetchIdentityProviders);
const mockCf = vi.mocked(fetchCfAccessSummary);
const mockToggle = vi.mocked(toggleIdentityProvider);

const google: IdentityProviderListItem = { id: "p1", display_name: "Google", issuer: "https://accounts.google.com", enabled: true } as IdentityProviderListItem;
const cf = (): CfAccessSummaryDto =>
  ({
    enabled: false,
    teamDomain: "team.example.com",
    audience: [],
    protectedPrefixes: [],
    sourceProviderId: "",
    sourceProviders: [],
    locks: { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false, sourceProviderId: false },
  }) as CfAccessSummaryDto;

function renderPanel() {
  return renderWithToast(
    <MemoryRouter>
      <IdentityProvidersPanel />
    </MemoryRouter>,
  );
}

function renderPanelAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: IDENTITY_PROVIDERS_ROUTE, element: <IdentityProvidersPanel /> },
      { path: `${IDENTITY_PROVIDERS_ROUTE}/new`, element: <IdentityProvidersPanel /> },
    ],
    { initialEntries: [path] },
  );
  return { ...renderWithToast(<RouterProvider router={router} />), router };
}

const providersSkeleton = () => screen.queryByRole("status", { name: "Loading identity providers" });
const cfSkeleton = () => screen.queryByRole("status", { name: "Loading Cloudflare Access" });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("IdentityProvidersPanel loading standard: the first load of each card", () => {
  it("holds each card's room invisibly for the first 200ms, draws its skeleton after, and says it is taking longer after 8 seconds", async () => {
    mockProviders.mockImplementation(hangUntilAborted as never);
    mockCf.mockImplementation(hangUntilAborted as never);
    renderPanel();

    expect(providersSkeleton()?.className).toContain("at-loading-hold");
    expect(cfSkeleton()?.className).toContain("at-loading-hold");
    // The titles of both cards are there from the start.
    expect(screen.getByText("Identity providers")).toBeTruthy();
    expect(screen.getByText("Cloudflare Access")).toBeTruthy();

    await advanceTimers(200);
    expect(providersSkeleton()?.className).not.toContain("at-loading-hold");
    expect(cfSkeleton()?.className).not.toContain("at-loading-hold");
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();

    await advanceTimers(7_800);
    expect(providersSkeleton()?.textContent).toContain("Taking longer than usual");
    expect(cfSkeleton()?.textContent).toContain("Taking longer than usual");
  });

  it("never draws a skeleton for an answer within 200ms, and keeps one that did show for at least 400ms", async () => {
    const providers = deferred<{ providers: IdentityProviderListItem[] }>();
    const cfAnswer = deferred<CfAccessSummaryDto>();
    mockProviders.mockReturnValue(providers.promise);
    mockCf.mockReturnValue(cfAnswer.promise);
    renderPanel();

    await advanceTimers(100);
    await act(async () => providers.resolve({ providers: [google] }));
    expect(providersSkeleton()).toBeNull();
    expect(screen.getByText("Google")).toBeTruthy();

    await advanceTimers(150);
    expect(cfSkeleton()?.className).not.toContain("at-loading-hold");
    await act(async () => cfAnswer.resolve(cf()));
    // Drawn at 200ms, so it stays until 600ms.
    expect(cfSkeleton()).not.toBeNull();
    await advanceTimers(349);
    expect(cfSkeleton()).not.toBeNull();
    await advanceTimers(1);
    expect(cfSkeleton()).toBeNull();
    expect(screen.getByText(/Team domain: team.example.com/)).toBeTruthy();
  });

  it("fails one card without touching the other, and ends in an error with a Retry after 30 seconds", async () => {
    mockProviders.mockImplementation(hangUntilAborted as never);
    mockCf.mockResolvedValue(cf());
    renderPanel();

    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(providersSkeleton()).toBeNull();
    expect(screen.getByText("Could not load providers")).toBeTruthy();
    expect(screen.getByText(/The server did not answer in time/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry loading providers" })).toBeTruthy();
    expect(screen.getByText(/Team domain: team.example.com/)).toBeTruthy();
  });
});

describe("IdentityProvidersPanel loading standard: Retry", () => {
  it("keeps the error on screen with a busy Retry until the answer is in, then shows the rows", async () => {
    mockProviders.mockRejectedValueOnce(new Error("network down"));
    mockCf.mockResolvedValue(cf());
    renderPanel();
    await advanceTimers(0);

    const retry = screen.getByRole("button", { name: "Retry loading providers" });
    const answer = deferred<{ providers: IdentityProviderListItem[] }>();
    mockProviders.mockReturnValueOnce(answer.promise);
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(0);

    expect(screen.getByRole("button", { name: "Retry loading providers" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(isOff(retry)).toBe(true);
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText("Could not load providers")).toBeTruthy();
    expect(providersSkeleton()).toBeNull();
    fireEvent.click(retry);
    expect(mockProviders).toHaveBeenCalledTimes(2);

    await act(async () => answer.resolve({ providers: [google] }));
    expect(screen.queryByRole("button", { name: "Retry loading providers" })).toBeNull();
    expect(screen.getByText("Google")).toBeTruthy();
    // The card that holds the list stays, so the focus that was on the Retry goes there instead of falling to <body>.
    await advanceTimers(0);
    expect(document.activeElement?.classList.contains("at-card")).toBe(true);
    expect(document.activeElement?.textContent).toContain("Google");
    expect(screen.getByRole("tabpanel", { name: "Identity" }).contains(document.activeElement)).toBe(true);
  });

  it("says a repeated failure again, in a message that is mounted afresh while the button stays", async () => {
    mockProviders.mockRejectedValue(new Error("network down"));
    mockCf.mockResolvedValue(cf());
    renderPanel();
    await advanceTimers(0);

    const retry = screen.getByRole("button", { name: "Retry loading providers" });
    const message = screen.getByText("Could not load identity providers.");
    fireEvent.click(retry);
    await advanceTimers(100);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    await advanceTimers(500);

    expect(screen.getByRole("button", { name: "Retry loading providers" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByText("Could not load identity providers.")).not.toBe(message);
  });

  it("retries the Cloudflare Access card on its own", async () => {
    mockProviders.mockResolvedValue({ providers: [google] });
    mockCf.mockRejectedValueOnce(new Error("network down"));
    renderPanel();
    await advanceTimers(0);

    expect(screen.getByText("Could not load Cloudflare Access")).toBeTruthy();
    mockCf.mockResolvedValueOnce(cf());
    fireEvent.click(screen.getByRole("button", { name: "Retry loading Cloudflare Access" }));
    await advanceTimers(0);

    expect(mockProviders).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Team domain: team.example.com/)).toBeTruthy();
  });
});

describe("IdentityProvidersPanel loading standard: a list that is on screen", () => {
  it("replaces the rows with the error when a toggle fails and the refresh that reconciles it fails too, since the flip may never have been accepted", async () => {
    mockProviders.mockResolvedValueOnce({ providers: [google] });
    mockCf.mockResolvedValue(cf());
    mockToggle.mockRejectedValueOnce(new Error("boom"));
    mockProviders.mockRejectedValueOnce(new Error("network down"));
    renderPanel();
    await advanceTimers(0);

    fireEvent.click(screen.getByRole("switch", { name: "Google enabled" }));
    await advanceTimers(0);

    expect(screen.queryByRole("switch", { name: "Google enabled" })).toBeNull();
    expect(screen.getByText("Could not load providers")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry loading providers" })).toBeTruthy();
  });

  it("keeps the rows and says they may be older when the refresh after an editor closed fails", async () => {
    mockProviders.mockResolvedValueOnce({ providers: [google] });
    mockCf.mockResolvedValue(cf());
    const { router } = renderPanelAt(`${IDENTITY_PROVIDERS_ROUTE}/new`);
    await advanceTimers(0);
    expect(screen.getByText("Google")).toBeTruthy();

    mockProviders.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      await router.navigate(IDENTITY_PROVIDERS_ROUTE);
    });
    await advanceTimers(0);

    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText(/Could not refresh this list, so it may show older details/)).toBeTruthy();
  });

  it("does not say the list may be older under the error that has replaced its rows", async () => {
    mockProviders.mockResolvedValueOnce({ providers: [google] });
    mockCf.mockResolvedValue(cf());
    const { router } = renderPanelAt(`${IDENTITY_PROVIDERS_ROUTE}/new`);
    await advanceTimers(0);
    mockProviders.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      await router.navigate(IDENTITY_PROVIDERS_ROUTE);
    });
    await advanceTimers(0);
    expect(screen.getByText(/Could not refresh this list, so it may show older details/)).toBeTruthy();

    mockToggle.mockRejectedValueOnce(new Error("boom"));
    mockProviders.mockRejectedValueOnce(new Error("network down"));
    fireEvent.click(screen.getByRole("switch", { name: "Google enabled" }));
    await advanceTimers(0);

    expect(screen.getByText("Could not load providers")).toBeTruthy();
    expect(screen.queryByText(/Could not refresh this list/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Retry/ })).toHaveLength(1);
  });

  it("keeps the Cloudflare Access card and warns the same way when its refresh fails, and its Retry refreshes it", async () => {
    mockProviders.mockResolvedValue({ providers: [google] });
    mockCf.mockResolvedValueOnce(cf());
    const { router } = renderPanelAt(`${IDENTITY_PROVIDERS_ROUTE}/new`);
    await advanceTimers(0);

    mockCf.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      await router.navigate(IDENTITY_PROVIDERS_ROUTE);
    });
    await advanceTimers(0);
    expect(screen.getByText(/Team domain: team.example.com/)).toBeTruthy();
    const warning = screen.getByText(/Could not refresh this list, so it may show older details/).closest("[role='alert']") as HTMLElement;
    expect(warning).not.toBeNull();

    mockCf.mockResolvedValueOnce({ ...cf(), teamDomain: "newer.example.com" });
    fireEvent.click(within(warning).getByRole("button", { name: "Retry" }));
    await advanceTimers(500);
    expect(screen.getByText(/Team domain: newer.example.com/)).toBeTruthy();
    expect(screen.queryByText(/Could not refresh this list/)).toBeNull();
  });

  it("keeps a toggled switch focusable and off while its request is on its way", async () => {
    mockProviders.mockResolvedValueOnce({ providers: [google] });
    mockCf.mockResolvedValue(cf());
    const toggled = deferred<{ id: string; enabled: boolean }>();
    mockToggle.mockReturnValue(toggled.promise);
    renderPanel();
    await advanceTimers(0);

    const toggle = screen.getByRole("switch", { name: "Google enabled" });
    toggle.focus();
    fireEvent.click(toggle);
    await advanceTimers(0);

    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.getAttribute("aria-busy")).toBe("true");
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(toggle);
    // A second change while it is on its way is ignored.
    fireEvent.click(toggle);
    expect(mockToggle).toHaveBeenCalledTimes(1);

    await act(async () => toggled.resolve({ id: "p1", enabled: false }));
    expect(toggle.getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });
});
