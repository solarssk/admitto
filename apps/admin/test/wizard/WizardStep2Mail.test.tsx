// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MailPlainFieldDto,
  MailSecretFieldDto,
  MailSettingsFieldsDto,
  MailSettingsResponse,
  MailTransportTestSendResponse,
} from "../../src/api/types.js";
import { WizardProvider } from "../../src/pages/wizard/WizardContext.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchMailSettings: vi.fn(),
    saveMailSettings: vi.fn(),
    sendMailTransportTest: vi.fn(),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ user: { email: "admin@example.com" } }),
}));

import {
  fetchMailSettings,
  saveMailSettings,
  sendMailTransportTest,
} from "../../src/api/client.js";
import { WizardStep2Mail } from "../../src/pages/wizard/WizardStep2Mail.js";

const mockFetch = vi.mocked(fetchMailSettings);
const mockSave = vi.mocked(saveMailSettings);
const mockTestSend = vi.mocked(sendMailTransportTest);

function plain<T extends string | number | boolean | null>(value: T): MailPlainFieldDto<T> {
  return { value, source: "db", locked: false };
}

function secret(set: boolean): MailSecretFieldDto {
  return { set, masked: set ? "••••" : null, source: "db", locked: false };
}

function smtpFields(): MailSettingsFieldsDto {
  return {
    provider: plain("smtp"),
    fromAddress: plain("noreply@example.com"),
    fromName: plain("Admitto"),
    replyTo: plain(null),
    envelopeFrom: plain(null),
    allowedFromDomain: plain(null),
    host: plain("smtp.example.com"),
    port: plain(587),
    secure: plain(false),
    user: plain("smtp-user"),
    requireTls: plain(true),
    tlsRejectUnauthorized: plain(true),
    heloName: plain(null),
    pool: plain(true),
    maxConnections: plain(null),
    maxMessages: plain(null),
    rateLimitPerMinute: plain(null),
    connectionTimeout: plain(null),
    greetingTimeout: plain(null),
    socketTimeout: plain(null),
    smtpPassword: secret(true),
    mailbox: plain(null),
    tenantId: plain(null),
    clientId: plain(null),
    saveToSentItems: plain(null),
    graphClientSecret: secret(false),
    powerAutomateUrl: secret(false),
    powerAutomateKey: secret(false),
  };
}

function smtpResponse(): MailSettingsResponse {
  return { organizationId: "org-1", isProduction: true, fields: smtpFields() };
}

function renderStep() {
  return renderWithToast(
    <WizardProvider>
      <WizardStep2Mail />
    </WizardProvider>,
  );
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("WizardStep2Mail delayed loading", () => {
  it("shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderStep();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading mail settings…")).toBeTruthy();
  });
});

describe("WizardStep2Mail test-send feedback", () => {
  it("shows the pending send state, then the sent confirmation", async () => {
    const response = smtpResponse();
    mockFetch.mockResolvedValueOnce(response);
    mockSave.mockResolvedValueOnce(response);

    let resolveTestSend: (result: MailTransportTestSendResponse) => void = () => {};
    mockTestSend.mockImplementationOnce(
      () =>
        new Promise<MailTransportTestSendResponse>((resolve) => {
          resolveTestSend = resolve;
        }),
    );

    renderStep();
    fireEvent.click(await screen.findByRole("button", { name: "Send test" }));

    const sending = await screen.findByRole("button", { name: "Sending…" });
    expect((sending as HTMLButtonElement).disabled).toBe(true);
    expect(sending.querySelector(".ti-loader-2")).toBeTruthy();
    expect(screen.getByText("Optional, sent to your login email.")).toBeTruthy();

    resolveTestSend({ status: "sent", provider: "smtp" });

    const sent = await screen.findByRole("button", { name: "Test sent" });
    expect((sent as HTMLButtonElement).disabled).toBe(false);
    expect(sent.querySelector(".ti-circle-check")).toBeTruthy();
    expect(screen.getByText("Check your inbox.")).toBeTruthy();
    expect(mockTestSend).toHaveBeenCalledWith("admin@example.com");
  });
});
