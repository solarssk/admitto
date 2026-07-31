// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { formatUtcDateTime } from "../../src/utils/event-dates.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import type { DeliveryDetailDto, DeliveryDto } from "../../src/api/types.js";

const fetchEventOverview = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplates = vi.fn();
const fetchEventDeliveries = vi.fn();
const fetchEventDelivery = vi.fn();
const fetchRenderedDelivery = vi.fn();
const exportDeliveryLog = vi.fn();
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
  fetchEventDelivery: (...args: unknown[]) => fetchEventDelivery(...args),
  fetchRenderedDelivery: (...args: unknown[]) => fetchRenderedDelivery(...args),
  exportDeliveryLog: (...args: unknown[]) => exportDeliveryLog(...args),
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

const acceptedRow: DeliveryDto = {
  id: "dlv-1",
  attendee_id: "att-1",
  attendee_name: "Guest One",
  purpose: "resend",
  status: "accepted",
  provider: "smtp",
  provider_message_id: "msg-1",
  attempts: 1,
  retryable: null,
  recipient_email: "guest@example.com",
  rendered_subject: "Your ticket",
  template_id: null,
  template_name: null,
  queued_at: "2026-09-01T11:55:00.000Z",
  accepted_at: "2026-09-01T12:05:00.000Z",
  sent_at: null,
  failed_at: null,
  error_code: null,
  error: null,
  client_timezone: null,
};

const failedRow: DeliveryDto = {
  id: "dlv-2",
  attendee_id: "att-2",
  attendee_name: "Guest Two",
  purpose: "initial",
  status: "failed",
  provider: "smtp",
  provider_message_id: null,
  attempts: 3,
  retryable: true,
  recipient_email: "bounce@example.com",
  rendered_subject: "Your ticket",
  template_id: null,
  template_name: null,
  queued_at: "2026-09-01T13:00:00.000Z",
  accepted_at: null,
  sent_at: null,
  failed_at: "2026-09-01T13:05:00.000Z",
  error_code: "smtp_connect",
  error: "Connection timed out",
  client_timezone: "Europe/Warsaw",
};

/** Same data as `failedRow` but explicitly a resend - the "current" row viewed in the Delivery
 * Details/Export tests below. timelineStepLabel numbers "Resend N" by counting sibling rows
 * with `purpose === "resend"` up to that point, so the current row must actually be one for the
 * timeline to read "Resend 1" instead of "Resend 0". */
const failedResendRow: DeliveryDto = { ...failedRow, purpose: "resend" };

/** Two real EmailDelivery rows for the same attendee (initial send + a later resend) - the
 * honest, migration-free "Delivery Timeline" source described in plan.md. `failedResendRow` is
 * the one the test opens the modal from (the "current" row, highlighted in the timeline). */
function detailFixture(): DeliveryDetailDto {
  const initial: DeliveryDto = {
    ...acceptedRow,
    id: "dlv-2-initial",
    attendee_id: failedResendRow.attendee_id,
    attendee_name: failedResendRow.attendee_name,
    purpose: "initial",
    status: "sent",
    sent_at: "2026-09-01T09:00:00.000Z",
    accepted_at: null,
  };
  return {
    ...failedResendRow,
    batch_id: "batch-9",
    actor_user_id: "user-1",
    actor_display: "Admin User",
    session_id: "sess-9",
    timeline: [initial, failedResendRow],
  };
}

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/communication"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function goToDeliveryLogTab() {
  fireEvent.click(await screen.findByRole("tab", { name: /Delivery log/i }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchEventTemplates.mockResolvedValue([]);
  fetchEventTemplate.mockResolvedValue(templatePayload);
  fetchEventOverview.mockResolvedValue({
    email_bounced: 0,
    email_failed: 0,
    email_sent: 0,
    email_queued: 0,
  });
  mockMatchMedia(true);
});

