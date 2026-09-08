// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsPanel } from "../../src/settings/NotificationsPanel.js";
import { renderWithToastAndRouter } from "../test-utils.js";
import type { NotificationSettingsResponse } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchNotificationSettings: vi.fn(),
    saveNotificationSettings: vi.fn(),
    testNotificationSettings: vi.fn(),
  };
});

import {
  ApiError,
  fetchNotificationSettings,
  saveNotificationSettings,
  testNotificationSettings,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchNotificationSettings);
const mockSave = vi.mocked(saveNotificationSettings);
const mockTest = vi.mocked(testNotificationSettings);

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function sampleResponse(
  overrides: Partial<NotificationSettingsResponse> = {},
): NotificationSettingsResponse {
  return {
    webhook: { set: false, kind: "generic" },
    extra_email_recipients: [],
    disabled_types: [],
    notification_types: [
      { id: "auth.login.repeated_failures", label: "Repeated failed logins", default_severity: "error" },
      { id: "auth.mfa.break_glass", label: "MFA break-glass used", default_severity: "error" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockResolvedValue(sampleResponse());
  mockSave.mockImplementation(async () => sampleResponse());
  mockTest.mockResolvedValue({
    webhook: { ok: true },
    email: { ok: true },
    in_app: { ok: true },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

async function renderLoaded() {
  renderWithToastAndRouter(<NotificationsPanel />);
  await waitFor(() => {
    expect(document.getElementById("notifications-webhook-url")).toBeTruthy();
  });
}

describe("NotificationsPanel", () => {
  it("shows the loading placeholder once the fetch has taken a moment", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToastAndRouter(<NotificationsPanel />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows an operator-safe message when settings fail to load", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToastAndRouter(<NotificationsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(screen.getByText("Could not load notification settings")).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("renders every notification type from the response as a toggle", async () => {
    await renderLoaded();
    expect(screen.getByText("Repeated failed logins")).toBeTruthy();
    expect(screen.getByText("MFA break-glass used")).toBeTruthy();
  });

  it("shows the webhook URL placeholder as 'set' vs 'not set', never the real value", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ webhook: { set: true, kind: "discord" } }));
    await renderLoaded();
    const input = el<HTMLInputElement>("notifications-webhook-url");
    expect(input.placeholder).toBe("•••••••• set");
    expect(input.value).toBe("");
  });

  it("adds an email to extra_email_recipients and saves it", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-input"), {
      target: { value: "ops@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("ops@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ extraEmailRecipients: ["ops@example.com"] }),
      );
    });
  });

  it("rejects an invalid email in the recipient input without adding it", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-input"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(screen.queryByText("not-an-email")).toBeNull();
  });

  it("removes an added email via its remove button", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: ["ops@example.com"] }));
    await renderLoaded();
    expect(screen.getByText("ops@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove ops@example.com" }));
    expect(screen.queryByText("ops@example.com")).toBeNull();
  });

  it("toggles a notification type off and saves disabledTypes", async () => {
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ disabledTypes: ["auth.mfa.break_glass"] }),
      );
    });
  });

  it("sends the clear flag (empty string) when 'Clear webhook URL' is checked, not the typed value", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ webhook: { set: true, kind: "discord" } }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("checkbox", { name: /Clear webhook URL/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ webhookUrl: "" }));
    });
  });

  it("disables the test-send button while there are unsaved changes", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: /Send test/ })).not.toHaveProperty("disabled", true);
    fireEvent.change(el<HTMLInputElement>("notifications-webhook-url"), {
      target: { value: "https://discord.com/api/webhooks/x/y" },
    });
    expect(screen.getByRole("button", { name: /Send test/ })).toHaveProperty("disabled", true);
  });

  it("shows per-channel test results after a successful test-send", async () => {
    mockTest.mockResolvedValueOnce({
      webhook: { ok: false, error: "Not configured." },
      email: { ok: true },
      in_app: { ok: true },
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Send test/ }));
    await waitFor(() => {
      expect(screen.getByText(/Webhook: Not configured\./)).toBeTruthy();
    });
    expect(screen.getByText(/Email: Sent/)).toBeTruthy();
    expect(screen.getByText(/In-app: Sent/)).toBeTruthy();
  });
});
