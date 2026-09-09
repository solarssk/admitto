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
});
