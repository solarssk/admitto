// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";

const fetchEventTemplates = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplateById = vi.fn();
const fetchEventOverview = vi.fn();
const fetchEventDeliveries = vi.fn();
const sendEventBulk = vi.fn();
const createEventTemplate = vi.fn();
const deleteEventTemplate = vi.fn();

const reportApiError = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
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
  createEventTemplate: (...args: unknown[]) => createEventTemplate(...args),
  deleteEventTemplate: (...args: unknown[]) => deleteEventTemplate(...args),
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

const reminderRow = {
  id: "tpl-rem",
  name: "reminder",
  label: "Reminder",
  template_format: "mjml" as const,
  subject_template: "Reminder subject",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const announcementRow = {
  id: "tpl-ann",
  name: "announcement",
  label: "Announcement",
  template_format: "mjml" as const,
  subject_template: "Announcement subject",
  updated_at: "2026-01-03T00:00:00.000Z",
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
  fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
    if (id === "tpl-ticket") {
      return {
        ...ticketRow,
        body_template: "<p>Ticket</p>",
        compiled_html_template: "<p>Ticket</p>",
      };
    }
    if (id === "tpl-rem") {
      return {
        ...reminderRow,
        body_template: "<p>Reminder</p>",
        compiled_html_template: "<p>Reminder</p>",
      };
    }
    return {
      ...announcementRow,
      body_template: "<p>Announcement</p>",
      compiled_html_template: "<p>Announcement</p>",
    };
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
    expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();
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
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete Reminder" })).toBeTruthy();
    });
    const ticketDelete = screen.getByRole("button", { name: "Delete Ticket email" });
    expect((ticketDelete as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not refetch legacy template when switching between persisted templates", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fetchEventTemplate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });
    expect(fetchEventTemplate).not.toHaveBeenCalled();
    expect(fetchEventTemplateById).toHaveBeenCalledWith("evt-comm", "tpl-rem");
  });

  it("applies only the latest template selection when fetches resolve out of order", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    let resolveReminder: (value: unknown) => void = () => {};
    const reminderDeferred = new Promise((resolve) => {
      resolveReminder = resolve;
    });

    fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
      if (id === "tpl-rem") {
        await reminderDeferred;
        return {
          ...reminderRow,
          body_template: "<p>Reminder</p>",
          compiled_html_template: "<p>Reminder</p>",
        };
      }
      return {
        ...ticketRow,
        body_template: "<p>Ticket</p>",
        compiled_html_template: "<p>Ticket</p>",
      };
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    fireEvent.click(screen.getByRole("button", { name: "Ticket email" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    resolveReminder({
      ...reminderRow,
      body_template: "<p>Reminder</p>",
      compiled_html_template: "<p>Reminder</p>",
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
      expect(screen.queryByDisplayValue("Reminder subject")).toBeNull();
    });
  });

  it("shows discard confirm when switching templates with dirty form", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited ticket" } });
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
    expect(screen.getByDisplayValue("Edited ticket")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("New template")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });
  });

  it("shows discard confirm before create while dirty", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Dirty draft" } });
    fireEvent.click(screen.getByRole("button", { name: "New" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.getByText("New template")).toBeTruthy();
    });
  });

  it("shows discard confirm before delete while dirty", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Dirty draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Reminder" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
  });

  it("creates a template from the create dialog", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    createEventTemplate.mockResolvedValue({
      id: "tpl-new",
      name: "announcement",
      label: "Announcement",
      template_format: "mjml",
      subject_template: "Announcement",
      body_template: "<mjml></mjml>",
      updated_at: "2026-01-03T00:00:00.000Z",
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "New" }));

    await waitFor(() => {
      expect(screen.getByText("New template")).toBeTruthy();
    });

    const createDialog = screen.getByRole("dialog", { name: "New template" });
    fireEvent.change(within(createDialog).getByLabelText("Template label"), {
      target: { value: "Announcement" },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createEventTemplate).toHaveBeenCalledWith("evt-comm", {
        label: "Announcement",
        template_format: "mjml",
      });
      expect(screen.getByDisplayValue("Announcement")).toBeTruthy();
    });
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
      expect(screen.getByRole("dialog", { name: "Send email" })).toBeTruthy();
    });
    const dialog = screen.getByRole("dialog", { name: "Send email" });
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Send")!,
    );

    await waitFor(() => {
      expect(sendEventBulk).toHaveBeenCalledWith(
        "evt-comm",
        expect.objectContaining({ templateId: "tpl-ticket" }),
      );
      expect(screen.getByText(/No recipients matched/i)).toBeTruthy();
    });
  });

  it("does not switch editor when deleting a non-active template", async () => {
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates
      .mockResolvedValueOnce([ticketRow, reminderRow, announcementRow])
      .mockResolvedValueOnce([ticketRow, reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Announcement" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteEventTemplate).toHaveBeenCalledWith("evt-comm", "tpl-ann");
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });
  });

  it("shows a friendly message when delete is blocked", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow, announcementRow]);
    deleteEventTemplate.mockRejectedValue(new ApiError(422, "template_in_use", "template_in_use"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete Announcement" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Announcement" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(
        screen.getByText("This template already has deliveries and cannot be deleted."),
      ).toBeTruthy();
    });
  });
});
