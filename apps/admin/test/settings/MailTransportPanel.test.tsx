// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailTransportPanel } from "../../src/settings/MailTransportPanel.js";
import { renderWithToast } from "../test-utils.js";
import type { MailSettingsFieldsDto, MailSettingsResponse } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchMailSettings: vi.fn(),
    saveMailSettings: vi.fn(),
    sendMailTransportTest: vi.fn(),
  };
});

import {
  ApiError,
  fetchMailSettings,
  saveMailSettings,
  sendMailTransportTest,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchMailSettings);
const mockSave = vi.mocked(saveMailSettings);
const mockTest = vi.mocked(sendMailTransportTest);

function plain<T>(value: T, opts: { source?: "env" | "db" | "default"; locked?: boolean } = {}) {
  return { value, source: opts.source ?? "db", locked: opts.locked ?? false };
}

function secret(set: boolean, opts: { source?: "env" | "db" | "default"; locked?: boolean } = {}) {
  return {
    set,
    masked: set ? ("••••" as const) : null,
    source: opts.source ?? "db",
    locked: opts.locked ?? false,
  };
}

/** Baseline "not configured" fields — every field null/unset, nothing locked. */
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
    fromAddress: plain("noreply@example.com"),
    fromName: plain("Admitto"),
    host: plain("smtp.example.com"),
    port: plain(587),
    secure: plain(false),
    user: plain("smtp-user"),
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
    fromAddress: plain("noreply@example.com"),
    mailbox: plain("shared@contoso.com"),
    tenantId: plain("11111111-1111-1111-1111-111111111111"),
    clientId: plain("22222222-2222-2222-2222-222222222222"),
    saveToSentItems: plain(true),
    graphClientSecret: secret(true),
    ...overrides,
  };
}

function powerAutomateFields(overrides: Partial<MailSettingsFieldsDto> = {}): MailSettingsFieldsDto {
  return {
    ...baseFields(),
    provider: plain("powerautomate"),
    fromAddress: plain("noreply@example.com"),
    powerAutomateUrl: secret(true),
    powerAutomateKey: secret(true),
    ...overrides,
  };
}

function exportOnlyFields(overrides: Partial<MailSettingsFieldsDto> = {}): MailSettingsFieldsDto {
  return {
    ...baseFields(),
    provider: plain("export_only"),
    fromAddress: plain("noreply@example.com"),
    ...overrides,
  };
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLInputElement | HTMLButtonElement).disabled;
}

function makeResponse(
  fields: MailSettingsFieldsDto,
  opts: { isProduction?: boolean } = {},
): MailSettingsResponse {
  return {
    organizationId: "org-1",
    isProduction: opts.isProduction ?? true,
    fields,
  };
}

beforeEach(() => {
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MailTransportPanel — provider rendering (#406/#408/#409)", () => {
  it("shows SMTP labeled 'SMTP (recommended)' as a transport tile", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(baseFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "SMTP (recommended)" })).toBeTruthy();
    });
  });

  it("renders 'Not configured' with no sender/transport fields when provider is unset", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(baseFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByRole("radiogroup", { name: "Transport" })).toBeTruthy();
    });
    expect(screen.getByRole("radio", { name: "Not configured" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.queryByLabelText("From address")).toBeNull();
    expect(screen.queryByLabelText("SMTP host")).toBeNull();
  });

  it("renders SMTP connection + tuning fields without crashing", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("SMTP host")).toBeTruthy();
    });
    expect(screen.getByLabelText("Port")).toBeTruthy();
    expect(screen.getByLabelText("Username")).toBeTruthy();
    // Tuning fields live inside a collapsible <details> — jsdom doesn't apply the
    // native closed-details hiding, so presence (not visibility) is what's testable here.
    expect(screen.getByText("Advanced tuning")).toBeTruthy();
    expect(screen.getByLabelText("Rate limit (per minute)")).toBeTruthy();
  });

  it("renders Graph branch fields and the Entra setup guide without crashing", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(graphFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Mailbox")).toBeTruthy();
    });
    expect(screen.getByLabelText("Tenant ID")).toBeTruthy();
    expect(screen.getByLabelText("Client ID")).toBeTruthy();
    expect(screen.getByText("Entra app registration steps")).toBeTruthy();
  });

  it("renders Power Automate branch fields without crashing", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(powerAutomateFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByText("Flow URL")).toBeTruthy();
    });
    expect(screen.getByText("Flow key")).toBeTruthy();
  });

  it("renders export_only dev warning", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(exportOnlyFields(), { isProduction: false }));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByText(/Dev\/test only/)).toBeTruthy();
    });
  });
});

