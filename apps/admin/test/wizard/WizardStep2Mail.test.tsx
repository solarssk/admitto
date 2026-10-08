// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MailPlainFieldDto,
  MailSecretFieldDto,
  MailSettingsFieldsDto,
  MailSettingsResponse,
  MailTransportTestSendResponse,
} from "../../src/api/types.js";
import { WizardProvider } from "../../src/pages/wizard/WizardContext.js";
import { advanceTimers, deferred, hangUntilAborted, isOff, renderWithToast } from "../test-utils.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";

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
import { WizardStep2Mail, type WizardStep2MailHandle } from "../../src/pages/wizard/WizardStep2Mail.js";

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

describe("WizardStep2Mail first read", () => {
  const placeholder = () => screen.queryByRole("status", { name: "Loading mail settings" });

  it("holds the form's room invisibly for 200ms, then draws a placeholder of its shape, and says it is taking longer after 8 seconds", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementationOnce(hangUntilAborted as never);
    renderStep();
    await advanceTimers(0);

    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(true);
    expect(screen.queryByText("Loading mail settings…")).toBeNull();
    await advanceTimers(200);
    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(false);
    await advanceTimers(7_799);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("fades the form in where the placeholder was once the read has answered", async () => {
    vi.useFakeTimers();
    const answer = deferred<MailSettingsResponse>();
    mockFetch.mockReturnValueOnce(answer.promise);
    renderStep();
    await advanceTimers(0);
    expect((placeholder() as HTMLElement).closest(".at-fade-in")).toBeNull();

    await act(async () => answer.resolve(smtpResponse()));
    await advanceTimers(500);
    expect(placeholder()).toBeNull();
    expect(screen.getByLabelText("SMTP host").closest(".at-fade-in")).not.toBeNull();
  });

  it("never draws the placeholder for an answer that comes within 200ms", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(smtpResponse());
    renderStep();
    await advanceTimers(0);

    expect(placeholder()).toBeNull();
    expect(screen.getByLabelText("SMTP host")).toBeTruthy();
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus, and hands the focus to the step's body when it works", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementationOnce(hangUntilAborted as never);
    renderWithToast(
      <div className="setup-wizard__body">
        <WizardProvider>
          <WizardStep2Mail />
        </WizardProvider>
      </div>,
    );
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(screen.queryByLabelText("SMTP host")).toBeNull();

    const answer = deferred<MailSettingsResponse>();
    mockFetch.mockReturnValueOnce(answer.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);

    await act(async () => answer.resolve(smtpResponse()));
    await advanceTimers(500);
    expect(screen.getByLabelText("SMTP host")).toBeTruthy();
    expect(document.activeElement).toBe(document.querySelector(".setup-wizard__body"));
  });

  it("announces a Retry that fails again with the same message: the message is mounted afresh in its live region", async () => {
    vi.useFakeTimers();
    mockFetch.mockRejectedValueOnce(new Error("network down")).mockRejectedValueOnce(new Error("network down"));
    renderStep();
    await advanceTimers(0);

    const message = () => screen.getByRole("alert").querySelector(".at-notice__body");
    const first = message();
    expect(first?.textContent).toContain("Could not load mail settings.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(500);
    // The 400ms minimum of the busy Retry ends in a timer that is set when the answer is in.
    await advanceTimers(400);

    expect(message()?.textContent).toContain("Could not load mail settings.");
    expect(message()).not.toBe(first);
  });

  it("does not save anything before the read has answered, and tells the step to stay", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementationOnce(hangUntilAborted as never);
    const ref = createRef<WizardStep2MailHandle>();
    renderWithToast(
      <WizardProvider>
        <WizardStep2Mail ref={ref} />
      </WizardProvider>,
    );
    await advanceTimers(0);

    let saved = true;
    await act(async () => {
      saved = await ref.current!.saveAndContinue();
    });
    expect(saved).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe("WizardStep2Mail load error", () => {
  it("shows a persistent error with Retry instead of leaving the step blank (regression)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    renderStep();

    expect(await screen.findByText("Could not load mail settings.")).toBeTruthy();
    // The form itself never mounts while apiData is still null - the error notice is the only
    // thing on screen, not a blank step.
    expect(screen.queryByLabelText("SMTP host")).toBeNull();

    mockFetch.mockResolvedValueOnce(smtpResponse());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("SMTP host")).toBeTruthy();
    expect(screen.queryByText("Could not load mail settings.")).toBeNull();
  });
});

describe("WizardStep2Mail Transport picker", () => {
  it("switches provider-specific fields and resets SMTP defaults when returning to SMTP", async () => {
    const response = smtpResponse();
    mockFetch.mockResolvedValueOnce(response);
    renderStep();

    fireEvent.click(await screen.findByRole("button", { name: /^Transport,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Microsoft Graph" }));

    // Else branch: draft.provider !== "smtp" going in, so only `provider` itself changes -
    // the Graph-only Tenant ID field appears, the SMTP-only host field is gone.
    expect(await screen.findByLabelText("Tenant ID")).toBeTruthy();
    expect(screen.queryByLabelText("SMTP host")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Transport,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "SMTP (recommended)" }));

    // If branch: draft.provider was "graph", so switching to "smtp" also merges in
    // smtpProviderDraftDefaults() - the SMTP host field is back, Tenant ID is gone.
    expect(await screen.findByLabelText("SMTP host")).toBeTruthy();
    expect(screen.queryByLabelText("Tenant ID")).toBeNull();
  });
});

describe("WizardStep2Mail validation Notice", () => {
  it("shows validation errors in a Notice when save is blocked", async () => {
    const response = smtpResponse();
    mockFetch.mockResolvedValueOnce(response);
    const ref = createRef<WizardStep2MailHandle>();
    renderWithToast(
      <WizardProvider>
        <WizardStep2Mail ref={ref} />
      </WizardProvider>,
    );

    fireEvent.change(await screen.findByLabelText("From address"), { target: { value: "" } });
    let saved = true;
    await act(async () => {
      saved = await ref.current!.saveAndContinue();
    });
    expect(saved).toBe(false);
    const notice = screen.getByRole("alert");
    expect(notice.className).toContain("at-notice--error");
    expect(notice.textContent).toMatch(/From address/i);
    expect(mockSave).not.toHaveBeenCalled();
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
    const sendTest = await screen.findByRole("button", { name: "Send test" });
    sendTest.focus();
    fireEvent.click(sendTest);

    // The button itself is busy, with the kit's spinner, and keeps its place and its keyboard focus.
    const sending = await screen.findByRole("button", { name: "Sending…" });
    expect(sending).toBe(sendTest);
    expect(sending.getAttribute("aria-busy")).toBe("true");
    expect(isOff(sending)).toBe(true);
    expect(sending.querySelector(".at-btn__spinner")).toBeTruthy();
    expect(sending.querySelector(".ti-loader-2")).toBeNull();
    expect(document.activeElement).toBe(sending);
    fireEvent.click(sending);
    expect(mockTestSend).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Optional, sent to your login email.")).toBeTruthy();

    resolveTestSend({ status: "sent", provider: "smtp" });

    const sent = await screen.findByRole("button", { name: "Test sent" });
    expect((sent as HTMLButtonElement).disabled).toBe(false);
    expect(sent.querySelector(".ti-circle-check")).toBeTruthy();
    expect(screen.getByText("Check your inbox.")).toBeTruthy();
    expect(mockTestSend).toHaveBeenCalledWith("admin@example.com");
  });
});