describe("CommunicationPage delivery log - table", () => {
  it("renders enriched rows: recipient, template fallback, purpose, status badge, and timestamp", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow, failedRow], total: 2 });

    renderPage();
    await goToDeliveryLogTab();

    await screen.findByText("guest@example.com");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Guest One")).toBeTruthy();
    expect(table.getByText("Guest Two")).toBeTruthy();
    // Both rows use the built-in template (template_name null) - "Default ticket", not "-".
    expect(table.getAllByText("Default ticket")).toHaveLength(2);
    expect(table.getByText("Resend")).toBeTruthy();
    expect(table.getByText("Initial")).toBeTruthy();
    // Accepted row: green "Sent" badge (ADR 0007), timestamp falls back to accepted_at.
    expect(table.getByText("Sent")).toBeTruthy();
    expect(table.getByText(formatUtcDateTime(acceptedRow.accepted_at!))).toBeTruthy();
    // Failed row keeps failed_at and the raw error code shows only in the details modal, not the table.
    expect(table.getByText("Failed")).toBeTruthy();
    expect(table.getByText(formatUtcDateTime(failedRow.failed_at!))).toBeTruthy();
  });

  it("keeps a loading state visible until delivery data resolves", async () => {
    let resolveDeliveries: (value: { items: []; total: number }) => void = () => {};
    fetchEventDeliveries.mockReturnValue(
      new Promise((resolve) => {
        resolveDeliveries = resolve;
      }),
    );

    renderPage();
    await goToDeliveryLogTab();

    expect(await screen.findByText("Loading deliveries…")).toBeTruthy();

    resolveDeliveries({ items: [], total: 0 });
    expect(await screen.findByText("No messages sent yet")).toBeTruthy();
  });

  it("shows the delivery-log error state when loading fails", async () => {
    fetchEventDeliveries.mockRejectedValueOnce(new Error("delivery API unavailable"));

    renderPage();
    await goToDeliveryLogTab();

    expect(await screen.findByText("Failed to load deliveries.")).toBeTruthy();
  });

  it("shows a dash for a missing recipient email, distinct from the default-template label", async () => {
    fetchEventDeliveries.mockResolvedValue({
      items: [{ ...acceptedRow, recipient_email: null, template_name: null }],
      total: 1,
    });

    renderPage();
    await goToDeliveryLogTab();

    const table = within(await screen.findByRole("table"));
    expect(table.getAllByText("-")).toHaveLength(1);
    expect(table.getByText("Default ticket")).toBeTruthy();
  });
});

describe("CommunicationPage delivery log - filters, search, pagination", () => {
  it("pages via Previous/Next and resets to page 1 when Status/Purpose/Template change", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 60 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText(/Showing 1.*25 of 60/);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2, status: "all", purpose: "all", templateId: "all" }),
        expect.any(AbortSignal),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1 }),
        expect.any(AbortSignal),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
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

    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "default" } });
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({
          page: 1,
          status: "failed",
          purpose: "resend",
          templateId: "default",
        }),
        expect.any(AbortSignal),
      );
    });

    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);
  });

  it("debounces the search box, resets to page 1, and clears via the clear button", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");
    fetchEventDeliveries.mockClear();

    const search = screen.getByRole("textbox", { name: "Search recipient by name or email" });
    fireEvent.change(search, { target: { value: "guest" } });

    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1, search: "guest" }),
        expect.any(AbortSignal),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveProperty("value", "");
  });
});

describe("CommunicationPage delivery log - row menu", () => {
  it("opens with three actions, and Open attendee links to the attendee page", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "View sent message",
      "View delivery details",
      "Open attendee",
    ]);
    expect(
      within(menu).getByRole("menuitem", { name: "Open attendee" }).getAttribute("href"),
    ).toBe("/admin/events/evt-1/attendees/att-1");
  });
});

describe("CommunicationPage delivery log - sent message preview modal", () => {
  it("fetches and renders the redacted message, with the privacy notice and sandboxed iframe", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    fetchRenderedDelivery.mockResolvedValue({
      subject: "Your ticket for Test Event",
      html: '<p>Hi</p><img src="data:image/svg+xml;base64,QUJD" alt="QR hidden" /><a href="#">View ticket</a>',
    });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View sent message" }));

    const dialog = await screen.findByRole("dialog", { name: "Sent message preview" });
    expect(
      within(dialog).getByText(/QR code and ticket link are hidden here for privacy/),
    ).toBeTruthy();
    await within(dialog).findByText("Your ticket for Test Event");

    const iframe = within(dialog).getByTitle("Sent message preview");
    expect(iframe.getAttribute("sandbox")).toBe("");
    const srcdoc = iframe.getAttribute("srcdoc") ?? "";
    expect(srcdoc).not.toContain("{{qr_image_url}}");
    expect(srcdoc).not.toContain("{{ticket_url}}");
    expect(fetchRenderedDelivery).toHaveBeenCalledWith("evt-1", "dlv-1", expect.any(AbortSignal));

    // Two "Close" buttons resolve to the same accessible name (the header IconButton and the
    // footer Button) - scope to the footer to disambiguate.
    const footer = dialog.querySelector(".delivery-modal__footer") as HTMLElement;
    fireEvent.click(within(footer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Sent message preview" })).toBeNull();
  });

  it("shows an error state when the fetch fails", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    fetchRenderedDelivery.mockRejectedValueOnce(new Error("boom"));

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View sent message" }));

    const dialog = await screen.findByRole("dialog", { name: "Sent message preview" });
    expect(await within(dialog).findByText("Failed to load the sent message.")).toBeTruthy();
  });
});

