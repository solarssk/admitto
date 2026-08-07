// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import { getTooltipText, renderWithToast } from "../test-utils.js";

const fetchEventTemplates = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplateById = vi.fn();
const fetchEventOverview = vi.fn();
const fetchEventDeliveries = vi.fn();

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
  createEventTemplate: vi.fn(),
  deleteEventTemplate: vi.fn(),
  testSendEventTemplate: vi.fn(),
  testSendEventTemplateById: vi.fn(),
  sendEventBulk: vi.fn(),
  fetchBulkSendStatus: vi.fn(),
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
}));

const blockerState = {
  state: "unblocked" as "unblocked" | "blocked",
  proceed: vi.fn(),
  reset: vi.fn(),
};

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => blockerState,
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: "2026-01-01T00:00:00.000Z" },
    }),
  };
});

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

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/communication?tab=templates"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
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
  fetchEventDeliveries.mockResolvedValue({ items: [], total: 0 });
  fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
  fetchEventTemplate.mockResolvedValue(legacyTemplate);
  fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
    if (id === "tpl-rem") {
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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function expectArchivedLock(control: HTMLElement) {
  expect((control as HTMLButtonElement).disabled).toBe(true);
  const describedBy = control.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  const description = document.getElementById(describedBy!);
  expect(description?.textContent).toBe(ARCHIVED_ACTION_TOOLTIP);
  expect(getTooltipText(control)).toBe(ARCHIVED_ACTION_TOOLTIP);
}

describe("CommunicationPage archived lockdown", () => {
  it("disables send email, new/delete template, preview, save, send test, and the editor fieldset", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
    });

    expectArchivedLock(screen.getByRole("button", { name: "New" }));
    expectArchivedLock(screen.getByRole("button", { name: "Delete Reminder" }));
    expectArchivedLock(screen.getByRole("button", { name: "Preview" }));

    // Save is already disabled while the form isn't dirty (editing is impossible
    // anyway since the fieldset below is disabled) — confirm it stays blocked.
    expect((screen.getByRole("button", { name: "Saved" }) as HTMLButtonElement).disabled).toBe(true);

    // Give "Send test" a valid recipient (that field isn't part of the disabled
    // fieldset) to isolate the archived lock from the unrelated "invalid email" disable.
    fireEvent.change(screen.getByLabelText("Recipient email"), {
      target: { value: "test@example.com" },
    });
    expectArchivedLock(screen.getByRole("button", { name: "Send test" }));

    const subjectInput = screen.getByLabelText("Subject");
    const editorFieldset = subjectInput.closest("fieldset");
    expect(editorFieldset?.disabled).toBe(true);
    expect(getTooltipText(editorFieldset as HTMLElement)).toBe(ARCHIVED_ACTION_TOOLTIP);

    // Inserting a placeholder or switching MJML/HTML only touches local component
    // state — no API call — so these stay usable even though Save is blocked.
    expect(
      (screen.getByRole("button", { name: "{{first_name}}" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole("button", { name: "MJML" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole("button", { name: "HTML" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables the Send button on the Send tab, but not Count recipients", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    });
    expectArchivedLock(screen.getByRole("button", { name: "Send" }));
    expect(
      (screen.getByRole("button", { name: "Count recipients" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
