// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { renderWithToast } from "../test-utils.js";

const fetchEventTemplates = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplateById = vi.fn();
const fetchEventOverview = vi.fn();
const fetchEventDeliveries = vi.fn();
const sendEventBulk = vi.fn();
const createEventTemplate = vi.fn();
const deleteEventTemplate = vi.fn();
const previewEventTemplate = vi.fn();
const previewEventTemplateById = vi.fn();
const saveEventTemplateById = vi.fn();
const testSendEventTemplateById = vi.fn();
const fetchTicketTypes = vi.fn();

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
  TemplateValidationError: class TemplateValidationError extends Error {
    errors: string[];
    constructor(errors: string[] = []) {
      super("Template validation failed");
      this.errors = errors;
    }
  },
  fetchEventTemplates: (...args: unknown[]) => fetchEventTemplates(...args),
  fetchEventTemplate: (...args: unknown[]) => fetchEventTemplate(...args),
  fetchEventTemplateById: (...args: unknown[]) => fetchEventTemplateById(...args),
  fetchEventOverview: (...args: unknown[]) => fetchEventOverview(...args),
  fetchEventDeliveries: (...args: unknown[]) => fetchEventDeliveries(...args),
  previewEventTemplate: (...args: unknown[]) => previewEventTemplate(...args),
  previewEventTemplateById: (...args: unknown[]) => previewEventTemplateById(...args),
  saveEventTemplate: vi.fn(),
  saveEventTemplateById: (...args: unknown[]) => saveEventTemplateById(...args),
  createEventTemplate: (...args: unknown[]) => createEventTemplate(...args),
  deleteEventTemplate: (...args: unknown[]) => deleteEventTemplate(...args),
  testSendEventTemplate: vi.fn(),
  testSendEventTemplateById: (...args: unknown[]) => testSendEventTemplateById(...args),
  sendEventBulk: (...args: unknown[]) => sendEventBulk(...args),
  fetchBulkSendStatus: vi.fn(),
  fetchTicketTypes: (...args: unknown[]) => fetchTicketTypes(...args),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useBlocker: () => blockerState,
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: null },
    }),
  };
});

const blockerState = {
  state: "unblocked" as "unblocked" | "blocked",
  proceed: vi.fn(),
  reset: vi.fn(),
};

const legacyTemplate = {
  source: "builtin" as const,
  allowed_placeholders: ["first_name"],
  required_url_placeholders: [],
  image_placeholders: [],
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
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-comm/communication"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderPageWithEventSwitch() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-a/communication"]}>
      <Routes>
        <Route
          path="/admin/events/:eventId/communication"
          element={
            <>
              <Link to="/admin/events/evt-b/communication">Switch event</Link>
              <CommunicationPage />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  blockerState.state = "unblocked";
  blockerState.proceed.mockClear();
  blockerState.reset.mockClear();
  fetchEventOverview.mockResolvedValue({
    email_bounced: 0,
    email_failed: 0,
    email_sent: 0,
    email_queued: 0,
  });
  fetchEventTemplate.mockResolvedValue(legacyTemplate);
  fetchTicketTypes.mockResolvedValue([]);
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
  fetchEventTemplates.mockReset();
  fetchEventTemplate.mockReset();
  fetchEventTemplateById.mockReset();
  deleteEventTemplate.mockReset();
  createEventTemplate.mockReset();
  previewEventTemplate.mockReset();
  previewEventTemplateById.mockReset();
  saveEventTemplateById.mockReset();
  testSendEventTemplateById.mockReset();
  vi.useRealTimers();
});

