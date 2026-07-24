// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { formatUtcDateTime } from "../../src/utils/event-dates.js";
import { renderWithToast } from "../test-utils.js";

const fetchEventOverview = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplates = vi.fn();
const fetchEventDeliveries = vi.fn();
const { connectionState, outletContext } = vi.hoisted(() => ({
  connectionState: { reportApiError: vi.fn() },
  outletContext: {
    event: { id: "evt-1", title: "Demo", archived_at: null },
  },
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => connectionState,
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
  fetchEventTemplateById: vi.fn(),
  previewEventTemplate: vi.fn(),
  previewEventTemplateById: vi.fn(),
  saveEventTemplate: vi.fn(),
  saveEventTemplateById: vi.fn(),
  createEventTemplate: vi.fn(),
  deleteEventTemplate: vi.fn(),
  testSendEventTemplate: vi.fn(),
  testSendEventTemplateById: vi.fn(),
  sendEventBulk: vi.fn(),
  fetchBulkSendStatus: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => outletContext,
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

const acceptedRow = {
  id: "dlv-1",
  purpose: "resend",
  status: "accepted",
  recipient_email: "guest@example.com",
  rendered_subject: "Your ticket",
  queued_at: "2026-09-01T12:00:00.000Z",
  accepted_at: "2026-09-01T12:05:00.000Z",
  sent_at: null,
  failed_at: null,
  error_code: null,
};

const failedRow = {
  id: "dlv-2",
  purpose: "initial",
  status: "failed",
  recipient_email: "bounce@example.com",
  rendered_subject: "Your ticket",
  queued_at: "2026-09-01T13:00:00.000Z",
  accepted_at: null,
  sent_at: null,
  failed_at: "2026-09-01T13:05:00.000Z",
  error_code: "smtp_connect",
};

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/communication"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  fetchEventTemplates.mockResolvedValue([]);
});

describe("CommunicationPage delivery log", () => {
  it("shows an accepted SMTP send as Sent with accepted_at in the Sent / Failed column", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 0,
      email_failed: 0,
      email_sent: 1,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow, failedRow], total: 2 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Delivery log/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: /Delivery log/i }));

    await screen.findByText("guest@example.com");
    const table = within(screen.getByRole("table"));
    // Accepted row: green Sent badge, timestamp falls back to accepted_at.
    expect(table.getByText("Sent")).toBeTruthy();
    expect(table.getByText(formatUtcDateTime(acceptedRow.accepted_at))).toBeTruthy();
    // Failed row keeps failed_at and the error code.
    expect(table.getByText("Failed")).toBeTruthy();
    expect(table.getByText(formatUtcDateTime(failedRow.failed_at))).toBeTruthy();
    expect(table.getByText("smtp_connect")).toBeTruthy();
  });

  it("keeps a loading state visible until delivery data resolves", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 0,
      email_failed: 0,
      email_sent: 0,
      email_queued: 0,
    });
    let resolveDeliveries: (value: { items: []; total: number }) => void = () => {};
    fetchEventDeliveries.mockReturnValue(
      new Promise((resolve) => {
        resolveDeliveries = resolve;
      }),
    );

    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Delivery log/i }));

    expect(await screen.findByText("Loading deliveries…")).toBeTruthy();

    resolveDeliveries({ items: [], total: 0 });
    expect(await screen.findByText("No messages sent yet.")).toBeTruthy();
  });

  it("shows the delivery-log error state when loading fails", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 0,
      email_failed: 0,
      email_sent: 0,
      email_queued: 0,
    });
    fetchEventDeliveries.mockRejectedValueOnce(new Error("delivery API unavailable"));

    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Delivery log/i }));

    expect(await screen.findByText("Failed to load deliveries.")).toBeTruthy();
  });

  it("renders explicit fallbacks for delivery rows without recipient or subject", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 0,
      email_failed: 0,
      email_sent: 1,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({
      items: [{ ...acceptedRow, recipient_email: null, rendered_subject: null }],
      total: 1,
    });

    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Delivery log/i }));

    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("—")).toHaveLength(3);
  });

  it("filters the log and resets its page when a filter changes", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 0,
      email_failed: 0,
      email_sent: 60,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 60 });

    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Delivery log/i }));
    await screen.findByText(/Showing 1.*25 of 60/);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2, status: "all", purpose: "all" }),
        expect.any(AbortSignal),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1, status: "all", purpose: "all" }),
        expect.any(AbortSignal),
      );
    });

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "failed" } });
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1, status: "failed", purpose: "all" }),
        expect.any(AbortSignal),
      );
    });

    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "resend" } });
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1, status: "failed", purpose: "resend" }),
        expect.any(AbortSignal),
      );
    });

    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);
  });
});
