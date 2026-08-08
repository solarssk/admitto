// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { MemoryRouter, Route, Routes, createMemoryRouter } from "react-router";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventOverview = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplates = vi.fn();
const fetchEventDeliveries = vi.fn();
const dismissBounce = vi.fn();
const resendTicket = vi.fn();
const reportApiError = vi.fn();

// A fresh `vi.fn()` per call (as this used to return) breaks CommunicationPage's own
// memoization: `reportApiError` sits in the dependency array of 3 effects (initial template
// load, the bounce-overview fetch, and the tab-switch delivery fetch), so an unstable identity
// re-fires all of them on every render, flickering `loading` fast enough that
// useDelayedLoading's 200ms window never elapses and the whole page intermittently renders
// null - a CI-only race, since a fast/idle local machine never lingers in that window long
// enough to observe it. Every sibling CommunicationPage test file already hoists this the same
// way; this file was the one holdout.
vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  TemplateValidationError: class TemplateValidationError extends Error {},
  fetchEventOverview: (...args: unknown[]) => fetchEventOverview(...args),
  fetchEventTemplate: (...args: unknown[]) => fetchEventTemplate(...args),
  fetchEventTemplates: (...args: unknown[]) => fetchEventTemplates(...args),
  fetchEventDeliveries: (...args: unknown[]) => fetchEventDeliveries(...args),
  dismissBounce: (...args: unknown[]) => dismissBounce(...args),
  resendTicket: (...args: unknown[]) => resendTicket(...args),
  exportDeliveryLog: vi.fn(),
  fetchEventTemplateById: vi.fn(),
  // The Send tab (now the default landing tab) auto-renders a preview on mount - resolve these
  // by default so that doesn't surface as an unrelated "Preview failed" error toast in tests
  // that never cared about preview content.
  previewEventTemplate: vi.fn().mockResolvedValue({ subject: "", html: "" }),
  previewEventTemplateById: vi.fn().mockResolvedValue({ subject: "", html: "" }),
  saveEventTemplate: vi.fn(),
  saveEventTemplateById: vi.fn(),
  createEventTemplate: vi.fn(),
  deleteEventTemplate: vi.fn(),
  updateEventTemplateMetadata: vi.fn(),
  testSendEventTemplate: vi.fn(),
  testSendEventTemplateById: vi.fn(),
  sendEventBulk: vi.fn(),
  fetchBulkSendStatus: vi.fn(),
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
  fetchEventMailSettings: vi.fn().mockResolvedValue({
    fields: { fromName: { value: null }, fromAddress: { value: null } },
  }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: null },
    }),
  };
});

const templatePayload = {
  source: "event" as const,
  allowed_placeholders: ["first_name"],
  required_url_placeholders: [],
  image_placeholders: [],
  subject_template: "Hello",
  body_template: "<p>Hi</p>",
  template_format: "html" as const,
};