describe("CommunicationPage delayed loading", () => {
  it("shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    fetchEventTemplates.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading communication…")).toBeTruthy();
  });
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

  it("shows a safe initial-load error when template loading fails outside the API layer", async () => {
    fetchEventTemplates.mockRejectedValueOnce(new Error("network unavailable"));
    fetchEventTemplate.mockResolvedValue(legacyTemplate);

    renderPage();

    expect(await screen.findByText("Failed to load template.")).toBeTruthy();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("reports the API status and gives an event-access error for a forbidden initial load", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockRejectedValueOnce(new ApiError(403, "not_for_operator"));
    fetchEventTemplate.mockResolvedValue(legacyTemplate);

    renderPage();

    expect(await screen.findByText("You do not have access to this event.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("redirects to login when the initial template load returns 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/events/evt-comm/communication", assign: assignSpy },
    });
    try {
      renderPage();
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(
          "/login?next=%2Fadmin%2Fevents%2Fevt-comm%2Fcommunication",
        ),
      );
      expect(reportApiError).toHaveBeenCalledWith(401);
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("marks only required placeholders and lets the operator focus/click/type into Subject and Body", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    fetchEventTemplate.mockResolvedValueOnce({
      ...legacyTemplate,
      allowed_placeholders: ["first_name", "ticket_url"],
      required_url_placeholders: ["ticket_url"],
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });

    const optionalChip = screen.getByRole("button", { name: "{{first_name}}" });
    const requiredChip = screen.getByRole("button", { name: "{{ticket_url}}" });
    expect(optionalChip.getAttribute("title")).toBeNull();
    expect(requiredChip.getAttribute("title")).toBe("Required placeholder");

    const subjectInput = screen.getByLabelText("Subject");
    fireEvent.focus(subjectInput);
    fireEvent.click(subjectInput);
    fireEvent.change(subjectInput, { target: { value: "New subject" } });
    expect(subjectInput).toHaveProperty("value", "New subject");

    const bodyTextarea = screen.getByLabelText("HTML body");
    fireEvent.focus(bodyTextarea);
    fireEvent.change(bodyTextarea, { target: { value: "<p>New body</p>" } });
    expect(bodyTextarea).toHaveProperty("value", "<p>New body</p>");
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

  it("refetches inherited ticket template when re-selecting virtual-ticket", async () => {
    fetchEventTemplates.mockResolvedValue([reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ticket email (inherited)")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fetchEventTemplate.mockClear();
    fetchEventTemplate.mockResolvedValue({
      ...legacyTemplate,
      subject_template: "Updated inherited subject",
    });

    fireEvent.click(screen.getByRole("button", { name: "Ticket email (inherited)" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Updated inherited subject")).toBeTruthy();
    });
    expect(fetchEventTemplate).toHaveBeenCalledWith("evt-comm");
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
      const active = document.querySelector(".communication-templates__item--active");
      expect(active?.textContent).toContain("Ticket email");
    });

    resolveReminder({
      ...reminderRow,
      body_template: "<p>Reminder</p>",
      compiled_html_template: "<p>Reminder</p>",
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
      expect(screen.queryByDisplayValue("Reminder subject")).toBeNull();
      const active = document.querySelector(".communication-templates__item--active");
      expect(active?.textContent).toContain("Ticket email");
    });
  });

  it("suppresses route discard dialog while in-page dirty confirm is open", async () => {
    blockerState.state = "blocked";
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited ticket" } });
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
    expect(screen.queryByText("They will be lost if you leave this page")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("prevents duplicate create submissions while the first request is in flight", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    createEventTemplate.mockImplementation(() => new Promise(() => {}));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    const dialog = screen.getByRole("dialog", { name: "New template" });
    const input = within(dialog).getByLabelText("Template label");
    fireEvent.change(input, { target: { value: "Announcement" } });

    const createBtn = within(dialog).getByRole("button", { name: "Create" });
    fireEvent.click(createBtn);
    fireEvent.click(createBtn);

    expect(createEventTemplate).toHaveBeenCalledTimes(1);
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

  it("toasts operator-safe message when create template fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    createEventTemplate.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    const createDialog = await screen.findByRole("dialog", { name: "New template" });
    fireEvent.change(within(createDialog).getByLabelText("Template label"), {
      target: { value: "Announcement" },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Request failed/);
    });
  });

  it("toasts operator-safe preview failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    fetchEventTemplateById.mockResolvedValue({
      source: "custom" as const,
      allowed_placeholders: ["first_name"],
      required_url_placeholders: [],
      image_placeholders: [],
      subject_template: "Ticket",
      body_template: "<mjml></mjml>",
      template_format: "mjml" as const,
    });
    previewEventTemplateById.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Request failed/);
    });
  });

  it("switches formats and renders a successful compiled preview", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    previewEventTemplateById.mockResolvedValue({
      subject: "Preview subject",
      html: "<p>Rendered preview</p>",
    });

    renderPage();
    await screen.findByRole("button", { name: "Preview" });

    fireEvent.click(screen.getByRole("button", { name: "MJML" }));
    expect(screen.getByLabelText("MJML body")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    expect(screen.getByLabelText("HTML body")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Preview subject")).toBeTruthy();
    expect(screen.getByTitle("Email preview").getAttribute("srcdoc")).toBe("<p>Rendered preview</p>");
  });

  it("renders inline validation errors returned by preview", async () => {
    const { TemplateValidationError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    previewEventTemplateById.mockRejectedValueOnce(
      new TemplateValidationError(["Subject must include {{ticket_url}}"]),
    );

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));

    expect(await screen.findByText("Subject must include {{ticket_url}}")).toBeTruthy();
  });

  it("toasts operator-safe template switch failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reminder" })).toBeTruthy();
    });
    fetchEventTemplateById.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Request failed/);
    });
  });

  it("toasts operator-safe save failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Updated ticket subject" } });
    saveEventTemplateById.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Request failed/);
    });
  });

  it("shows validation message on invalid test send email", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Recipient email")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Recipient email"), {
      target: { value: "ops@example.com" },
    });
    testSendEventTemplateById.mockRejectedValueOnce(
      new ApiError(400, "validation_failed", "validation_failed"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/valid email address/);
    });
  });

  it("renders both successful and rejected test-send outcomes", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    testSendEventTemplateById
      .mockResolvedValueOnce({ status: "sent" })
      .mockResolvedValueOnce({ status: "failed", error: "Mailbox unavailable" });

    renderPage();
    const email = await screen.findByLabelText("Recipient email");
    fireEvent.change(email, { target: { value: "ops@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Test email sent.")).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("communication-status--ok");

    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Mailbox unavailable")).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("communication-status--error");
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

  it("shows an inline retryable error under the ticket-type filter when the catalog fails to load (CodeRabbit review)", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    fetchTicketTypes.mockRejectedValueOnce(new Error("network down"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send email" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    const dialog = await screen.findByRole("dialog", { name: "Send email" });

    fireEvent.change(within(dialog).getByLabelText("Recipients"), {
      target: { value: "ticket_type" },
    });

    expect(await within(dialog).findByText("Failed to load ticket types.")).toBeTruthy();

    fetchTicketTypes.mockResolvedValueOnce([{ key: "vip", label: "VIP", color: "purple" }]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(within(dialog).queryByText("Failed to load ticket types.")).toBeNull());
    expect(within(dialog).getByText("VIP")).toBeTruthy();
  });

  it("sends by ticket type, populating the Select from the catalog and using the picked key as the filter value (batch 04 / #351)", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    fetchTicketTypes.mockResolvedValue([{ key: "vip", label: "VIP", color: "purple" }]);
    sendEventBulk.mockResolvedValue({ batchId: "batch-vip", queued: 1, skipped: 0, failed: 0 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send email" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    const dialog = await screen.findByRole("dialog", { name: "Send email" });

    fireEvent.change(within(dialog).getByLabelText("Recipients"), {
      target: { value: "ticket_type" },
    });
    expect(await within(dialog).findByRole("option", { name: "VIP" })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Ticket type"), { target: { value: "vip" } });

    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Send")!,
    );

    await waitFor(() => {
      expect(sendEventBulk).toHaveBeenCalledWith(
        "evt-comm",
        expect.objectContaining({
          templateId: "tpl-ticket",
          filter: { type: "ticket_type", value: "vip" },
        }),
      );
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

  it("loads the remaining ticket template after deleting the active non-ticket template", async () => {
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates
      .mockResolvedValueOnce([ticketRow, reminderRow])
      .mockResolvedValueOnce([ticketRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    expect(await screen.findByDisplayValue("Reminder subject")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Reminder" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteEventTemplate).toHaveBeenCalledWith("evt-comm", "tpl-rem");
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
      expect(fetchEventTemplateById).toHaveBeenLastCalledWith("evt-comm", "tpl-ticket");
    });
  });

  it("refetches the inherited ticket after deleting the last explicit template", async () => {
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates.mockResolvedValueOnce([reminderRow]).mockResolvedValueOnce([]);

    renderPage();

    expect(await screen.findByRole("button", { name: "Ticket email (inherited)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    expect(await screen.findByDisplayValue("Reminder subject")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Reminder" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchEventTemplate).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Ticket email (inherited)")).toBeTruthy();
      expect(screen.getByDisplayValue("Hello")).toBeTruthy();
    });
  });

  it("does not activate ticket without loading its draft after delete refresh fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    let ticketLoadsAfterMount = 0;
    fetchEventTemplates
      .mockResolvedValueOnce([ticketRow, reminderRow])
      .mockResolvedValueOnce([ticketRow]);
    fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
      if (id === "tpl-ticket") {
        ticketLoadsAfterMount += 1;
        if (ticketLoadsAfterMount === 2 || ticketLoadsAfterMount === 3) {
          throw new ApiError(500, "server_error");
        }
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
      throw new Error(`unexpected template id ${id}`);
    });
    deleteEventTemplate.mockResolvedValue(undefined);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Reminder" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteEventTemplate).toHaveBeenCalledWith("evt-comm", "tpl-rem");
      expect(
        screen.getByText("Template deleted. Could not load ticket template — reload the page."),
      ).toBeTruthy();
      expect(screen.queryByDisplayValue("Reminder subject")).toBeNull();
      expect(screen.getByRole("button", { name: "Ticket email" })).toBeTruthy();
      expect(screen.getByLabelText("Subject")).toHaveProperty("value", "");
      expect(screen.getByLabelText("Subject")).toHaveProperty("disabled", true);
      expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();
      expect(screen.getByRole("button", { name: "Preview" })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: "Saved" })).toHaveProperty("disabled", true);
      expect(reportApiError).toHaveBeenCalledWith(500);
    });

    fireEvent.click(screen.getByRole("button", { name: "Ticket email" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
      expect(screen.getByLabelText("Subject")).toHaveProperty("disabled", false);
      expect(screen.getByRole("button", { name: "Preview" })).toHaveProperty("disabled", false);
      expect(screen.getByRole("button", { name: "Send email" })).toBeTruthy();
    });
  });

  it("clears missing snapshot when creating a template after delete fallback fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    let ticketLoadsAfterMount = 0;
    fetchEventTemplates
      .mockResolvedValueOnce([ticketRow, reminderRow])
      .mockResolvedValueOnce([ticketRow]);
    fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
      if (id === "tpl-ticket") {
        ticketLoadsAfterMount += 1;
        if (ticketLoadsAfterMount === 2 || ticketLoadsAfterMount === 3) {
          throw new ApiError(500, "server_error");
        }
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
      throw new Error(`unexpected template id ${id}`);
    });
    deleteEventTemplate.mockResolvedValue(undefined);
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
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Reminder" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toHaveProperty("disabled", true);
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
      expect(createEventTemplate).toHaveBeenCalled();
      expect(screen.getByDisplayValue("Announcement")).toBeTruthy();
      expect(screen.getByLabelText("Subject")).toHaveProperty("disabled", false);
      expect(screen.getByRole("button", { name: "Preview" })).toHaveProperty("disabled", false);
      expect(screen.getByRole("button", { name: "Send email" })).toBeTruthy();
    });
  });

  it("falls back to cached inherited ticket when post-delete refresh fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates
      .mockResolvedValueOnce([reminderRow])
      .mockResolvedValueOnce([]);
    fetchEventTemplate
      .mockResolvedValueOnce(legacyTemplate)
      .mockRejectedValueOnce(new ApiError(500, "server_error"));
    deleteEventTemplate.mockResolvedValue(undefined);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ticket email (inherited)")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Reminder" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteEventTemplate).toHaveBeenCalledWith("evt-comm", "tpl-rem");
      expect(screen.getByText("Ticket email (inherited)")).toBeTruthy();
      expect(screen.getByDisplayValue("Hello")).toBeTruthy();
      expect(
        screen.getByText(
          "Template deleted. Inherited ticket could not be refreshed — showing last known copy.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText("Delete failed.")).toBeNull();
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

  it("shows a generic delete failure for unmapped backend codes", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow, announcementRow]);
    deleteEventTemplate.mockRejectedValue(new ApiError(422, "some_new_code", "some_new_code"));

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
      expect(screen.getByText("Delete failed.")).toBeTruthy();
      expect(screen.queryByText("some_new_code")).toBeNull();
    });
  });

  it("clears delete busy state when navigating away during in-flight delete", async () => {
    fetchEventTemplates.mockImplementation(async (id: string) => {
      if (id === "evt-a") return [ticketRow, reminderRow];
      return [ticketRow];
    });
    deleteEventTemplate.mockImplementation(() => new Promise<void>(() => {}));

    renderPageWithEventSwitch();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete Reminder" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Reminder" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New" })).toHaveProperty("disabled", true);
    });

    fireEvent.click(screen.getByRole("link", { name: "Switch event" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New" })).toHaveProperty("disabled", false);
      expect(screen.queryByText("Delete template?")).toBeNull();
    });
  });
});
