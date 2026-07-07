// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { formatUtcDateTime } from "../../src/utils/event-dates.js";
import { renderWithToast } from "../test-utils.js";

const fetchEventOverview = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplates = vi.fn();
const fetchEventDeliveries = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
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

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
  };
});

const templatePayload = {
  source: "event" as const,
  allowed_placeholders: ["first_name"],
  required_url_placeholders: [],
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

    await waitFor(() => expect(screen.getByText("guest@example.com")).toBeTruthy());
    const table = within(screen.getByRole("table"));
    // Accepted row: green Sent badge, timestamp falls back to accepted_at.
    expect(table.getByText("Sent")).toBeTruthy();
    expect(table.getByText(formatUtcDateTime(acceptedRow.accepted_at))).toBeTruthy();
    // Failed row keeps failed_at and the error code.
    expect(table.getByText("Failed")).toBeTruthy();
    expect(table.getByText(formatUtcDateTime(failedRow.failed_at))).toBeTruthy();
    expect(table.getByText("smtp_connect")).toBeTruthy();
  });
});
