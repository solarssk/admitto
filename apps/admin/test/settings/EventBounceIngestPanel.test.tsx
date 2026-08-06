// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventBounceIngestPanel,
  type EventBounceIngestPanelHandle,
} from "../../src/settings/EventBounceIngestPanel.js";
import { renderWithToast } from "../test-utils.js";
import type { EventBounceIngestSettingsResponse } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventBounceIngestSettings: vi.fn(),
    saveEventBounceIngestSettings: vi.fn(),
    testEventBounceIngestConnection: vi.fn(),
    runEventBounceIngestCheck: vi.fn(),
  };
});

import {
  ApiError,
  fetchEventBounceIngestSettings,
  runEventBounceIngestCheck,
  saveEventBounceIngestSettings,
  testEventBounceIngestConnection,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchEventBounceIngestSettings);
const mockSave = vi.mocked(saveEventBounceIngestSettings);
const mockTest = vi.mocked(testEventBounceIngestConnection);
const mockRun = vi.mocked(runEventBounceIngestCheck);

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLInputElement | HTMLButtonElement).disabled;
}

function bounceResponse(
  overrides: Partial<EventBounceIngestSettingsResponse> = {},
): EventBounceIngestSettingsResponse {
  return {
    eventId: "evt-1",
    organizationId: "org-1",
    configured: true,
    enabled: true,
    imap_host: "imap.example.com",
    imap_port: 993,
    imap_username: "bounce@example.com",
    imap_password: { set: true, masked: "••••" },
    reuse_smtp_credentials: false,
    smtp_reuse_available: false,
    folders: ["INBOX", "Junk Email"],
    poll_interval_minutes: 5,
    lastRun: null,
    ...overrides,
  };
}

