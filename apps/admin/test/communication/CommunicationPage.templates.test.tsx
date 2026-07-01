// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";

const fetchEventTemplates = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplateById = vi.fn();
const fetchEventOverview = vi.fn();
const fetchEventDeliveries = vi.fn();
const sendEventBulk = vi.fn();

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
  fetchEventTemplates: (...args: unknown[]) => fetchEventTemplates(...args),
  fetchEventTemplate: (...args: unknown[]) => fetchEventTemplate(...args),
  fetchEventTemplateById: (...args: unknown[]) => fetchEventTemplateById(...args),
  fetchEventOverview: (...args: unknown[]) => fetchEventOverview(...args),
  fetchEventDeliveries: (...args: unknown[]) => fetchEventDeliveries(...args),
  previewEventTemplate: vi.fn(),
  previewEventTemplateById: vi.fn(),
  saveEventTemplate: vi.fn(),
  saveEventTemplateById: vi.fn(),
  createEventTemplate: vi.fn(),
  deleteEventTemplate: vi.fn(),
  testSendEventTemplate: vi.fn(),
  testSendEventTemplateById: vi.fn(),
  sendEventBulk: (...args: unknown[]) => sendEventBulk(...args),
  fetchBulkSendStatus: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
  };
});

const legacyTemplate = {
  source: "builtin" as const,
  allowed_placeholders: ["first_name"],
  required_url_placeholders: [],
  subject_template: "Hello",
  body_template: "<p>Hi</p>",
  template_format: "html" as const,
};

const ticketRow = {
  id: "tpl-ticket",
  name: "ticket",
  label: "Ticket email",
  template_format: "html" as const,
  subject_template: "Ticket",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/events/evt-comm/communication"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchEventOverview.mockResolvedValue({
    email_bounced: 0,
    email_failed: 0,
    email_sent: 0,
    email_queued: 0,
  });
  fetchEventTemplate.mockResolvedValue(legacyTemplate);
  fetchEventTemplateById.mockResolvedValue({
    ...ticketRow,
    body_template: "<p>Ticket</p>",
    compiled_html_template: "<p>Ticket</p>",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CommunicationPage templates", () => {
  it("lists templates and shows inherited ticket row when ticket is missing", async () => {
    fetchEventTemplates.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ticket email (inherited)")).toBeTruthy();
    });
  });

  it("selects persisted ticket template from list", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ticket email" })).toBeTruthy();
    });
    expect(fetchEventTemplateById).toHaveBeenCalledWith("evt-comm", "tpl-ticket");
  });

  it("disables delete for ticket template", async () => {
    fetchEventTemplates.mockResolvedValue([
      ticketRow,
      {
        id: "tpl-rem",
        name: "reminder",
        label: "Reminder",
        template_format: "mjml",
        subject_template: "Reminder",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete Reminder" })).toBeTruthy();
    });
    const ticketDelete = screen.getByRole("button", { name: "Delete Ticket email" });
    expect((ticketDelete as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports no recipients when batchId is null", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    sendEventBulk.mockResolvedValue({ batchId: null, queued: 0, skipped: 0, failed: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send email" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Send")!,
    );

    await waitFor(() => {
      expect(sendEventBulk).toHaveBeenCalledWith(
        "evt-comm",
        expect.objectContaining({ templateId: "tpl-ticket" }),
      );
    });
  });
});
