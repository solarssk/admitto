// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventMailSettingsCard,
  type EventMailSettingsCardHandle,
} from "../../src/settings/EventMailSettingsCard.js";
import { renderWithToast } from "../test-utils.js";
import type { EventMailSettingsResponse, MailSettingsFieldsDto } from "../../src/api/types.js";

let mockAssignments: Array<{ role: string; scope_type: string; scope_id: string | null }> = [
  { role: "superadmin", scope_type: "instance", scope_id: null },
];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventMailSettings: vi.fn(),
    fetchEventBounceIngestSettings: vi.fn(),
    saveEventMailSettings: vi.fn(),
    clearEventMailSettings: vi.fn(),
    sendEventMailTransportTest: vi.fn(),
    probeEventMailSmtpConnection: vi.fn(),
  };
});

import {
  ApiError,
  clearEventMailSettings,
  fetchEventBounceIngestSettings,
  fetchEventMailSettings,
  probeEventMailSmtpConnection,
  saveEventMailSettings,
  sendEventMailTransportTest,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchEventMailSettings);
const mockFetchBounce = vi.mocked(fetchEventBounceIngestSettings);
const mockSave = vi.mocked(saveEventMailSettings);
const mockClear = vi.mocked(clearEventMailSettings);
const mockTest = vi.mocked(sendEventMailTransportTest);
const mockProbe = vi.mocked(probeEventMailSmtpConnection);

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLInputElement | HTMLButtonElement).disabled;
}

function plain<T>(value: T) {
  return { value, source: "db" as const, locked: false };
}

function secret(set: boolean) {
  return { set, masked: set ? ("••••" as const) : null, source: "db" as const, locked: false };
}

function baseFields(): MailSettingsFieldsDto {
  return {
    provider: plain(null),
    fromAddress: plain(null),
    fromName: plain(null),
    replyTo: plain(null),
    envelopeFrom: plain(null),
    allowedFromDomain: plain(null),
    host: plain(null),
    port: plain(null),
    secure: plain(null),
    user: plain(null),
    requireTls: plain(null),
    tlsRejectUnauthorized: plain(null),
    heloName: plain(null),
    pool: plain(null),
    maxConnections: plain(null),
    maxMessages: plain(null),
    rateLimitPerMinute: plain(null),
    connectionTimeout: plain(null),
    greetingTimeout: plain(null),
    socketTimeout: plain(null),
    smtpPassword: secret(false),
    mailbox: plain(null),
    tenantId: plain(null),
    clientId: plain(null),
    saveToSentItems: plain(null),
    graphClientSecret: secret(false),
    powerAutomateUrl: secret(false),
    powerAutomateKey: secret(false),
  };
}

function smtpFields(overrides: Partial<MailSettingsFieldsDto> = {}): MailSettingsFieldsDto {
  return {
    ...baseFields(),
    provider: plain("smtp"),
    fromAddress: plain("org@example.com"),
    host: plain("smtp.org.example.com"),
    port: plain(587),
    user: plain("org-user"),
    requireTls: plain(true),
    tlsRejectUnauthorized: plain(true),
    pool: plain(true),
    smtpPassword: secret(true),
    ...overrides,
  };
}

function graphFields(overrides: Partial<MailSettingsFieldsDto> = {}): MailSettingsFieldsDto {
  return {
    ...baseFields(),
    provider: plain("graph"),
    fromAddress: plain("org@example.com"),
    mailbox: plain("shared@example.com"),
    tenantId: plain("11111111-1111-1111-1111-111111111111"),
    clientId: plain("22222222-2222-2222-2222-222222222222"),
    graphClientSecret: secret(true),
    ...overrides,
  };
}

function inheritedResponse(overrides: Partial<EventMailSettingsResponse> = {}): EventMailSettingsResponse {
  return {
    eventId: "evt-1",
    organizationId: "org-1",
    isProduction: true,
    hasEventOverride: false,
    fields: smtpFields(),
    ...overrides,
  };
}

function dedicatedResponse(overrides: Partial<EventMailSettingsResponse> = {}): EventMailSettingsResponse {
  return {
    eventId: "evt-1",
    organizationId: "org-1",
    isProduction: true,
    hasEventOverride: true,
    fields: smtpFields({ host: plain("smtp.dedicated.example.com") }),
    ...overrides,
  };
}

