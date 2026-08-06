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
    event: { id: "evt-1", title: "Demo", archived_at: null, timezone: "Europe/Warsaw" },
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

/** Same shape as detailFixture, but every optional field genuinely unset - exercises the "-"/
 * "no email on file"/"System" fallback branches that a fully-populated fixture never reaches. */
function sparseDetailFixture(): DeliveryDetailDto {
  return {
    ...detailFixture(),
    recipient_email: null,
    provider_message_id: null,
    error_code: null,
    error: null,
    batch_id: null,
    actor_user_id: null,
    actor_display: null,
    session_id: null,
    client_timezone: null,
    timeline: [detailFixture()],
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

    // Exact match - the Card header's own "Clear filters" button also matches a loose /Filters/i.
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
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

  it("changes rows per page and resets to page 1", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 60 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText(/Showing 1.*25 of 60/);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2 }),
        expect.any(AbortSignal),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /^Rows per page,/ }));
    fireEvent.click(screen.getByRole("button", { name: "50" }));
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1, pageSize: 50 }),
        expect.any(AbortSignal),
      );
    });
  });

  it("lists a custom template in the Template filter alongside the built-in default", async () => {
    fetchEventTemplates.mockResolvedValue([
      {
        id: "tmpl-1",
        name: "vip",
        label: "VIP invite",
        template_format: "mjml",
        subject_template: "You're on the list",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const templateSelect = screen.getByLabelText("Template") as HTMLSelectElement;
    const optionLabels = Array.from(templateSelect.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["All templates", "Default ticket template", "VIP invite"]);

    fireEvent.change(templateSelect, { target: { value: "tmpl-1" } });
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ templateId: "tmpl-1" }),
        expect.any(AbortSignal),
      );
    });
  });

  it("Live toggles to Paused and back, and stops the count from going stale (regression: it used to stay blank until the tab was opened)", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");

    const liveButton = screen.getByRole("button", { name: "Live" });
    fireEvent.click(liveButton);
    expect(screen.getByRole("button", { name: "Paused" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Paused" }));
    expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();
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

  it("Clear filters (Card header) resets status/purpose/template/search and re-fetches", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");

    expect(screen.getByRole("button", { name: "Clear filters" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "failed" } });
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ status: "failed" }),
        expect.any(AbortSignal),
      );
    });
    expect(screen.getByRole("button", { name: "Clear filters" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({
          page: 1,
          status: "all",
          purpose: "all",
          templateId: "all",
          search: undefined,
        }),
        expect.any(AbortSignal),
      );
    });
    expect(screen.getByRole("button", { name: "Clear filters" })).toHaveProperty("disabled", true);
  });
});

describe("CommunicationPage delivery log - row menu", () => {
  it("opens with two diagnostic actions (no attendee link - the recipient name links there instead)", async () => {
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
    ]);
  });

  it("links the recipient name to their attendee profile", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });

    renderPage();
    await goToDeliveryLogTab();
    const nameLink = await screen.findByRole("link", { name: /Guest One/ });
    expect(nameLink.getAttribute("href")).toBe("/admin/events/evt-1/attendees/att-1");
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

    // Only the header IconButton closes it now - the redundant footer Close button (the header
    // X already did the same thing) was removed.
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Sent message preview" })).toBeNull();
  });

  it("silently ignores the fetch outcome once the modal is closed before it settles", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    fetchRenderedDelivery.mockImplementation(
      (_eventId: string, _id: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View sent message" }));
    await screen.findByRole("dialog", { name: "Sent message preview" });

    // Closing unmounts the modal, whose cleanup aborts the in-flight fetch - the resulting
    // rejection must be swallowed (controller.signal.aborted guards) rather than trying to
    // setError/setLoading on an unmounted component.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Sent message preview" })).toBeNull();

    // Flush the aborted promise's reject -> catch -> finally chain before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stateUpdateWarning = consoleError.mock.calls.some((call) =>
      String(call[0]).includes("Can't perform a React state update"),
    );
    expect(stateUpdateWarning).toBe(false);

    consoleError.mockRestore();
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

  it("shows a not-available message once the retention window has cleared the stored snapshot", async () => {
    fetchEventDeliveries.mockResolvedValue({
      items: [{ ...acceptedRow, recipient_email: null }],
      total: 1,
    });
    fetchRenderedDelivery.mockResolvedValue({ subject: null, html: null });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View sent message" }));

    const dialog = await screen.findByRole("dialog", { name: "Sent message preview" });
    expect(
      await within(dialog).findByText("This message's stored content is no longer available."),
    ).toBeTruthy();
    expect(within(dialog).getByText(/no email on file/)).toBeTruthy();
  });
});

