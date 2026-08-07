// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { getTooltipText, renderWithToast } from "../test-utils.js";

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
const fetchEventMailSettings = vi.fn();

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
  fetchEventMailSettings: (...args: unknown[]) => fetchEventMailSettings(...args),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
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
    <MemoryRouter initialEntries={["/admin/events/evt-comm/communication?tab=templates"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderPageWithEventSwitch() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-a/communication?tab=templates"]}>
      <Routes>
        <Route
          path="/admin/events/:eventId/communication"
          element={
            <>
              <Link to="/admin/events/evt-b/communication?tab=templates">Switch event</Link>
              <CommunicationPage />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Opens the Templates tab's picker dropdown and selects the option matching `label`. */
async function selectTemplate(label: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Template,/ }));
  fireEvent.click(await screen.findByRole("button", { name: label }));
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
  fetchEventMailSettings.mockResolvedValue({
    fields: { fromName: { value: null }, fromAddress: { value: null } },
  });
  // The Templates tab now auto-previews on a debounce instead of requiring a click - resolve
  // these by default so that isn't a surprise "Preview failed" toast in tests that never cared
  // about preview content (mirrors the same default already used for the Send tab's own
  // auto-preview in every sibling CommunicationPage test file).
  previewEventTemplate.mockResolvedValue({ subject: "", html: "<p></p>" });
  previewEventTemplateById.mockResolvedValue({ subject: "", html: "<p></p>" });
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
      expect(screen.getByText("Ticket email")).toBeTruthy();
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

  it("gives the generic message (not the 403 access one) for a non-403 API error on initial load", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockRejectedValueOnce(new ApiError(500, "internal_error"));
    fetchEventTemplate.mockResolvedValue(legacyTemplate);

    renderPage();

    expect(await screen.findByText("Failed to load template.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);
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
    expect(getTooltipText(optionalChip)).toBe("Attendee's first name.");
    expect(getTooltipText(requiredChip)).toBe(
      "Required placeholder · Link to the attendee's own ticket page.",
    );

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

  it("selects persisted ticket template from the picker", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Template, Ticket email" })).toBeTruthy();
    });
    expect(fetchEventTemplateById).toHaveBeenCalledWith("evt-comm", "tpl-ticket");
  });

  it("disables delete with an explanatory tooltip for the ticket template, enables it once a different template is active", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    const deleteBtn = screen.getByRole("button", { name: "Delete template" }) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
    expect(getTooltipText(deleteBtn)).toBe("The default ticket template can't be deleted.");

    await selectTemplate("Reminder");

    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });
    expect((screen.getByRole("button", { name: "Delete template" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("does not refetch legacy template when switching between persisted templates", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fetchEventTemplate.mockClear();
    await selectTemplate("Reminder");

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
      expect(screen.getByText("Ticket email")).toBeTruthy();
    });

    await selectTemplate("Reminder");

    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fetchEventTemplate.mockClear();
    fetchEventTemplate.mockResolvedValue({
      ...legacyTemplate,
      subject_template: "Updated inherited subject",
    });

    await selectTemplate("Ticket email");

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

    await selectTemplate("Reminder");

    resolveReminder({
      ...reminderRow,
      body_template: "<p>Reminder</p>",
      compiled_html_template: "<p>Reminder</p>",
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: /^Template,/ }));
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
      expect(screen.getByRole("button", { name: "New template" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "New template" }));
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
    fireEvent.click(screen.getByRole("button", { name: /^Template,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
    expect(screen.getByDisplayValue("Edited ticket")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "New template" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Template,/ }));
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
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "New template" })).toBeTruthy();
    });
  });

  it("shows discard confirm before delete while dirty", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    // Delete now only ever targets the currently open template (the mockup's own layout - no
    // more per-row delete in a list) - so testing "dirty + delete" means editing the template
    // you're about to delete, not a bystander one.
    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Dirty draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));

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
      expect(screen.getByRole("button", { name: "New template" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "New template" })).toBeTruthy();
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
      expect(screen.getByRole("button", { name: "New template" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    const createDialog = await screen.findByRole("dialog", { name: "New template" });
    fireEvent.change(within(createDialog).getByLabelText("Template label"), {
      target: { value: "Announcement" },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Request failed/);
    });
  });

  it("updates the preview automatically as the draft changes - no Preview button needed", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    previewEventTemplateById
      .mockResolvedValueOnce({ subject: "Initial subject", html: "<p>Initial</p>" })
      .mockResolvedValueOnce({ subject: "Updated subject", html: "<p>Updated</p>" });

    renderPage();

    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
    expect(await screen.findByText("Initial subject", {}, { timeout: 2000 })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("HTML body"), { target: { value: "<p>New body</p>" } });

    expect(await screen.findByText("Updated subject", {}, { timeout: 2000 })).toBeTruthy();
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
    previewEventTemplateById.mockRejectedValue(new ApiError(500, "secret_internal"));

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByTestId("at-toast").textContent).toMatch(/Request failed/);
      },
      { timeout: 2000 },
    );
  });

  it("switches formats and renders a successful compiled preview", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    previewEventTemplateById.mockResolvedValue({
      subject: "Preview subject",
      html: "<p>Rendered preview</p>",
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("radio", { name: "MJML" }));
    fireEvent.click(await screen.findByRole("button", { name: "Switch format" }));
    expect(screen.getByLabelText("MJML body")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "HTML" }));
    fireEvent.click(await screen.findByRole("button", { name: "Switch format" }));
    expect(screen.getByLabelText("HTML body")).toBeTruthy();

    expect(await screen.findByText("Preview subject", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByTitle("Email preview").getAttribute("srcdoc")).toBe("<p>Rendered preview</p>");
  });

  it("keeps the format unchanged when the switch-format confirmation is cancelled", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);

    renderPage();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("radio", { name: "MJML" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("HTML body")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch format" })).toBeNull();
  });

  it("switches format without confirmation when the body is empty", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    fetchEventTemplateById.mockResolvedValue({
      ...ticketRow,
      subject_template: "",
      body_template: "",
      compiled_html_template: "",
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("radio", { name: "MJML" }));
    expect(screen.getByLabelText("MJML body")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch format" })).toBeNull();
  });

  it("renders inline validation errors returned by preview", async () => {
    const { TemplateValidationError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    previewEventTemplateById.mockRejectedValue(
      new TemplateValidationError(["Subject must include {{ticket_url}}"]),
    );

    renderPage();

    expect(
      await screen.findByText("Subject must include {{ticket_url}}", {}, { timeout: 2000 }),
    ).toBeTruthy();
  });

  it("toasts operator-safe template switch failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    fetchEventTemplateById.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    fireEvent.click(screen.getByRole("button", { name: /^Template,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reminder" }));
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
      expect(screen.getByLabelText("Recipient")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Recipient"), {
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
    const email = await screen.findByLabelText("Recipient");
    fireEvent.change(email, { target: { value: "ops@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Test email sent.")).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("mail-preview--ok");

    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Mailbox unavailable")).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("mail-preview--error");
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
    await selectTemplate("Reminder");
    expect(await screen.findByDisplayValue("Reminder subject")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
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

    expect(await screen.findByText("Ticket email")).toBeTruthy();
    await selectTemplate("Reminder");
    expect(await screen.findByDisplayValue("Reminder subject")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchEventTemplate).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Ticket email")).toBeTruthy();
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

    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteEventTemplate).toHaveBeenCalledWith("evt-comm", "tpl-rem");
      expect(
        screen.getByText("Template deleted. Could not load ticket template. Reload the page."),
      ).toBeTruthy();
      expect(screen.queryByDisplayValue("Reminder subject")).toBeNull();
      expect(screen.getByRole("button", { name: "Template, Ticket email" })).toBeTruthy();
      expect(screen.getByLabelText("Subject")).toHaveProperty("value", "");
      expect(screen.getByLabelText("Subject")).toHaveProperty("disabled", true);
      expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();
      expect(screen.getByRole("button", { name: "Saved" })).toHaveProperty("disabled", true);
      expect(reportApiError).toHaveBeenCalledWith(500);
    });

    fireEvent.click(screen.getByRole("button", { name: /^Template,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ticket email" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
      expect(screen.getByLabelText("Subject")).toHaveProperty("disabled", false);
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

    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toHaveProperty("disabled", true);
    });

    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "New template" })).toBeTruthy();
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
      expect(screen.getByText("Ticket email")).toBeTruthy();
    });

    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteEventTemplate).toHaveBeenCalledWith("evt-comm", "tpl-rem");
      expect(screen.getByText("Ticket email")).toBeTruthy();
      expect(screen.getByDisplayValue("Hello")).toBeTruthy();
      expect(
        screen.getByText(
          "Template deleted. Inherited ticket could not be refreshed. Showing last known copy.",
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
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    await selectTemplate("Announcement");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Announcement subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
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
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    await selectTemplate("Announcement");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Announcement subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
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
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    await waitFor(() => {
      expect(screen.getByText("Delete template?")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New template" })).toHaveProperty("disabled", true);
    });

    fireEvent.click(screen.getByRole("link", { name: "Switch event" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New template" })).toHaveProperty("disabled", false);
      expect(screen.queryByText("Delete template?")).toBeNull();
    });
  });
});