const SMTP_SUMMARY_TEXT = "SMTP · sends as org@example.com";
const DEDICATED_HINT = /Useful for a co-branded event or a separate mailbox/;

function renderCard(isArchived = false) {
  const ref = createRef<EventMailSettingsCardHandle>();
  const result = renderWithToast(
    <MemoryRouter>
      <EventMailSettingsCard ref={ref} eventId="evt-1" isArchived={isArchived} />
    </MemoryRouter>,
  );
  return { ...result, ref };
}

/** Renders with a real route table so "Open instance settings" navigation is observable. */
function renderCardWithRoutes() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/settings"]}>
      <Routes>
        <Route
          path="/admin/events/evt-1/settings"
          element={<EventMailSettingsCard eventId="evt-1" isArchived={false} />}
        />
        <Route path="/admin/settings" element={<div>instance-settings-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
  mockFetch.mockReset();
  mockFetchBounce.mockReset();
  mockSave.mockReset();
  mockClear.mockReset();
  mockTest.mockReset();
  mockProbe.mockReset();
  mockFetchBounce.mockResolvedValue({
    eventId: "evt-1",
    organizationId: "org-1",
    configured: false,
    enabled: false,
    imap_host: null,
    imap_port: null,
    imap_username: null,
    imap_password: { set: false, masked: null },
    reuse_smtp_credentials: false,
    smtp_reuse_available: false,
    folders: ["INBOX"],
    poll_interval_minutes: 5,
  });
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EventMailSettingsCard — inherited (organization) mode", () => {
  it("shows the org's effective transport summary and the Organization toggle active", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();

    await screen.findByText(SMTP_SUMMARY_TEXT);
    expect(
      screen.getByRole("radio", { name: "Organization" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("shows Open instance settings link for a superadmin", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();

    expect(await screen.findByText("Open instance settings")).toBeTruthy();
  });

  it("navigates to instance mail settings when the link is clicked", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCardWithRoutes();

    fireEvent.click(await screen.findByText("Open instance settings"));

    expect(await screen.findByText("instance-settings-page")).toBeTruthy();
  });

  it("hides the instance settings link for a non-superadmin org admin", async () => {
    mockAssignments = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();

    await screen.findByText(SMTP_SUMMARY_TEXT);
    expect(screen.queryByText("Open instance settings")).toBeNull();
    expect(screen.getByText(/Only a superadmin can view or change the organization/)).toBeTruthy();
  });

  it("does not render the dedicated transport form while inherited", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();

    await screen.findByText(SMTP_SUMMARY_TEXT);
    expect(screen.queryByText(DEDICATED_HINT)).toBeNull();
  });

  it("gives the summary a positive treatment when a transport is actually configured", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();

    await screen.findByText(SMTP_SUMMARY_TEXT);
    expect(document.querySelector(".org-mail-summary--configured")).not.toBeNull();
  });

  it("shows a neutral not-set-up state when nothing is configured anywhere", async () => {
    mockFetch.mockResolvedValue(inheritedResponse({ fields: baseFields() }));
    renderCard();

    await screen.findByText("Organization mail transport not set up");
    expect(document.querySelector(".org-mail-summary--configured")).toBeNull();
  });
});