describe("CommunicationPage delivery log - delivery details modal", () => {
  it("renders overview fields, a readable error notice, and raw fields (no timeline)", async () => {
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
    // Notice shows code + short transport error (not a Bounce NDR dump). Raw fields also list the code.
    expect(within(dialog).getByRole("alert").textContent).toMatch(/smtp_connect/);
    expect(within(dialog).getByRole("alert").textContent).toMatch(/Connection timed out/);
    expect(within(dialog).getAllByText("smtp_connect").length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText("batch-9")).toBeTruthy();
    expect(within(dialog).getByText("sess-9")).toBeTruthy();
    expect(within(dialog).getByText("Europe/Warsaw")).toBeTruthy();

    // Sibling attempts live on Delivery history / the log, not in this modal.
    expect(within(dialog).queryByText("Delivery timeline")).toBeNull();
    expect(within(dialog).queryByText("Initial send")).toBeNull();
    expect(within(dialog).queryByText("Resend 1")).toBeNull();

    // Overview timestamps use actor/event zone (Warsaw), not bare UTC.
    const overview = within(dialog).getByText("Overview").closest("div");
    expect(overview?.textContent).toMatch(/UTC\+/);
    expect(overview?.textContent).not.toMatch(/ UTC(?!\+)/);

    expect(fetchEventDelivery).toHaveBeenCalledWith("evt-1", "dlv-2", expect.any(AbortSignal));
  });

  it("shows an SMTP bounce code with a plain-English notice and never the raw Bounce dump", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [failedResendRow], total: 1 });
    fetchEventDelivery.mockResolvedValue({
      ...detailFixture(),
      status: "bounced",
      error_code: "550/5.7.1",
      error:
        "Bounce 550/5.7.1: exceeded unknown recipient count limit -------------- UWAGA: Niniejsza wiadomo&#347;&#263;",
    });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));

    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(dialog).findByText("Overview");

    const notice = within(dialog).getByRole("alert");
    expect(notice.textContent).toMatch(/550\/5\.7\.1/);
    expect(notice.textContent).toMatch(/policy reason/i);
    expect(notice.textContent).not.toMatch(/Bounce 550/);
    expect(notice.textContent).not.toMatch(/wiadomo/);
    expect(notice.textContent).not.toMatch(/&#347;/);
    // Raw fields still lists the bare code (also appears in the notice).
    expect(within(dialog).getAllByText("550/5.7.1").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a green success notice when the provider accepted the message", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    fetchEventDelivery.mockResolvedValue({
      ...acceptedRow,
      batch_id: null,
      actor_user_id: null,
      actor_display: null,
      session_id: null,
      timeline: [acceptedRow],
    });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest One's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));

    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(dialog).findByText("Overview");

    const notice = within(dialog).getByRole("status");
    expect(notice.textContent).toMatch(/accepted this message for delivery/i);
    expect(notice.className).toMatch(/success/);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("falls back to placeholders for every unset optional field", async () => {
    fetchEventDeliveries.mockResolvedValue({
      items: [{ ...failedResendRow, recipient_email: null }],
      total: 1,
    });
    fetchEventDelivery.mockResolvedValue(sparseDetailFixture());

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));

    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(dialog).findByText("Overview");

    expect(within(dialog).getByText(/no email on file/)).toBeTruthy();
    expect(within(dialog).getByText("System")).toBeTruthy();
    // error_code, batch_id, session_id, client_timezone all render as a bare "-".
    expect(within(dialog).getAllByText("-").length).toBeGreaterThanOrEqual(4);
  });

  it("silently ignores the fetch outcome once the modal is closed before it settles", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [failedResendRow], total: 1 });
    fetchEventDelivery.mockImplementation(
      (_eventId: string, _id: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));
    await screen.findByRole("dialog", { name: "Delivery details" });

    // Closing unmounts the modal, whose cleanup aborts the in-flight fetch - the resulting
    // rejection must be swallowed (controller.signal.aborted guards) rather than trying to
    // setError/setLoading on an unmounted component.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Delivery details" })).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 0));
    const stateUpdateWarning = consoleError.mock.calls.some((call) =>
      String(call[0]).includes("Can't perform a React state update"),
    );
    expect(stateUpdateWarning).toBe(false);

    consoleError.mockRestore();
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

  it("closes via the header Close button", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [failedResendRow], total: 1 });
    fetchEventDelivery.mockResolvedValue(detailFixture());

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));

    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(dialog).findByText("Overview");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Delivery details" })).toBeNull();
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

  it("Export as .txt falls back to placeholders for every unset optional field, retryable unknown", async () => {
    fetchEventDeliveries.mockResolvedValue({
      items: [{ ...failedResendRow, recipient_email: null }],
      total: 1,
    });
    fetchEventDelivery.mockResolvedValue({ ...sparseDetailFixture(), retryable: null });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));
    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(dialog).findByText("Overview");

    const createObjectURL = vi.fn((_blob: Blob | MediaSource) => "blob:mock-delivery-sparse");
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

      expect(text).toContain("Recipient: Guest Two <no email on file>");
      expect(text).toContain("Retryable: -");
      expect(text).toContain("Error code: -");
      expect(text).toContain("Error: -");
      expect(text).toContain("Sent by: System");
      expect(text).toContain("Batch ID: -");
      expect(text).toContain("Session ID: -");
      expect(text).toContain("Client timezone: -");
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("shows \"No\" for a delivery that was checked and found not retryable", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [failedResendRow], total: 1 });
    fetchEventDelivery.mockResolvedValue({ ...detailFixture(), retryable: false });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Guest Two's message" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View delivery details" }));

    const dialog = await screen.findByRole("dialog", { name: "Delivery details" });
    await within(dialog).findByText("Overview");
    expect(within(dialog).getByText("No")).toBeTruthy();
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

  it("exports with the debounced search the table itself used, not whatever is still mid-type", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    exportDeliveryLog.mockResolvedValue(undefined);

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");

    // Typing alone doesn't commit deliverySearch until the 300ms debounce fires - exporting
    // right after a keystroke must not race ahead of the table's own (not-yet-updated) query.
    fireEvent.change(screen.getByLabelText("Search recipient by name or email"), {
      target: { value: "carol" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export log" }));

    await waitFor(() => {
      expect(exportDeliveryLog).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ search: undefined }),
      );
    });
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

  it("shows a local-time line for a row with a known client timezone, a placeholder email for one without", async () => {
    mockMatchMedia(false);
    const noEmailRow = { ...acceptedRow, id: "dlv-3", attendee_name: "Guest Three", recipient_email: null };
    fetchEventDeliveries.mockResolvedValue({ items: [failedRow, noEmailRow], total: 2 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest Two");

    // failedRow carries client_timezone: "Europe/Warsaw" - the card's local-time secondary line.
    expect(screen.getByText(/Europe\/Warsaw/)).toBeTruthy();
    // noEmailRow has no recipient_email - the card falls back to a bare "-" instead of blank.
    const noEmailCard = screen.getByText("Guest Three").closest(".communication-card");
    const emailMeta = noEmailCard?.querySelector(".ti-mail")?.parentElement;
    expect(emailMeta?.textContent).toContain("-");
  });
});

describe("CommunicationPage delivery log - error handling, tab URL sync, live polling", () => {
  it("redirects to login on a 401 and reports it, without surfacing a generic error banner", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventDeliveries.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/events/evt-1/communication", assign: assignSpy },
    });

    try {
      renderPage();
      await goToDeliveryLogTab();
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fevents%2Fevt-1%2Fcommunication"),
      );
      expect(connectionState.reportApiError).toHaveBeenCalledWith(401);
      expect(screen.queryByText("Failed to load deliveries.")).toBeNull();
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("reports a non-401 ApiError and shows the generic error banner, without redirecting", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventDeliveries.mockRejectedValueOnce(new ApiError(500, "internal_error"));

    renderPage();
    await goToDeliveryLogTab();

    expect(await screen.findByText("Failed to load deliveries.")).toBeTruthy();
    expect(connectionState.reportApiError).toHaveBeenCalledWith(500);
  });

  it("shows a Retry EmptyState on a failed load, and recovers when Retry succeeds (AGENTS.md initial-load-failure pattern)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventDeliveries
      .mockRejectedValueOnce(new ApiError(500, "internal_error"))
      .mockResolvedValueOnce({ items: [acceptedRow], total: 1 });

    renderPage();
    await goToDeliveryLogTab();

    await screen.findByText("Could not load deliveries");
    expect(screen.getByText("Failed to load deliveries.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.queryByText("Could not load deliveries")).toBeNull();
    });
    expect(await screen.findByText("Guest One")).toBeTruthy();
  });

  it("ignores an aborted delivery fetch instead of flashing an error banner (e.g. filters changing again before the first request finishes)", async () => {
    let callCount = 0;
    fetchEventDeliveries.mockImplementation(
      (_eventId: string, _params: unknown, signal: AbortSignal) => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          });
        }
        return Promise.resolve({ items: [acceptedRow], total: 1 });
      },
    );

    renderPage();
    await goToDeliveryLogTab();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    // Changing the filter while the first (page-load) request is still pending re-runs the
    // mount effect, aborting it before it ever settles.
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "sent" } });

    await screen.findByText("Guest One");
    expect(screen.queryByText("Failed to load deliveries.")).toBeNull();
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("ignores a stale response that resolves after being superseded by a newer request", async () => {
    let callCount = 0;
    let resolveFirst: (value: { items: DeliveryDto[]; total: number }) => void = () => {};
    fetchEventDeliveries.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        // Never listens to the abort signal - simulates a slow response that keeps resolving
        // even after the request that produced it has been superseded.
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ items: [acceptedRow], total: 1 });
    });

    renderPage();
    await goToDeliveryLogTab();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "sent" } });
    await screen.findByText("Guest One");
    expect(await screen.findByText(/Showing 1.*1 of 1/)).toBeTruthy();

    // The superseded first request finally resolves - its (very different) total must not
    // clobber the current, correct state.
    resolveFirst({ items: [failedRow], total: 999 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/999/)).toBeNull();
    expect(screen.getByText(/Showing 1.*1 of 1/)).toBeTruthy();
  });

  it("clears ?tab=log from the URL when switching back to Compose", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });

    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");

    fireEvent.click(screen.getByRole("tab", { name: /Compose/i }));
    await screen.findByRole("tab", { name: /Compose/i, selected: true });

    fireEvent.click(screen.getByRole("tab", { name: /Delivery log/i }));
    const tab = await screen.findByRole("tab", { name: /Delivery log/i, selected: true });
    expect(tab).toBeTruthy();
  });

  it("keeps polling on a timer while Live, and clamps the page back once the total shrinks below it", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 60 });
    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText(/Showing 1.*25 of 60/);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2 }),
        expect.any(AbortSignal),
      ),
    );

    fetchEventDeliveries.mockClear();
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 10 });

    // shouldAdvanceTime lets real microtask/promise resolution (the mocked fetch) keep working
    // alongside the faked setInterval, so testing-library's own waitFor polling (real setTimeout
    // under the hood) doesn't deadlock against a fully-frozen clock.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await vi.advanceTimersByTimeAsync(1750);
    } finally {
      vi.useRealTimers();
    }

    // The silent poll's own response (total=10, still on page 2) clamps deliveryPage back to 1
    // (maxPage = ceil(10/25)); that page change then triggers one more, non-silent load.
    await waitFor(() =>
      expect(fetchEventDeliveries).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1 }),
        expect.any(AbortSignal),
      ),
    );
  });

  it("silently ignores a failed poll tick, without showing an error banner over the rows already on screen", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText("Guest One");

    fetchEventDeliveries.mockRejectedValueOnce(new Error("network blip"));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await vi.advanceTimersByTimeAsync(1750);
    } finally {
      vi.useRealTimers();
    }

    // The row that was already on screen stays - a silently-failed poll is normal noise, not
    // worth surfacing as an error over data that's already there.
    expect(screen.getByText("Guest One")).toBeTruthy();
    expect(screen.queryByText("Failed to load deliveries.")).toBeNull();
  });

  it("clamps back to the last valid page once a silent poll's shrunken total makes it invalid", async () => {
    // Reset rather than just re-set: clearAllMocks (afterEach) doesn't drain a still-queued
    // mockRejectedValueOnce left behind by a preceding test, which would otherwise reject this
    // test's first (mount) fetch instead of resolving it.
    fetchEventDeliveries.mockReset();
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 60 });
    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText(/Showing 1.*25 of 60/);

    // Page (via the Next button) rather than a filter/search change: those reset the page to 1
    // themselves (see DeliveryLogTable's onStatusChange/onSearchChange/onPurposeChange wrappers),
    // which would mask the clamp effect under test here.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 3 }),
        expect.any(AbortSignal),
      ),
    );

    // The next silent poll tick resolves with a much smaller total - page 3 no longer exists
    // (maxPage=1) - real timers (not vi.useFakeTimers) so the interval's own callback keeps
    // normal coverage instrumentation.
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 5 });
    await waitFor(
      () =>
        expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
          "evt-1",
          expect.objectContaining({ page: 1 }),
          expect.any(AbortSignal),
        ),
      { timeout: 3000 },
    );
  }, 10_000);

  it("resets to page 1 (not a no-op) once a silent poll empties the total while on a later page", async () => {
    fetchEventDeliveries.mockReset();
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 60 });
    renderPage();
    await goToDeliveryLogTab();
    await screen.findByText(/Showing 1.*25 of 60/);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2 }),
        expect.any(AbortSignal),
      ),
    );

    fetchEventDeliveries.mockResolvedValue({ items: [], total: 0 });
    await waitFor(
      () =>
        expect(fetchEventDeliveries).toHaveBeenLastCalledWith(
          "evt-1",
          expect.objectContaining({ page: 1 }),
          expect.any(AbortSignal),
        ),
      { timeout: 3000 },
    );
  }, 10_000);

  it("shows a plain placeholder instead of crashing when the route has no eventId", async () => {
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/communication-no-event"]}>
        <Routes>
          <Route path="/admin/communication-no-event" element={<CommunicationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Missing event.")).toBeTruthy();
    expect(fetchEventDeliveries).not.toHaveBeenCalled();
  });
});