function renderPanel(isArchived = false) {
  const ref = createRef<EventBounceIngestPanelHandle>();
  const result = renderWithToast(
    <EventBounceIngestPanel ref={ref} eventId="evt-1" isArchived={isArchived} />,
  );
  return { ...result, ref };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockSave.mockReset();
  mockTest.mockReset();
  mockRun.mockReset();
  mockFetch.mockResolvedValue(bounceResponse());
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("EventBounceIngestPanel", () => {
  it("shows the loaded IMAP host after a successful fetch", async () => {
    renderPanel();
    const hostInput = (await screen.findByLabelText("IMAP host")) as HTMLInputElement;
    expect(hostInput.value).toBe("imap.example.com");
  });

  it("shows a load error with Retry when the fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    mockFetch.mockResolvedValueOnce(bounceResponse());
    renderPanel();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(
      /Failed to load bounce detection settings/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("IMAP host")).toBeTruthy();
  });

  it("toasts a port validation error and does not save", async () => {
    const { ref } = renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "99999" } });
    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /IMAP port must be a number between 1 and 65535/,
      );
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("saves a new password via saveEventBounceIngestSettings", async () => {
    mockSave.mockResolvedValueOnce(bounceResponse());
    const { ref } = renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByPlaceholderText("New value"), {
      target: { value: "imap-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][1]).toMatchObject({
      imap_password: "imap-secret",
    });
  });

  it("hides username and password fields when SMTP reuse is on and available", async () => {
    mockFetch.mockResolvedValueOnce(
      bounceResponse({
        reuse_smtp_credentials: true,
        smtp_reuse_available: true,
        imap_username: null,
        imap_password: { set: true, masked: "••••", from_smtp: true },
      }),
    );
    renderPanel();

    await screen.findByLabelText("IMAP host");
    expect(screen.queryByLabelText("Username")).toBeNull();
    expect(screen.queryByText("Password")).toBeNull();
    expect(
      screen.getByRole("switch", { name: "Use SMTP username and password" }),
    ).toBeTruthy();
  });

  it("blocks Test connection while the form has unsaved changes", async () => {
    renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.change(screen.getByLabelText("IMAP host"), {
      target: { value: "imap.dirty.example.com" },
    });

    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Test connection" }))).toBe(true);
    });
    expect(screen.getByText("Save your changes first.")).toBeTruthy();
    expect(mockTest).not.toHaveBeenCalled();
  });

  it("shows a success notice after Test connection succeeds", async () => {
    mockTest.mockResolvedValueOnce({
      ok: true,
      message: "Connected. Checked 1 folder.",
    });
    renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText(/Connected\. Checked 1 folder\./)).toBeTruthy();
    });
    expect(mockTest).toHaveBeenCalledWith("evt-1");
  });

  it("disables controls when the event is archived", async () => {
    renderPanel(true);
    await screen.findByLabelText("IMAP host");

    expect(isDisabled(screen.getByLabelText("IMAP host"))).toBe(true);
    expect(isDisabled(screen.getByLabelText("Port"))).toBe(true);
    expect(isDisabled(screen.getByRole("switch", { name: "On" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Test connection" }))).toBe(true);
    expect(screen.getByText("This event is archived.")).toBeTruthy();
  });

  it("toasts save failure without leaking server detail", async () => {
    mockSave.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    const { ref } = renderPanel();
    await screen.findByLabelText("IMAP host");

    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Failed to save bounce detection settings/,
      );
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("saves clear_imap_password when the password is cleared", async () => {
    mockSave.mockResolvedValueOnce(
      bounceResponse({ imap_password: { set: false, masked: null } }),
    );
    const { ref } = renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][1]).toMatchObject({ clear_imap_password: true });
  });

  it("reset via ref reverts unsaved edits", async () => {
    const { ref } = renderPanel();
    const hostInput = (await screen.findByLabelText("IMAP host")) as HTMLInputElement;

    fireEvent.change(hostInput, { target: { value: "imap.dirty.example.com" } });
    expect(hostInput.value).toBe("imap.dirty.example.com");

    act(() => {
      ref.current?.reset();
    });

    await waitFor(() => {
      expect((screen.getByLabelText("IMAP host") as HTMLInputElement).value).toBe(
        "imap.example.com",
      );
    });
  });

  it("shows an error notice when Test connection fails", async () => {
    mockTest.mockResolvedValueOnce({
      ok: false,
      error: "Authentication failed.",
    });
    renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText(/Authentication failed/)).toBeTruthy();
    });
  });

  it("blocks Test connection when poll interval is dirty", async () => {
    renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.change(screen.getByLabelText("Check every"), { target: { value: "15" } });

    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Test connection" }))).toBe(true);
    });
    expect(mockTest).not.toHaveBeenCalled();
  });

  it("toasts success after save", async () => {
    mockSave.mockResolvedValueOnce(bounceResponse());
    const { ref } = renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.change(screen.getByLabelText("Folders to check"), {
      target: { value: "INBOX, Spam" },
    });
    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Bounce detection settings saved/);
    });
  });

  it("blocks Test connection when bounce detection is not configured", async () => {
    mockFetch.mockResolvedValueOnce(bounceResponse({ configured: false, enabled: false }));
    renderPanel();
    await screen.findByLabelText("IMAP host");

    expect(isDisabled(screen.getByRole("button", { name: "Test connection" }))).toBe(true);
    expect(screen.getByText("Save your bounce detection settings first.")).toBeTruthy();
  });

  it("shows unavailable SMTP reuse hint when smtp_reuse_available is false", async () => {
    mockFetch.mockResolvedValueOnce(
      bounceResponse({ smtp_reuse_available: false, reuse_smtp_credentials: false }),
    );
    renderPanel();
    await screen.findByLabelText("IMAP host");

    expect(screen.getByText(/Available when this event's mail transport is SMTP/)).toBeTruthy();
    expect(isDisabled(screen.getByRole("switch", { name: "Use SMTP username and password" }))).toBe(
      true,
    );
  });

  it("shows an error notice when Test connection throws", async () => {
    mockTest.mockRejectedValueOnce(new Error("network down"));
    renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText(/Could not test the IMAP connection/)).toBeTruthy();
  });

  it("saves with SMTP reuse when the switch is on and SMTP reuse is available", async () => {
    mockFetch.mockResolvedValueOnce(
      bounceResponse({
        smtp_reuse_available: true,
        reuse_smtp_credentials: false,
      }),
    );
    mockSave.mockResolvedValueOnce(
      bounceResponse({
        smtp_reuse_available: true,
        reuse_smtp_credentials: true,
        imap_username: null,
        imap_password: { set: true, masked: "••••", from_smtp: true },
      }),
    );
    const { ref } = renderPanel();
    await screen.findByLabelText("IMAP host");

    fireEvent.click(screen.getByRole("switch", { name: "Use SMTP username and password" }));
    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][1]).toMatchObject({ reuse_smtp_credentials: true });
    expect(mockSave.mock.calls[0][1]).not.toHaveProperty("imap_password");
  });

  it("refresh() re-fetches settings so smtp_reuse_available updates", async () => {
    mockFetch
      .mockResolvedValueOnce(bounceResponse({ smtp_reuse_available: false }))
      .mockResolvedValueOnce(bounceResponse({ smtp_reuse_available: true }));
    const { ref } = renderPanel();
    await screen.findByLabelText("IMAP host");
    expect(isDisabled(screen.getByRole("switch", { name: "Use SMTP username and password" }))).toBe(
      true,
    );

    await act(async () => {
      ref.current?.refresh();
    });

    await waitFor(() =>
      expect(isDisabled(screen.getByRole("switch", { name: "Use SMTP username and password" }))).toBe(
        false,
      ),
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("shows Waiting for first automatic check when enabled and lastRun is null", async () => {
    mockFetch.mockResolvedValueOnce(bounceResponse({ enabled: true, lastRun: null }));
    renderPanel();
    expect(await screen.findByText("Waiting for first automatic check")).toBeTruthy();
  });

  it("shows Off when bounce detection is disabled and lastRun is null", async () => {
    mockFetch.mockResolvedValueOnce(bounceResponse({ enabled: false, lastRun: null }));
    renderPanel();
    expect(
      await screen.findByText(
        /Turn bounce detection on and save\. Automatic checks will appear here/,
      ),
    ).toBeTruthy();
  });

  it("shows last automatic check OK status and counts", async () => {
    mockFetch.mockResolvedValueOnce(
      bounceResponse({
        lastRun: {
          at: "2026-08-06T10:00:00.000Z",
          ok: true,
          messagesSeen: 3,
          bouncesApplied: 1,
          softBouncesLogged: 0,
          unparsed: 0,
          noMatchingDelivery: 0,
          errors: 0,
          connectFailed: false,
        },
      }),
    );
    renderPanel();
    expect(await screen.findByText(/^OK ·/)).toBeTruthy();
    expect(screen.getByText(/3 seen/)).toBeTruthy();
    expect(screen.getByText(/1 bounced/)).toBeTruthy();
  });

  it("shows Failed when lastRun.ok is false", async () => {
    mockFetch.mockResolvedValueOnce(
      bounceResponse({
        lastRun: {
          at: "2026-08-06T10:00:00.000Z",
          ok: false,
          messagesSeen: 0,
          bouncesApplied: 0,
          softBouncesLogged: 0,
          unparsed: 0,
          noMatchingDelivery: 0,
          errors: 1,
          connectFailed: true,
        },
      }),
    );
    renderPanel();
    expect(await screen.findByText(/^Failed ·/)).toBeTruthy();
    expect(screen.getByText(/connect failed/)).toBeTruthy();
  });

  it("shows Run check now and updates lastRun after a manual run", async () => {
    mockFetch.mockResolvedValueOnce(bounceResponse({ enabled: true, lastRun: null }));
    mockRun.mockResolvedValueOnce({
      ok: true,
      message: "Check finished. 2 seen, 1 bounced.",
      lastRun: {
        at: "2026-08-06T11:00:00.000Z",
        ok: true,
        messagesSeen: 2,
        bouncesApplied: 1,
        softBouncesLogged: 0,
        unparsed: 0,
        noMatchingDelivery: 0,
        errors: 0,
        connectFailed: false,
      },
    });
    renderPanel();
    const runButton = await screen.findByRole("button", { name: "Run check now" });
    expect(isDisabled(runButton)).toBe(false);
    fireEvent.click(runButton);
    await waitFor(() => {
      expect(mockRun).toHaveBeenCalledWith("evt-1");
    });
    expect(await screen.findByText(/^OK ·/)).toBeTruthy();
    expect(document.querySelector(".org-mail-summary")?.textContent).toMatch(/2 seen/);
  });

  it("toasts an error when Run check now fails", async () => {
    mockFetch.mockResolvedValueOnce(bounceResponse({ enabled: true, lastRun: null }));
    mockRun.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Run check now" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not run bounce check/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("disables Run check now when the event is archived", async () => {
    mockFetch.mockResolvedValueOnce(bounceResponse({ enabled: true, lastRun: null }));
    renderPanel(true);
    expect(isDisabled(await screen.findByRole("button", { name: "Run check now" }))).toBe(true);
  });

  it("disables Run check now when bounce detection is off", async () => {
    mockFetch.mockResolvedValueOnce(bounceResponse({ enabled: false, lastRun: null }));
    renderPanel();
    const runButton = await screen.findByRole("button", { name: "Run check now" });
    expect(isDisabled(runButton)).toBe(true);
  });
});