describe("EventMailSettingsCard — switching to dedicated", () => {
  it("starts blank on first toggle, not prefilled with the inherited org values", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));

    expect(screen.getByText(DEDICATED_HINT)).toBeTruthy();
    // No tile selected and no provider-specific card rendered yet — a prefilled-but-
    // unedited draft would otherwise silently save as a copy of the org's config.
    expect(screen.queryByLabelText("SMTP host")).toBeNull();
    for (const opt of ["SMTP (recommended)", "Microsoft Graph", "Power Automate"]) {
      expect(screen.getByRole("radio", { name: opt }).getAttribute("aria-checked")).toBe("false");
    }
  });

  it("shows the event's own saved values in dedicated mode when an override already exists", async () => {
    mockFetch.mockResolvedValue(dedicatedResponse());
    renderCard();

    await screen.findByText(DEDICATED_HINT);
    expect((screen.getByLabelText("SMTP host") as HTMLInputElement).value).toBe(
      "smtp.dedicated.example.com",
    );
  });

  it("preserves in-progress edits when toggling away and back before saving", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));
    fireEvent.click(screen.getByRole("radio", { name: "SMTP (recommended)" }));
    fireEvent.change(screen.getByLabelText("SMTP host"), {
      target: { value: "smtp.in-progress.example.com" },
    });

    fireEvent.click(screen.getByRole("radio", { name: "Organization" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));

    expect((screen.getByLabelText("SMTP host") as HTMLInputElement).value).toBe(
      "smtp.in-progress.example.com",
    );
  });

  it("excludes the Not configured tile in dedicated mode", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));

    expect(screen.queryByRole("radio", { name: "Not configured" })).toBeNull();
  });

  it("saves via saveEventMailSettings with the edited field and applies the response", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    mockSave.mockResolvedValue(dedicatedResponse());
    const { ref } = renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));
    fireEvent.click(screen.getByRole("radio", { name: "SMTP (recommended)" }));
    fireEvent.change(screen.getByLabelText("From address"), {
      target: { value: "dedicated@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SMTP host"), {
      target: { value: "smtp.dedicated.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "587" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "dedicated-user" } });
    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0]).toBe("evt-1");
    expect(mockSave.mock.calls[0][1]).toMatchObject({ host: "smtp.dedicated.example.com" });
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: "Dedicated" }).getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });

  it("Reset reverts the toggle and discards the draft", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    const { ref } = renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));
    expect(screen.getByText(DEDICATED_HINT)).toBeTruthy();

    act(() => {
      ref.current?.reset();
    });
    expect(
      screen.getByRole("radio", { name: "Organization" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByText(DEDICATED_HINT)).toBeNull();
  });

  it("shows validation errors and does not save an incomplete SMTP draft", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    const { ref } = renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));
    fireEvent.click(screen.getByRole("radio", { name: "SMTP (recommended)" }));
    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => {
      expect(screen.getByText("SMTP host is required.")).toBeTruthy();
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("toasts save failure without leaking server detail", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    mockSave.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    const { ref } = renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));
    fireEvent.click(screen.getByRole("radio", { name: "SMTP (recommended)" }));
    fireEvent.change(screen.getByLabelText("From address"), {
      target: { value: "dedicated@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SMTP host"), {
      target: { value: "smtp.dedicated.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "587" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "dedicated-user" } });
    await act(async () => {
      await ref.current?.save();
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save mail settings/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("renders the Graph card when the Microsoft Graph tile is selected", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));
    fireEvent.click(screen.getByRole("radio", { name: "Microsoft Graph" }));

    expect(screen.getByLabelText("Mailbox")).toBeTruthy();
    expect(screen.getByLabelText("Tenant ID")).toBeTruthy();
  });

  it("renders the Power Automate card when the Power Automate tile is selected", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));
    fireEvent.click(screen.getByRole("radio", { name: "Power Automate" }));

    expect(screen.getByText("Flow URL")).toBeTruthy();
    expect(screen.getByText("Flow key")).toBeTruthy();
  });
});