describe("CommunicationPage delivery log - delivery details modal", () => {
  it("renders overview fields, the delivery timeline, and raw fields", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [failedResendRow], total: 1 });
    fetchEventDelivery.mockResolvedValue(detailFixture());

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));

    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(dialog).findByText("Overview");

    expect(within(dialog).getByText("Admin User")).toBeTruthy();
    expect(within(dialog).getByText("Connection timed out")).toBeTruthy();
    expect(within(dialog).getByText("smtp_connect")).toBeTruthy();
    expect(within(dialog).getByText("batch-9")).toBeTruthy();
    expect(within(dialog).getByText("sess-9")).toBeTruthy();
    expect(within(dialog).getByText("Europe/Warsaw")).toBeTruthy();

    expect(within(dialog).getByText("Initial send")).toBeTruthy();
    expect(within(dialog).getByText("Resend 1")).toBeTruthy();

    expect(fetchEventDelivery).toHaveBeenCalledWith("evt-1", "dlv-2", expect.any(AbortSignal));
  });

  it("shows an error state when the fetch fails", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [failedResendRow], total: 1 });
    fetchEventDelivery.mockRejectedValueOnce(new Error("boom"));

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));

    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    expect(await within(dialog).findByText("Failed to load delivery details.")).toBeTruthy();
  });

  it("the View sent message footer button swaps to the sent-message modal", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [failedResendRow], total: 1 });
    fetchEventDelivery.mockResolvedValue(detailFixture());
    fetchRenderedDelivery.mockResolvedValue({ subject: "Your ticket", html: "<p>Hi</p>" });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));

    const detailsDialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(detailsDialog).findByText("Overview");
    fireEvent.click(within(detailsDialog).getByRole("button", { name: "View sent message" }));

    expect(screen.queryByRole("dialog", { name: "Delivery details" })).toBeNull();
    await screen.findByRole("dialog", { name: "Sent message preview" });
    expect(fetchRenderedDelivery).toHaveBeenCalledWith("evt-1", "dlv-2", expect.any(AbortSignal));
  });

  it("the Open attendee footer link points at the attendee page", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [failedResendRow], total: 1 });
    fetchEventDelivery.mockResolvedValue(detailFixture());

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));

    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(dialog).findByText("Overview");
    const link = within(dialog).getByRole("link", { name: "Open attendee" });
    expect(link.getAttribute("href")).toBe("/admin/events/evt-1/attendees/att-2");
  });

  it("Export as .txt downloads the real captured fields as plain text, no fabricated transcript", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [failedResendRow], total: 1 });
    fetchEventDelivery.mockResolvedValue(detailFixture());

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));
    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(dialog).findByText("Overview");

    const createObjectURL = vi.fn((_blob: Blob | MediaSource) => "blob:mock-delivery");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    try {
      fireEvent.click(within(dialog).getByRole("button", { name: "Export as .txt" }));

      expect(createObjectURL).toHaveBeenCalledOnce();
      const blob = createObjectURL.mock.calls[0]![0] as Blob;
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });

      expect(text).toContain("Delivery ID: dlv-2");
      expect(text).toContain("Attendee ID: att-2");
      expect(text).toContain("Error code: smtp_connect");
      expect(text).toContain("Error: Connection timed out");
      expect(text).toContain("Sent by: Admin User");
      expect(text).toContain("Initial send: sent");
      expect(text).toContain("Resend 1: failed");
      // No fabricated provider transcript (plan.md: no Postmark integration exists).
      expect(text).not.toContain("250 2.0.0 OK");
      expect(clickSpy).toHaveBeenCalledOnce();
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe("CommunicationPage delivery log - export log button", () => {
  it("calls exportDeliveryLog with the current filters", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    exportDeliveryLog.mockResolvedValue(undefined);

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");
    fireEvent.click(screen.getByRole("button", { name: "Export log" }));

    await waitFor(() => {
      expect(exportDeliveryLog).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ status: "all", purpose: "all", templateId: "all" }),
      );
    });
  });

  it("shows a toast error when export fails", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    exportDeliveryLog.mockRejectedValueOnce(new Error("network down"));

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");
    fireEvent.click(screen.getByRole("button", { name: "Export log" }));

    expect(await screen.findByText("Failed to export the delivery log.")).toBeTruthy();
  });
});

describe("CommunicationPage delivery log - mobile card layout", () => {
  it("renders delivery cards instead of a table, with a working row menu", async () => {
    mockMatchMedia(false);
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    expect(screen.getByRole("menuitem", { name: "View delivery details" })).toBeTruthy();
  });
});