describe("MailTransportPanel — secret field behavior (#407)", () => {
  it("shows a 'Set ••••' pill and a Change button when a secret is already set", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields({ smtpPassword: secret(true) })));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByText("Set ••••")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  });

  it("shows a primary Set button and no pill/Clear when a secret is unset", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields({ smtpPassword: secret(false) })));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set" })).toBeTruthy();
    });
    expect(screen.queryByText("Set ••••")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("clicking Change reveals a password input, Cancel, and an explanatory hint", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByPlaceholderText("Enter new value")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByText(/Saves with the page.s Save changes button below/)).toBeTruthy();
  });

  it("clicking Cancel returns the secret field to idle", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("Enter new value")).toBeNull();
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it("hides Set/Change/Clear buttons and shows an env badge when the secret is locked", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(smtpFields({ smtpPassword: secret(true, { source: "env", locked: true }) })),
    );
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByText("Set ••••")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.getByText("Managed by environment")).toBeTruthy();
  });
});

describe("MailTransportPanel — transport tile selection", () => {
  it("switching the tile updates which provider card renders", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("SMTP host")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("radio", { name: "Microsoft Graph" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Mailbox")).toBeTruthy();
    });
    expect(screen.queryByLabelText("SMTP host")).toBeNull();
    expect(screen.getByRole("radio", { name: "Microsoft Graph" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("shows a Configured badge once a transport is selected", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(baseFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "SMTP (recommended)" })).toBeTruthy();
    });
    expect(screen.queryByText("Configured")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "SMTP (recommended)" }));
    await waitFor(() => {
      expect(screen.getByText("Configured")).toBeTruthy();
    });
  });
});

describe("MailTransportPanel — test send gating (#410)", () => {
  it("disables test send with a 'configure a transport' reason when provider is unconfigured", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(baseFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Recipient")).toBeTruthy();
    });
    expect(isDisabled(screen.getByLabelText("Recipient"))).toBe(true);
    const sendButton = screen.getByRole("button", { name: "Send test email" });
    expect(isDisabled(sendButton)).toBe(true);
    expect(sendButton.getAttribute("aria-describedby")).toBe("mail-test-send-reason");
    expect(screen.getAllByText(/Select and save a transport/).length).toBeGreaterThan(0);
  });

  it("disables test send with an 'unsaved changes' reason once the draft is dirtied", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Send test email" }))).toBe(false);
    });
    fireEvent.change(screen.getByLabelText("From name"), { target: { value: "Changed Name" } });
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Send test email" }))).toBe(true);
    });
    expect(screen.getByText(/Save your changes before sending a test email/)).toBeTruthy();
  });

  it("enables test send for a configured, saved SMTP transport", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Send test email" }))).toBe(false);
    });
    expect(isDisabled(screen.getByLabelText("Recipient"))).toBe(false);
  });

  it("export_only never allows test send even when saved", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(exportOnlyFields(), { isProduction: false }));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Send test email" }))).toBe(true);
    });
    expect(screen.getAllByText(/Select and save a transport/).length).toBeGreaterThan(0);
  });
});

