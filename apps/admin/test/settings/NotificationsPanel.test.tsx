// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsPanel } from "../../src/settings/NotificationsPanel.js";
import { renderWithToastAndRouter } from "../test-utils.js";
import type { NotificationEmailRecipientDto, NotificationSettingsResponse } from "../../src/api/types.js";

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

function sampleRecipient(
  email: string,
  overrides: Partial<NotificationEmailRecipientDto> = {},
): NotificationEmailRecipientDto {
  return {
    email,
    description: "",
    added_at: "2026-01-01T00:00:00.000Z",
    added_by_email: "admin@example.com",
    added_by_display_name: "Admin",
    added_by_timezone: "Europe/Warsaw",
    ...overrides,
  };
}

function sampleResponse(
  overrides: Partial<NotificationSettingsResponse> = {},
): NotificationSettingsResponse {
  return {
    webhook: { set: false, kind: "generic" },
    extra_email_recipients: [],
    disabled_channels: {},
    notification_types: [
      {
        id: "auth.login.repeated_failures",
        label: "Repeated failed logins",
        default_severity: "error",
        available_channels: ["webhook", "email", "in_app"],
      },
      {
        id: "auth.mfa.break_glass",
        label: "MFA break-glass used",
        default_severity: "error",
        available_channels: ["webhook", "email", "in_app"],
      },
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
    expect(screen.queryByText("Notification types")).toBeTruthy();
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

  it("renders every notification type from the response as a matrix row", async () => {
    await renderLoaded();
    expect(screen.getByText("Repeated failed logins")).toBeTruthy();
    expect(screen.getByText("MFA break-glass used")).toBeTruthy();
  });

  it("renders one switch per available channel for a type, and none for a channel it doesn't support", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        notification_types: [
          {
            id: "auth.login.repeated_failures",
            label: "Repeated failed logins",
            default_severity: "error",
            available_channels: ["webhook", "in_app"],
          },
        ],
      }),
    );
    await renderLoaded();
    expect(document.getElementById("notifications-type-auth.login.repeated_failures-webhook")).toBeTruthy();
    expect(document.getElementById("notifications-type-auth.login.repeated_failures-in_app")).toBeTruthy();
    expect(document.getElementById("notifications-type-auth.login.repeated_failures-email")).toBeNull();
  });

  it("shows the webhook URL as 'Not set' by default, never a real value", async () => {
    await renderLoaded();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.queryByDisplayValue(/https?:\/\//)).toBeNull();
  });

  it("shows the webhook URL as configured when already set, never the real value", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ webhook: { set: true, kind: "discord" } }));
    await renderLoaded();
    expect(screen.getByText("•••••••• set")).toBeTruthy();
    expect(screen.queryByDisplayValue(/https?:\/\//)).toBeNull();
  });

  it("adds an email with a description and saves both", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-input"), {
      target: { value: "ops@example.com" },
    });
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-description"), {
      target: { value: "Ops team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("ops@example.com")).toBeTruthy();
    expect(screen.getByText("Ops team")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          extraEmailRecipients: [{ email: "ops@example.com", description: "Ops team" }],
        }),
      );
    });
  });

  it("shows 'No description' for a recipient added without one, and 'Not saved yet' before the first save", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-input"), {
      target: { value: "ops@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("No description")).toBeTruthy();
    expect(screen.getByText("Not saved yet")).toBeTruthy();
  });

  it("shows when a saved recipient was added and by whom", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        extra_email_recipients: [
          sampleRecipient("ops@example.com", { added_by_display_name: "Jane Admin" }),
        ],
      }),
    );
    await renderLoaded();
    expect(screen.getByText(/by Jane Admin/)).toBeTruthy();
  });

  it("does nothing when Add is clicked with a blank email input", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
    expect(screen.queryByText("Not saved yet")).toBeNull();
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

  it("rejects adding an address already in the list, instead of silently clearing the input", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }),
    );
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-input"), {
      target: { value: "ops@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("This address is already in the list.")).toBeTruthy();
    // The input keeps its value - a silent clear would look like the add succeeded.
    expect(el<HTMLInputElement>("notifications-extra-recipient-input").value).toBe("ops@example.com");
    expect(screen.getAllByText("ops@example.com")).toHaveLength(1);
  });

  it("removes a recipient only after confirming, not on the first click", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    expect(screen.getByText("ops@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove ops@example.com" }));
    expect(screen.getByText("ops@example.com")).toBeTruthy(); // still there - only a confirm dialog opened
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("ops@example.com")).toBeNull();
  });

  it("keeps the recipient when the removal confirmation is cancelled", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Remove ops@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("ops@example.com")).toBeTruthy();
  });

  it("toggles one channel off for a type and saves only that channel as disabled", async () => {
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-webhook"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ disabledChannels: { "auth.mfa.break_glass": ["webhook"] } }),
      );
    });
  });

  it("keeps the other channels of the same type enabled when only one is toggled off", async () => {
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-webhook"));
    expect(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-email").checked).toBe(true);
    expect(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-in_app").checked).toBe(true);
  });

  it("sets a new webhook URL via the Set/Confirm flow and saves it", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.change(el<HTMLInputElement>("notifications-webhook-url"), {
      target: { value: "https://discord.com/api/webhooks/x/y" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: "https://discord.com/api/webhooks/x/y" }),
      );
    });
  });

  it("sends the clear flag (empty string) when 'Clear' is chosen, not the previous value", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ webhook: { set: true, kind: "discord" } }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ webhookUrl: "" }));
    });
  });

  it("disables the webhook test-send button while there are unsaved changes", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: "Send test (webhook)" })).not.toHaveProperty("disabled", true);
    fireEvent.click(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-webhook"));
    expect(screen.getByRole("button", { name: "Send test (webhook)" })).toHaveProperty("disabled", true);
  });

  it("disables a recipient row's test button while there are unsaved changes", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    expect(screen.getByRole("button", { name: "Send test to ops@example.com" })).not.toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-webhook"));
    expect(screen.getByRole("button", { name: "Send test to ops@example.com" })).toHaveProperty("disabled", true);
  });

  it("shows only the webhook/in-app result when tested from the Webhook card, never the Email card", async () => {
    mockTest.mockResolvedValueOnce({
      webhook: { ok: false, error: "Not configured." },
      email: { ok: true },
      in_app: { ok: true },
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test (webhook)" }));
    await waitFor(() => {
      expect(screen.getByText("Webhook test failed")).toBeTruthy();
    });
    expect(
      screen.getByText("Not configured. It was still saved as a notification on your account."),
    ).toBeTruthy();
    expect(screen.queryByText(/Test email/)).toBeNull();
  });

  it("sends the test with no address (own account) when triggered from the Webhook card", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test (webhook)" }));
    await waitFor(() => {
      expect(mockTest).toHaveBeenCalledWith(undefined);
    });
  });

  it("sends the test to a recipient's own address when that row's test button is clicked, and shows only that result", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ extra_email_recipients: [sampleRecipient("colleague@example.com")] }),
    );
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test to colleague@example.com" }));
    await waitFor(() => {
      expect(mockTest).toHaveBeenCalledWith("colleague@example.com");
    });
    await waitFor(() => {
      expect(screen.getByText("Test email sent")).toBeTruthy();
    });
    expect(screen.getByText("to colleague@example.com")).toBeTruthy();
    // Webhook/in-app aren't part of what this row's button tested - never shown on the Webhook card.
    expect(screen.queryByText(/Test notification/)).toBeNull();
  });

  it("leaves the Webhook card's own button untouched (label and enabled state) while a recipient row's test is in flight", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ extra_email_recipients: [sampleRecipient("colleague@example.com")] }),
    );
    await renderLoaded();
    let resolveTest: (value: Awaited<ReturnType<typeof testNotificationSettings>>) => void = () => {};
    mockTest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTest = resolve;
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Send test to colleague@example.com" }));
    await waitFor(() => {
      expect(mockTest).toHaveBeenCalledWith("colleague@example.com");
    });
    const webhookButton = screen.getByRole("button", { name: "Send test (webhook)" });
    expect(webhookButton.textContent).toContain("Send test");
    expect(webhookButton).not.toHaveProperty("disabled", true);

    await act(async () => {
      resolveTest({ webhook: { ok: true, skipped: true }, email: { ok: true }, in_app: { ok: true, skipped: true } });
    });
  });

  it("leaves a recipient row's own button enabled while the Webhook card's test is in flight", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ extra_email_recipients: [sampleRecipient("colleague@example.com")] }),
    );
    await renderLoaded();
    let resolveTest: (value: Awaited<ReturnType<typeof testNotificationSettings>>) => void = () => {};
    mockTest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTest = resolve;
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Send test (webhook)" }));
    await waitFor(() => {
      expect(mockTest).toHaveBeenCalledWith(undefined);
    });
    expect(
      screen.getByRole("button", { name: "Send test to colleague@example.com" }),
    ).not.toHaveProperty("disabled", true);

    await act(async () => {
      resolveTest({ webhook: { ok: true }, email: { ok: true, skipped: true }, in_app: { ok: true } });
    });
  });

  it("discards a stale test response that resolves after a newer test has already started, instead of misattributing it", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ extra_email_recipients: [sampleRecipient("colleague@example.com")] }),
    );
    await renderLoaded();
    let resolveWebhookTest: (value: Awaited<ReturnType<typeof testNotificationSettings>>) => void = () => {};
    let resolveEmailTest: (value: Awaited<ReturnType<typeof testNotificationSettings>>) => void = () => {};
    mockTest.mockReturnValueOnce(new Promise((resolve) => (resolveWebhookTest = resolve)));
    mockTest.mockReturnValueOnce(new Promise((resolve) => (resolveEmailTest = resolve)));

    fireEvent.click(screen.getByRole("button", { name: "Send test (webhook)" }));
    await waitFor(() => expect(mockTest).toHaveBeenNthCalledWith(1, undefined));
    fireEvent.click(screen.getByRole("button", { name: "Send test to colleague@example.com" }));
    await waitFor(() => expect(mockTest).toHaveBeenNthCalledWith(2, "colleague@example.com"));

    await act(async () => {
      resolveEmailTest({
        webhook: { ok: true, skipped: true },
        email: { ok: true },
        in_app: { ok: true, skipped: true },
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Test email sent")).toBeTruthy();
    });

    await act(async () => {
      // Stale: this call started BEFORE the email test above, and its own skipped:true
      // webhook/in-app fields must never render as if the webhook itself had just succeeded.
      resolveWebhookTest({ webhook: { ok: true }, email: { ok: true, skipped: true }, in_app: { ok: true } });
    });

    expect(screen.getByText("Test email sent")).toBeTruthy();
    expect(screen.queryByText("Test notification sent")).toBeNull();
  });

  it("paginates the recipients table at 10 per page, by default", async () => {
    const recipients = Array.from({ length: 12 }, (_, i) => sampleRecipient(`colleague-${i}@example.com`));
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: recipients }));
    await renderLoaded();

    expect(screen.getByText("Showing 1–10 of 12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send test to colleague-0@example.com" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send test to colleague-10@example.com" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Showing 11–12 of 12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send test to colleague-10@example.com" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send test to colleague-0@example.com" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(screen.getByText("Showing 1–10 of 12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send test to colleague-0@example.com" })).toBeTruthy();
  });

  it("opens the edit modal prefilled with a recipient's current email and description", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com", { description: "Ops team" })] }),
    );
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit ops@example.com" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit recipient" })).toBeTruthy();
    expect((within(dialog).getByLabelText("Email address") as HTMLInputElement).value).toBe("ops@example.com");
    expect((within(dialog).getByLabelText("Description") as HTMLInputElement).value).toBe("Ops team");
  });

  it("saves an edited recipient's email, replacing the old one", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit ops@example.com" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email address"), { target: { value: "ops2@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.queryByText("ops@example.com")).toBeNull();
    expect(screen.getByText("ops2@example.com")).toBeTruthy();
  });

  it("clears a stale test result once the tested recipient is edited, since it may no longer describe the current list", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test to ops@example.com" }));
    await waitFor(() => {
      expect(screen.getByText("Test email sent")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit ops@example.com" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email address"), { target: { value: "ops2@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.queryByText("Test email sent")).toBeNull();
  });

  it("clears a stale test result once a recipient is removed", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test to ops@example.com" }));
    await waitFor(() => {
      expect(screen.getByText("Test email sent")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove ops@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Test email sent")).toBeNull();
  });

  it("saves an edited recipient's description without changing the email", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit ops@example.com" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Ops team" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.getByText("ops@example.com")).toBeTruthy();
    expect(screen.getByText("Ops team")).toBeTruthy();
  });

  it("rejects an invalid address in the edit modal without closing it", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit ops@example.com" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email address"), { target: { value: "not-an-email" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Edit recipient" })).toBeTruthy();
  });

  it("rejects editing a recipient to an address already in the list", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        extra_email_recipients: [sampleRecipient("ops@example.com"), sampleRecipient("finance@example.com")],
      }),
    );
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit ops@example.com" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email address"), { target: { value: "finance@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.getByText("This address is already in the list.")).toBeTruthy();
  });

  it("closes the edit modal without changes when Cancel is clicked", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit ops@example.com" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email address"), { target: { value: "ops2@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Edit recipient" })).toBeNull();
    expect(screen.getByText("ops@example.com")).toBeTruthy();
  });

  it("closes the edit modal without changes when the header Close button is clicked", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit ops@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Edit recipient" })).toBeNull();
  });

  it("loads an already-disabled channel from the server as unchecked", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ disabled_channels: { "auth.mfa.break_glass": ["webhook"] } }),
    );
    await renderLoaded();
    expect(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-webhook").checked).toBe(false);
    expect(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-email").checked).toBe(true);
  });

  it("re-enabling the only disabled channel for a type drops it from the saved disabledChannels entirely", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({ disabled_channels: { "auth.mfa.break_glass": ["webhook"] } }),
    );
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-webhook"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ disabledChannels: {} }));
    });
  });

  it("retrying after a failed load fetches again", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToastAndRouter(<NotificationsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    mockFetch.mockResolvedValueOnce(sampleResponse());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.queryByText("Notification types")).toBeTruthy();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("discards unsaved changes and clears the recipient input when Reset is clicked", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-input"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    fireEvent.click(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-webhook"));
    expect(screen.getByRole("button", { name: "Reset" })).not.toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(el<HTMLInputElement>("notifications-extra-recipient-input").value).toBe("");
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
    expect(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-webhook").checked).toBe(true);
  });

  it("shows an operator-safe error toast when saving fails", async () => {
    mockSave.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    await renderLoaded();
    fireEvent.click(el<HTMLInputElement>("notifications-type-auth.mfa.break_glass-webhook"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Failed to save notification settings.")).toBeTruthy();
  });

  it("shows an operator-safe error toast when a test-send call itself fails (not a per-channel result)", async () => {
    mockTest.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test (webhook)" }));
    expect(await screen.findByText("Could not send a test notification.")).toBeTruthy();
  });

  it("shows a combined failure message when both webhook and in-app fail, falling back to a generic subtitle when the webhook carries no error text", async () => {
    mockTest.mockResolvedValueOnce({
      webhook: { ok: false },
      email: { ok: true, skipped: true },
      in_app: { ok: false, error: "Write failed." },
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test (webhook)" }));
    await waitFor(() => {
      expect(screen.getByText("Test notification failed")).toBeTruthy();
    });
    expect(screen.getByText("Could not deliver it.")).toBeTruthy();
    expect(await screen.findByText("Test failed - check the details below.")).toBeTruthy();
  });

  it("falls back to a generic subtitle when a failed webhook-only test carries no error text", async () => {
    mockTest.mockResolvedValueOnce({
      webhook: { ok: false },
      email: { ok: true, skipped: true },
      in_app: { ok: true },
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test (webhook)" }));
    await waitFor(() => {
      expect(screen.getByText("Webhook test failed")).toBeTruthy();
    });
    expect(
      screen.getByText("Could not reach the webhook. It was still saved as a notification on your account."),
    ).toBeTruthy();
  });

  it("shows an in-app-only failure message when the webhook succeeds but saving as a notification fails", async () => {
    mockTest.mockResolvedValueOnce({
      webhook: { ok: true },
      email: { ok: true, skipped: true },
      in_app: { ok: false, error: "Write failed." },
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test (webhook)" }));
    await waitFor(() => {
      expect(screen.getByText("Saving it as a notification failed")).toBeTruthy();
    });
    expect(screen.getByText("Write failed. The webhook still received it.")).toBeTruthy();
  });

  it("falls back to a generic subtitle when a failed in-app-only test carries no error text", async () => {
    mockTest.mockResolvedValueOnce({
      webhook: { ok: true },
      email: { ok: true, skipped: true },
      in_app: { ok: false },
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test (webhook)" }));
    await waitFor(() => {
      expect(screen.getByText("Saving it as a notification failed")).toBeTruthy();
    });
    expect(screen.getByText("Could not save it. The webhook still received it.")).toBeTruthy();
  });

  it("shows the email error text (or a fallback) on a failed recipient test-send", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    mockTest.mockResolvedValueOnce({
      webhook: { ok: true, skipped: true },
      email: { ok: false, error: "Mailbox not found." },
      in_app: { ok: true, skipped: true },
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test to ops@example.com" }));
    expect(await screen.findByText("Mailbox not found.")).toBeTruthy();
  });

  it("falls back to a generic message when a failed email test carries no error text", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: [sampleRecipient("ops@example.com")] }));
    mockTest.mockResolvedValueOnce({
      webhook: { ok: true, skipped: true },
      email: { ok: false },
      in_app: { ok: true, skipped: true },
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send test to ops@example.com" }));
    expect(await screen.findByText("Test email failed")).toBeTruthy();
  });

  it("cancels an in-progress webhook URL edit without changing anything", async () => {
    mockFetch.mockResolvedValueOnce(sampleResponse({ webhook: { set: true, kind: "discord" } }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(el<HTMLInputElement>("notifications-webhook-url"), {
      target: { value: "https://discord.com/api/webhooks/x/y" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("•••••••• set")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("changes the webhook payload format and saves the new kind", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Payload format, Generic JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Slack" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ webhookKind: "slack" }));
    });
  });

  it("adds an email recipient when Enter is pressed in the email field, but not on any other key", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-input"), {
      target: { value: "ops@example.com" },
    });
    fireEvent.keyDown(el<HTMLInputElement>("notifications-extra-recipient-input"), { key: "a" });
    expect(screen.queryByText("ops@example.com")).toBeNull();

    fireEvent.keyDown(el<HTMLInputElement>("notifications-extra-recipient-input"), { key: "Enter" });
    expect(screen.getByText("ops@example.com")).toBeTruthy();
  });

  it("adds an email recipient when Enter is pressed in the description field, but not on any other key", async () => {
    await renderLoaded();
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-input"), {
      target: { value: "ops@example.com" },
    });
    fireEvent.change(el<HTMLInputElement>("notifications-extra-recipient-description"), {
      target: { value: "Ops team" },
    });
    fireEvent.keyDown(el<HTMLInputElement>("notifications-extra-recipient-description"), { key: "Tab" });
    expect(screen.queryByText("ops@example.com")).toBeNull();

    fireEvent.keyDown(el<HTMLInputElement>("notifications-extra-recipient-description"), { key: "Enter" });
    expect(screen.getByText("ops@example.com")).toBeTruthy();
    expect(screen.getByText("Ops team")).toBeTruthy();
  });

  it("changes the recipients page size and resets back to page 1", async () => {
    const recipients = Array.from({ length: 12 }, (_, i) => sampleRecipient(`colleague-${i}@example.com`));
    mockFetch.mockResolvedValueOnce(sampleResponse({ extra_email_recipients: recipients }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 11–12 of 12")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rows per page, 10" }));
    fireEvent.click(screen.getByRole("button", { name: "25" }));

    expect(screen.getByText("Showing 1–12 of 12")).toBeTruthy();
  });

  it("saving an edit to one of several recipients leaves the others untouched", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        extra_email_recipients: [
          sampleRecipient("ops@example.com", { description: "Ops" }),
          sampleRecipient("finance@example.com", { description: "Finance" }),
        ],
      }),
    );
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit ops@example.com" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email address"), { target: { value: "ops2@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(screen.getByText("ops2@example.com")).toBeTruthy();
    expect(screen.getByText("finance@example.com")).toBeTruthy();
    expect(screen.getByText("Finance")).toBeTruthy();
  });

  it("shows no 'by' attribution when a saved recipient has neither a display name nor an email on file", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        extra_email_recipients: [
          sampleRecipient("ops@example.com", { added_by_display_name: null, added_by_email: null }),
        ],
      }),
    );
    await renderLoaded();
    const muted = document.querySelector(".notifications-recipients-table__muted");
    expect(muted?.textContent).not.toMatch(/ by /);
  });

  it("falls back to a generic icon and description for a notification type outside the known list", async () => {
    mockFetch.mockResolvedValueOnce(
      sampleResponse({
        notification_types: [
          {
            id: "some.future.type",
            label: "Some future type",
            default_severity: "unknown_severity",
            available_channels: ["webhook"],
          },
        ],
      }),
    );
    await renderLoaded();
    expect(screen.getByText("Some future type")).toBeTruthy();
    expect(screen.getByText("Alerts admin staff when this event occurs.")).toBeTruthy();
  });

  it("discards a settings response that resolves after the panel has already unmounted, without a React state-update warning", async () => {
    let resolveFetch: (value: NotificationSettingsResponse) => void = () => {};
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { unmount } = renderWithToastAndRouter(<NotificationsPanel />);
    unmount();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      resolveFetch(sampleResponse());
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("discards a load failure that resolves after the panel has already unmounted, without a React state-update warning", async () => {
    let rejectFetch: (err: unknown) => void = () => {};
    mockFetch.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const { unmount } = renderWithToastAndRouter(<NotificationsPanel />);
    unmount();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      rejectFetch(new ApiError(500, "secret_internal"));
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