describe("EventMailSettingsCard — reverting to organization", () => {
  it("shows a revert warning instead of an org summary while a saved override is still toggled off", async () => {
    mockFetch.mockResolvedValue(dedicatedResponse());
    renderCard();
    await screen.findByText(DEDICATED_HINT);

    fireEvent.click(screen.getByRole("radio", { name: "Organization" }));

    expect(screen.getByText(/Reverting will remove this event's dedicated transport/)).toBeTruthy();
  });

  it("calls clearEventMailSettings on save and applies the inherited response", async () => {
    mockFetch.mockResolvedValue(dedicatedResponse());
    mockClear.mockResolvedValue(inheritedResponse());
    const { ref } = renderCard();
    await screen.findByText(DEDICATED_HINT);

    fireEvent.click(screen.getByRole("radio", { name: "Organization" }));
    await act(async () => {
      await ref.current?.save();
    });

    // Reverting to org mail is destructive (deletes the event's dedicated transport and
    // secrets) — it goes through a ConfirmDialog rather than saving immediately.
    expect(mockClear).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Revert" }));

    await waitFor(() => expect(mockClear).toHaveBeenCalledWith("evt-1"));
    await waitFor(() => expect(screen.queryByText(DEDICATED_HINT)).toBeNull());
  });

  it("cancelling the confirm dialog leaves the dedicated override in place", async () => {
    mockFetch.mockResolvedValue(dedicatedResponse());
    const { ref } = renderCard();
    await screen.findByText(DEDICATED_HINT);

    fireEvent.click(screen.getByRole("radio", { name: "Organization" }));
    await act(async () => {
      await ref.current?.save();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(mockClear).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the error inline in the confirm dialog when revert fails", async () => {
    mockFetch.mockResolvedValue(dedicatedResponse());
    mockClear.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    const { ref } = renderCard();
    await screen.findByText(DEDICATED_HINT);

    fireEvent.click(screen.getByRole("radio", { name: "Organization" }));
    await act(async () => {
      await ref.current?.save();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Revert" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog").textContent).toMatch(/Failed to revert mail settings/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
    // Dialog stays open on failure — the operator can retry or cancel.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("EventMailSettingsCard — test send", () => {
  it("sends via sendEventMailTransportTest and shows the result", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    mockTest.mockResolvedValue({ status: "sent", provider: "smtp" });
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "tester@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send test/ }));

    await waitFor(() =>
      expect(mockTest).toHaveBeenCalledWith("evt-1", "tester@example.com", { verifyBounce: false }),
    );
    await screen.findByText(/Your Admitto mail configuration is working/);
  });

  it("shows the mailbox for a successful Graph test send", async () => {
    mockFetch.mockResolvedValue(inheritedResponse({ fields: graphFields() }));
    mockTest.mockResolvedValue({ status: "sent", provider: "graph" });
    renderCard();
    await screen.findByText("Microsoft Graph · sends as org@example.com");

    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "tester@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send test/ }));

    await waitFor(() =>
      expect(mockTest).toHaveBeenCalledWith("evt-1", "tester@example.com", { verifyBounce: false }),
    );
    await screen.findByText("Mailbox");
    expect(screen.getByText("shared@example.com")).toBeTruthy();
  });

  it("falls back to a generic message when a failed test send has no error detail", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    mockTest.mockResolvedValue({ status: "failed", provider: "smtp" });
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "tester@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send test/ }));

    await waitFor(() => expect(mockTest).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("Send failed.").length).toBeGreaterThan(0));
  });

  it("disables test-send while the toggle has unsaved changes", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));

    expect(isDisabled(screen.getByRole("button", { name: /Send test/ }))).toBe(true);
  });

  it("disables Also verify bounce when bounce detection is not configured", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    const bounceSwitch = await screen.findByRole("switch", { name: "Also verify bounce" });
    expect(isDisabled(bounceSwitch)).toBe(true);
  });

  it("sends with verifyBounce when the switch is on and bounce is ready", async () => {
    mockFetchBounce.mockResolvedValue({
      eventId: "evt-1",
      organizationId: "org-1",
      configured: true,
      enabled: true,
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password: { set: true, masked: "••••" },
      reuse_smtp_credentials: false,
      smtp_reuse_available: true,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
    });
    mockFetch.mockResolvedValue(inheritedResponse());
    let resolveSend!: (value: {
      status: "sent";
      provider: "smtp";
      bounceProbe: { status: "ok"; message: string };
    }) => void;
    mockTest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    const bounceSwitch = await screen.findByRole("switch", { name: "Also verify bounce" });
    await waitFor(() => expect(isDisabled(bounceSwitch)).toBe(false));
    fireEvent.click(bounceSwitch);
    await waitFor(() => expect((bounceSwitch as HTMLInputElement).checked).toBe(true));

    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "nobody@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send test/ }));

    await waitFor(() =>
      expect(mockTest).toHaveBeenCalledWith("evt-1", "nobody@example.com", { verifyBounce: true }),
    );
    expect(screen.getByRole("button", { name: /^Waiting for bounce…$/ })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Waiting for bounce… 90s remaining/);

    await act(async () => {
      resolveSend({
        status: "sent",
        provider: "smtp",
        bounceProbe: {
          status: "ok",
          message: "Bounce received. Delivery marked bounced.",
        },
      });
    });
    await waitFor(() => {
      expect(screen.getAllByText(/Bounce received/).length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Transport and bounce detection are working")).toBeTruthy();
  });

  it("shows transport-ok but bounce-unverified when the probe times out", async () => {
    mockFetchBounce.mockResolvedValue({
      eventId: "evt-1",
      organizationId: "org-1",
      configured: true,
      enabled: true,
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password: { set: true, masked: "••••" },
      reuse_smtp_credentials: false,
      smtp_reuse_available: true,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
    });
    mockFetch.mockResolvedValue(inheritedResponse());
    mockTest.mockResolvedValue({
      status: "sent",
      provider: "smtp",
      providerMessageId: "<mid@example.com>",
      bounceProbe: {
        status: "timeout",
        message:
          "Mail was accepted by the transport, but no matching bounce appeared in IMAP within 90 seconds. Check the bounce folder, forward rule, and try again.",
      },
    });
    renderCard();
    await screen.findByText(SMTP_SUMMARY_TEXT);

    const bounceSwitch = await screen.findByRole("switch", { name: "Also verify bounce" });
    await waitFor(() => expect(isDisabled(bounceSwitch)).toBe(false));
    fireEvent.click(bounceSwitch);
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "nobody@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send test/ }));

    await waitFor(() => {
      expect(screen.getByText("Mail transport works, but bounce was not verified")).toBeTruthy();
    });
    expect(document.querySelector(".mail-preview--warn")).toBeTruthy();
    expect(screen.getAllByText(/no matching bounce appeared in IMAP/).length).toBeGreaterThan(0);
  });
});

describe("EventMailSettingsCard — SMTP Test connection", () => {
  it("enables Test connection for a saved dedicated SMTP transport", async () => {
    mockFetch.mockResolvedValue(dedicatedResponse());
    renderCard();
    await screen.findByLabelText("SMTP host");
    expect(isDisabled(screen.getByRole("button", { name: "Test connection" }))).toBe(false);
  });

  it("disables Test connection when dedicated SMTP has unsaved changes", async () => {
    mockFetch.mockResolvedValue(dedicatedResponse());
    renderCard();
    await screen.findByLabelText("SMTP host");
    fireEvent.change(screen.getByLabelText("SMTP host"), {
      target: { value: "smtp.dirty.example.com" },
    });
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Test connection" }))).toBe(true);
    });
    expect(document.querySelector(".smtp-connection-probe__hint")).toBeNull();
  });

  it("calls probeEventMailSmtpConnection on click", async () => {
    mockFetch.mockResolvedValue(dedicatedResponse());
    mockProbe.mockResolvedValueOnce({
      ok: true,
      message: "Connected. SMTP account verified.",
    });
    renderCard();
    await screen.findByLabelText("SMTP host");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => {
      expect(screen.getByText("Connected. SMTP account verified.")).toBeTruthy();
    });
    expect(mockProbe).toHaveBeenCalledWith("evt-1");
  });
});

describe("EventMailSettingsCard — archived event", () => {
  it("shows an archived note instead of the validation error area", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard(true);
    await screen.findByText(SMTP_SUMMARY_TEXT);

    expect(screen.getByText(/This event is archived - mail settings cannot be changed/)).toBeTruthy();
  });

  it("disables the mode toggle and test-send", async () => {
    mockFetch.mockResolvedValue(inheritedResponse());
    renderCard(true);
    await screen.findByText(SMTP_SUMMARY_TEXT);

    expect(isDisabled(screen.getByRole("radio", { name: "Dedicated" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: /Send test/ }))).toBe(true);
  });
});

describe("EventMailSettingsCard — loading and errors", () => {
  it("shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderCard();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading mail settings…")).toBeTruthy();
  });

  it("shows a retry EmptyState on load failure and recovers on retry", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    mockFetch.mockResolvedValueOnce(inheritedResponse());
    renderCard();

    expect(await screen.findByText("Could not load mail settings")).toBeTruthy();
    expect(screen.getByText("Failed to load mail settings.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText(SMTP_SUMMARY_TEXT)).toBeTruthy();
  });
});