describe("MailTransportPanel — test result panel (#411)", () => {
  async function renderReadySmtp() {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Send test email" }))).toBe(false);
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
      target: { value: "ops@example.com" },
    });
  }

  it("renders recipient, provider, host, and message ID on a successful send", async () => {
    await renderReadySmtp();
    mockTest.mockResolvedValueOnce({
      status: "sent",
      provider: "smtp",
      providerMessageId: "queue-123",
    });
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
    await waitFor(() => {
      expect(document.querySelector(".mail-preview--ok")).toBeTruthy();
    });
    const panel = document.querySelector(".mail-preview--ok");
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain("ops@example.com");
    expect(panel?.textContent).toContain("SMTP");
    expect(panel?.textContent).toContain("smtp.example.com:587");
    expect(panel?.textContent).toContain("queue-123");
  });

  it("renders a retryable=false hint on an API-reported failure", async () => {
    await renderReadySmtp();
    mockTest.mockResolvedValueOnce({
      status: "failed",
      error: "Authentication rejected by server.",
      provider: "smtp",
      retryable: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
    await waitFor(() => {
      expect(document.querySelector(".mail-preview--error")).toBeTruthy();
    });
    const panel = document.querySelector(".mail-preview--error");
    expect(panel?.textContent).toContain("Authentication rejected by server.");
    expect(panel?.textContent).toContain("ops@example.com");
    expect(panel?.textContent).toMatch(/Retryable/);
    expect(panel?.textContent).toMatch(/No/);
  });

  it("renders a retryable=true hint on a transient failure", async () => {
    await renderReadySmtp();
    mockTest.mockResolvedValueOnce({
      status: "failed",
      error: "Connection timed out.",
      provider: "smtp",
      retryable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
    await waitFor(() => {
      expect(document.querySelector(".mail-preview--error")).toBeTruthy();
    });
    const panel = document.querySelector(".mail-preview--error");
    expect(panel?.textContent).toMatch(/Retryable/);
    expect(panel?.textContent).toMatch(/Yes/);
  });

  it("renders a network/unexpected error without provider or retryable rows", async () => {
    await renderReadySmtp();
    mockTest.mockRejectedValueOnce(new Error("network down"));
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
    await waitFor(() => {
      expect(document.querySelector(".mail-preview--error")).toBeTruthy();
    });
    const panel = document.querySelector(".mail-preview--error");
    expect(panel?.textContent).toContain("Send failed.");
    expect(panel?.textContent).not.toMatch(/Retryable|Transport/);
  });

  it("clears the result panel when the transport tile is switched", async () => {
    await renderReadySmtp();
    mockTest.mockResolvedValueOnce({ status: "sent", provider: "smtp" });
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
    await waitFor(() => {
      expect(document.querySelector(".mail-preview")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("radio", { name: "Microsoft Graph" }));
    await waitFor(() => {
      expect(document.querySelector(".mail-preview")).toBeNull();
    });
  });
});

describe("MailTransportPanel — toast vs inline consistency (#4)", () => {
  it("shows an inline load error with Retry and does not toast it", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("shows client-side validation errors inline (not toasted) and scrolls them into view", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("From address")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("From address"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/From address must be a valid email/);
    });
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId("at-toast")).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("toasts a successful save", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    mockSave.mockResolvedValueOnce(makeResponse(smtpFields({ fromName: plain("New Name") })));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("From name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("From name"), { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Mail settings saved/);
    });
  });

  it("toasts save failure without leaking server detail", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    mockSave.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("From name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("From name"), { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save mail settings/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });
});

describe("MailTransportPanel — footer save-state", () => {
  it("shows 'All changes saved' when clean and 'Unsaved changes' once dirtied", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByText("All changes saved")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("From name"), { target: { value: "Changed Name" } });
    await waitFor(() => {
      expect(screen.getByText("Unsaved changes")).toBeTruthy();
    });
    expect(screen.queryByText("All changes saved")).toBeNull();
  });

  it("restores the saved draft and clears the unsaved-changes state on Reset", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(smtpFields()));
    renderWithToast(<MailTransportPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("From name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("From name"), { target: { value: "Changed Name" } });
    await waitFor(() => {
      expect(screen.getByText("Unsaved changes")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect((screen.getByLabelText("From name") as HTMLInputElement).value).toBe("Admitto");
    });
    expect(screen.getByText("All changes saved")).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
});