function renderPageAt(eventId: string) {
  return renderWithToast(
    <MemoryRouter initialEntries={[`/admin/events/${eventId}/communication`]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderPage() {
  return renderPageAt("evt-1");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchEventTemplates.mockResolvedValue([]);
  // The delivery log tab (rendered by "View delivery log") uses useIsDesktop(), which reads
  // window.matchMedia - unimplemented in jsdom, so it must be stubbed even though this file's
  // focus is the bounce banner, not the log tab's responsive layout.
  mockMatchMedia(true);
});

describe("CommunicationPage bounce banner", () => {
  it("shows bounce banner when email_bounced > 0", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 3,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });

    renderPage();

    // Scoped to the captured alert node (not re-queried from `screen`) so a later, unrelated
    // re-render can't race this assertion the way two separate screen queries could.
    const banner = await screen.findByRole("alert");
    expect(banner.classList.contains("at-notice--warning")).toBe(true);
    expect(within(banner).getByText(/3 emails bounced/i)).toBeTruthy();
    expect(within(banner).getByRole("button", { name: "View delivery log" })).toBeTruthy();
  });

  it("uses singular wording when exactly one email bounced", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 1,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });

    renderPage();

    const banner = await screen.findByRole("alert");
    expect(within(banner).getByText(/^1 email bounced$/i)).toBeTruthy();
  });

  it("hides bounce banner when email_bounced is 0", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 0,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Send/i })).toBeTruthy();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("View delivery log switches to log tab with bounced filter", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 2,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({ items: [], total: 0 });

    renderPage();

    // Captured once and reused, not re-queried from `screen` a second time (see #592's identical
    // fix a few tests up in this same file) - a later, unrelated re-render can't race this click
    // the way two separate screen queries could.
    const viewLogButton = await screen.findByRole("button", { name: "View delivery log" });
    fireEvent.click(viewLogButton);

    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ status: "bounced", page: 1 }),
        expect.any(AbortSignal),
      );
    });
  });

  it("does not show bounce banner when overview fetch fails", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockRejectedValue(new Error("network"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Send/i })).toBeTruthy();
    });
    expect(screen.queryByText(/emails bounced/i)).toBeNull();
  });

  it("reports the API status when the overview fetch fails with an ApiError", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockRejectedValue(new ApiError(500, "internal_error"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Send/i })).toBeTruthy();
    });
    expect(reportApiError).toHaveBeenCalledWith(500);
  });

  it("clears stale bounce banner when navigating to another event", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    let resolveSecondOverview: (value: unknown) => void;
    const secondOverview = new Promise((resolve) => {
      resolveSecondOverview = resolve;
    });
    fetchEventOverview.mockImplementation((eventId: string) => {
      if (eventId === "evt-1") {
        return Promise.resolve({
          email_bounced: 3,
          email_failed: 0,
          email_sent: 10,
          email_queued: 0,
        });
      }
      return secondOverview;
    });

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/communication", element: <CommunicationPage /> }],
      { initialEntries: ["/admin/events/evt-1/communication"] },
    );
    renderWithToast(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByText(/3 emails bounced/i)).toBeTruthy();
    });

    await router.navigate("/admin/events/evt-2/communication");

    await waitFor(() => {
      expect(screen.queryByText(/3 emails bounced/i)).toBeNull();
    });

    resolveSecondOverview!({
      email_bounced: 0,
      email_failed: 0,
      email_sent: 1,
      email_queued: 0,
    });

    await waitFor(() => {
      expect(screen.queryByText(/emails bounced/i)).toBeNull();
    });
  });

  it("refreshes the bounce count after dismissing a bounce from the delivery log", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 1,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({
      items: [
        {
          id: "dlv-1",
          attendee_id: "att-1",
          attendee_name: "Guest One",
          purpose: "initial",
          status: "bounced",
          provider: "smtp",
          provider_message_id: null,
          attempts: 1,
          retryable: null,
          recipient_email: "guest@example.com",
          rendered_subject: "Your ticket",
          template_id: null,
          template_name: null,
          queued_at: "2026-09-01T12:00:00.000Z",
          accepted_at: null,
          sent_at: null,
          failed_at: "2026-09-01T12:00:01.000Z",
          error_code: "bounced",
          error: "Mailbox does not exist",
          client_timezone: null,
        },
      ],
      total: 1,
    });
    dismissBounce.mockResolvedValue({ email_bounce_dismissed_at: "2026-09-01T13:00:00.000Z" });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "View delivery log" }));
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss bounce" }));

    await waitFor(() => {
      expect(dismissBounce).toHaveBeenCalledWith("evt-1", "att-1");
    });
    expect(await screen.findByText("Dismissed the bounce notice for Guest One.")).toBeTruthy();
    // Once on mount, once again after the dismiss succeeds.
    await waitFor(() => {
      expect(fetchEventOverview).toHaveBeenCalledTimes(2);
    });
  });

  it("ignores a stale mount overview once a later bounce refresh has completed", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    let resolveMountOverview: (value: unknown) => void;
    const mountOverview = new Promise((resolve) => {
      resolveMountOverview = resolve;
    });
    let overviewCalls = 0;
    fetchEventOverview.mockImplementation(() => {
      overviewCalls += 1;
      if (overviewCalls === 1) return mountOverview;
      return Promise.resolve({
        email_bounced: 0,
        email_failed: 0,
        email_sent: 10,
        email_queued: 0,
      });
    });
    fetchEventDeliveries.mockResolvedValue({
      items: [
        {
          id: "dlv-1",
          attendee_id: "att-1",
          attendee_name: "Guest One",
          purpose: "initial",
          status: "bounced",
          provider: "smtp",
          provider_message_id: null,
          attempts: 1,
          retryable: null,
          recipient_email: "guest@example.com",
          rendered_subject: "Your ticket",
          template_id: null,
          template_name: null,
          queued_at: "2026-09-01T12:00:00.000Z",
          accepted_at: null,
          sent_at: null,
          failed_at: "2026-09-01T12:00:01.000Z",
          error_code: "bounced",
          error: "Mailbox does not exist",
          client_timezone: null,
        },
      ],
      total: 1,
    });
    dismissBounce.mockResolvedValue({ email_bounce_dismissed_at: "2026-09-01T13:00:00.000Z" });

    renderPage();
    // Open the log via the tab bar - the banner CTA is unavailable while mount overview is pending.
    fireEvent.click(await screen.findByRole("tab", { name: /Delivery log/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss bounce" }));

    await waitFor(() => {
      expect(fetchEventOverview).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(/emails bounced/i)).toBeNull();

    // Late mount response must not restore the pre-dismiss bounce count.
    resolveMountOverview!({
      email_bounced: 4,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/emails bounced/i)).toBeNull();
  });

  it("resends the bounced row's template and refreshes the bounce count", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 1,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({
      items: [
        {
          id: "dlv-1",
          attendee_id: "att-1",
          attendee_name: "Guest One",
          purpose: "initial",
          status: "bounced",
          provider: "smtp",
          provider_message_id: null,
          attempts: 1,
          retryable: null,
          recipient_email: "guest@example.com",
          rendered_subject: "Your ticket",
          template_id: "tpl-reminder",
          template_name: "reminder",
          queued_at: "2026-09-01T12:00:00.000Z",
          accepted_at: null,
          sent_at: null,
          failed_at: "2026-09-01T12:00:01.000Z",
          error_code: "bounced",
          error: "Mailbox does not exist",
          client_timezone: null,
        },
      ],
      total: 1,
    });
    resendTicket.mockResolvedValue({ id: "dlv-2" });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "View delivery log" }));
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Resend" }));

    await waitFor(() => {
      expect(resendTicket).toHaveBeenCalledWith("evt-1", "att-1", { templateId: "tpl-reminder" });
    });
    expect(await screen.findByText("Resent to Guest One.")).toBeTruthy();
    await waitFor(() => {
      expect(fetchEventOverview).toHaveBeenCalledTimes(2);
    });
  });

  it("resends without a templateId when the bounced row used the built-in default", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 1,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({
      items: [
        {
          id: "dlv-default",
          attendee_id: "att-1",
          attendee_name: "Guest One",
          purpose: "initial",
          status: "bounced",
          provider: "smtp",
          provider_message_id: null,
          attempts: 1,
          retryable: null,
          recipient_email: "guest@example.com",
          rendered_subject: "Your ticket",
          template_id: null,
          template_name: null,
          queued_at: "2026-09-01T12:00:00.000Z",
          accepted_at: null,
          sent_at: null,
          failed_at: "2026-09-01T12:00:01.000Z",
          error_code: "bounced",
          error: "Mailbox does not exist",
          client_timezone: null,
        },
      ],
      total: 1,
    });
    resendTicket.mockResolvedValue({ id: "dlv-3" });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "View delivery log" }));
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Resend" }));

    await waitFor(() => {
      expect(resendTicket).toHaveBeenCalledWith("evt-1", "att-1", { templateId: undefined });
    });
    expect(await screen.findByText("Resent to Guest One.")).toBeTruthy();
  });

  it("ignores AbortError and aborted overview responses without clearing a successful bounce count", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    let resolveOverview: (value: unknown) => void;
    const pendingOverview = new Promise((resolve) => {
      resolveOverview = resolve;
    });
    fetchEventOverview.mockImplementation((_eventId: string, signal?: AbortSignal) => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }
      return pendingOverview;
    });

    const { unmount } = renderPage();
    // Unmount aborts the in-flight overview fetch before it resolves.
    unmount();
    resolveOverview!({
      email_bounced: 9,
      email_failed: 0,
      email_sent: 1,
      email_queued: 0,
    });

    // A fresh mount with a rejected AbortError must not paint a bounce banner from the stale resolve.
    fetchEventOverview.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Send/i })).toBeTruthy();
    });
    expect(screen.queryByText(/emails bounced/i)).toBeNull();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("toasts operator-safe errors when resend or dismiss fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 1,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({
      items: [
        {
          id: "dlv-1",
          attendee_id: "att-1",
          attendee_name: "Guest One",
          purpose: "initial",
          status: "bounced",
          provider: "smtp",
          provider_message_id: null,
          attempts: 1,
          retryable: null,
          recipient_email: "guest@example.com",
          rendered_subject: "Your ticket",
          template_id: "tpl-1",
          template_name: "ticket",
          queued_at: "2026-09-01T12:00:00.000Z",
          accepted_at: null,
          sent_at: null,
          failed_at: "2026-09-01T12:00:01.000Z",
          error_code: "bounced",
          error: "Mailbox does not exist",
          client_timezone: null,
        },
      ],
      total: 1,
    });
    resendTicket.mockRejectedValue(new ApiError(500, "secret_internal"));
    dismissBounce.mockRejectedValue(new ApiError(500, "secret_internal"));

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "View delivery log" }));
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Resend" }));
    expect(await screen.findByText("Resend failed.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss bounce" }));
    expect(await screen.findByText("Failed to dismiss the bounce notice.")).toBeTruthy();
  });

  it("greys out Resend and Dismiss bounce for a row once its dismiss succeeds", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 1,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({
      items: [
        {
          id: "dlv-1",
          attendee_id: "att-1",
          attendee_name: "Guest One",
          purpose: "initial",
          status: "bounced",
          provider: "smtp",
          provider_message_id: null,
          attempts: 1,
          retryable: null,
          recipient_email: "guest@example.com",
          rendered_subject: "Your ticket",
          template_id: null,
          template_name: null,
          queued_at: "2026-09-01T12:00:00.000Z",
          accepted_at: null,
          sent_at: null,
          failed_at: "2026-09-01T12:00:01.000Z",
          error_code: "bounced",
          error: "Mailbox does not exist",
          client_timezone: null,
        },
      ],
      total: 1,
    });
    dismissBounce.mockResolvedValue({ email_bounce_dismissed_at: "2026-09-01T13:00:00.000Z" });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "View delivery log" }));
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss bounce" }));

    await waitFor(() => {
      expect(dismissBounce).toHaveBeenCalledWith("evt-1", "att-1");
    });

    fireEvent.click(screen.getByRole("tab", { name: "Send" }));
    fireEvent.click(screen.getByRole("tab", { name: /Delivery log/i }));
    await screen.findByText("Guest One");

    // Reopen the same row's menu - the row itself still reports status "bounced" forever (it's a
    // historical record), so both actions must stay handled even after leaving the log tab.
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    const resendItem = screen.getByRole("menuitem", { name: "Resend" }) as HTMLButtonElement;
    const dismissItem = screen.getByRole("menuitem", { name: "Dismiss bounce" }) as HTMLButtonElement;
    expect(resendItem.disabled).toBe(true);
    expect(dismissItem.disabled).toBe(true);
  });
});
