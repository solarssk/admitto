// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { CommunicationPage, recoverLegacyAfterDelete, resolveTestSendTemplateLabel } from "../../src/pages/CommunicationPage.js";
import { makeEmailPreviewInert } from "../../src/communication/inertEmailPreview.js";
import { advanceTimers, clickKeepEditing, deferred, getTooltipText, hangUntilAborted, isOff, renderWithToast } from "../test-utils.js";
import { TemplateEditorFallback } from "../../src/communication/CommunicationSkeleton.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { communicationApiMocks } from "./communicationApiMock.js";
import { bodyValue, getBodyView, setBodyValue } from "./codeMirrorTestUtils.js";

const {
  fetchEventTemplates,
  fetchEventTemplate,
  fetchEventTemplateById,
  fetchEventOverview,
  fetchEventDeliveries,
} = communicationApiMocks;
const sendEventBulk = vi.fn();
const fetchBulkSendStatus = vi.fn();
const createEventTemplate = vi.fn();
const deleteEventTemplate = vi.fn();
const previewEventTemplate = vi.fn();
const previewEventTemplateById = vi.fn();
const saveEventTemplateById = vi.fn();
const testSendEventTemplate = vi.fn();
const testSendEventTemplateById = vi.fn();
const updateEventTemplateMetadata = vi.fn();
const fetchTicketTypes = vi.fn();
const fetchEventMailSettings = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js");

// buildCommunicationApiMock is loaded via a dynamic import *inside* the factory (same technique
// as checkInScanApiSetup.ts) rather than a plain top-level import - vi.mock() calls hoist above
// regular imports, and this factory calls it in an immediately-evaluated position, which hits a
// temporal-dead-zone ReferenceError on a plain static import (confirmed by trying it first).
// This file drives create/delete/preview/send flows in depth, so - unlike its siblings - it
// overrides nearly every key of the shared base with its own individually-tracked handle; it
// still benefits from not hand-rolling ApiError/TemplateValidationError (spread from the real
// module) and from the five commonly-controlled fetch calls above.
vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { buildCommunicationApiMock } = await import("./communicationApiMock.js");
  return {
    ...buildCommunicationApiMock(await importOriginal<typeof import("../../src/api/client.js")>()),
    previewEventTemplate: (...args: unknown[]) => previewEventTemplate(...args),
    previewEventTemplateById: (...args: unknown[]) => previewEventTemplateById(...args),
    saveEventTemplateById: (...args: unknown[]) => saveEventTemplateById(...args),
    createEventTemplate: (...args: unknown[]) => createEventTemplate(...args),
    deleteEventTemplate: (...args: unknown[]) => deleteEventTemplate(...args),
    updateEventTemplateMetadata: (...args: unknown[]) => updateEventTemplateMetadata(...args),
    testSendEventTemplate: (...args: unknown[]) => testSendEventTemplate(...args),
    testSendEventTemplateById: (...args: unknown[]) => testSendEventTemplateById(...args),
    sendEventBulk: (...args: unknown[]) => sendEventBulk(...args),
    fetchBulkSendStatus: (...args: unknown[]) => fetchBulkSendStatus(...args),
    fetchTicketTypes: (...args: unknown[]) => fetchTicketTypes(...args),
    fetchEventMailSettings: (...args: unknown[]) => fetchEventMailSettings(...args),
  };
});

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
  icon: null,
  description: null,
  template_format: "html" as const,
  subject_template: "Ticket",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const reminderRow = {
  id: "tpl-rem",
  name: "reminder",
  label: "Reminder",
  icon: null,
  description: null,
  template_format: "mjml" as const,
  subject_template: "Reminder subject",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const announcementRow = {
  id: "tpl-ann",
  name: "announcement",
  label: "Announcement",
  icon: null,
  description: null,
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

function renderPageOnTab(tab: string) {
  return renderWithToast(
    <MemoryRouter initialEntries={[`/admin/events/evt-comm/communication?tab=${tab}`]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderSendPage() {
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

function renderSendPageWithEventSwitch() {
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

/**
 * The Templates tab of one event, with a link to another page (by default one of the same event: leaving the page, not the
 * event). The browser router has moved the address bar by the time React commits the new page; MemoryRouter does not touch
 * it, so the link does.
 */
function renderPageWithLeaveLink(destination = "/admin/events/evt-a/elsewhere") {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-a/communication?tab=templates"]}>
      <Link to={destination} onClick={() => window.history.pushState(null, "", destination)}>
        Leave page
      </Link>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
        <Route path="*" element={<p>Elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * The Templates tab of one event, with a link straight to a page of ANOTHER event that is not this page's route (event B's
 * Overview), so the page unmounts without ever re-rendering with B's id. The browser router has moved the address bar by the
 * time React commits the new page; MemoryRouter does not touch it, so the link does.
 */
function renderPageWithLinkToAnotherEventsPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-a/communication?tab=templates"]}>
      <Link to="/admin/events/evt-b/elsewhere" onClick={() => window.history.pushState(null, "", "/admin/events/evt-b/elsewhere")}>
        Go to event B
      </Link>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
        <Route path="/admin/events/:eventId/elsewhere" element={<p>Elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Two events whose templates differ: A has the Ticket and a Reminder, B only a "Ticket B". */
function mockTwoEvents() {
  fetchEventTemplates.mockImplementation(async (id: string) =>
    id === "evt-a" ? [ticketRow, reminderRow] : [{ ...ticketRow, id: "tpl-ticket-b", label: "Ticket B" }],
  );
  fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
    if (id === "tpl-ticket-b") return { ...ticketRow, id: "tpl-ticket-b", label: "Ticket B", body_template: "<mjml></mjml>" };
    if (id === "tpl-rem") return { ...reminderRow, body_template: "<p>Reminder</p>" };
    return { ...ticketRow, body_template: "<p>Ticket</p>" };
  });
}

/** Follows the "Switch event" link and waits until the second event's own page is there. */
async function switchToEventB() {
  fireEvent.click(screen.getByRole("link", { name: "Switch event" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Template, Ticket B" })).toBeTruthy());
}

/** Opens the Templates tab's picker dropdown and selects the option matching `label`. */
async function selectTemplate(label: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Template,/ }));
  fireEvent.click(await screen.findByRole("button", { name: label }));
}

/** Renders the Templates tab (Ticket active by default) - the "arrange" the vast majority of
 * tests below start from, before diverging into their own scenario. */
async function renderTemplatesTab() {
  renderPage();
  await waitFor(() => {
    expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
  });
}

/** Same as `renderTemplatesTab`, but also selects `label` and waits for `expectedSubjectValue`
 * to confirm the switch landed - what most tests below actually want to start from. */
async function renderAndSelect(label: string, expectedSubjectValue: string) {
  await renderTemplatesTab();
  await selectTemplate(label);
  await waitFor(() => {
    expect(screen.getByDisplayValue(expectedSubjectValue)).toBeTruthy();
  });
}

/** Same as `renderAndSelect`, but also opens the Edit template modal for the now-active
 * template and returns it - the "arrange" every edit-modal test below starts from. */
async function renderSelectAndOpenEditModal(label: string, expectedSubjectValue: string) {
  await renderAndSelect(label, expectedSubjectValue);
  fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
  return screen.findByRole("dialog", { name: "Edit template" });
}

/** Opens the Edit template modal for whichever template is active, clicks its nested Delete
 * button, then confirms in the nested ConfirmDialog - mirrors the operator flow (pencil button
 * -> Delete -> confirm) now that delete only lives inside that modal, not the picker bar. */
async function deleteActiveTemplateViaModal() {
  fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  const confirmDialog = await screen.findByRole("dialog", { name: "Delete template?" });
  fireEvent.click(within(confirmDialog).getByRole("button", { name: "Delete" }));
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
  window.history.pushState(null, "", "/");
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
  testSendEventTemplate.mockReset();
  sendEventBulk.mockReset();
  fetchBulkSendStatus.mockReset();
  vi.useRealTimers();
});

describe("CommunicationPage delayed loading", () => {
  it("keeps the title and the tabs on screen and draws the open tab's cards once the fetch has genuinely taken a moment", () => {
    fetchEventTemplates.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    expect(screen.getByLabelText("Loading communication").className).toContain("at-loading-hold");
    expect(screen.getByRole("tab", { name: "Email" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText("Loading communication").className).not.toContain("at-loading-hold");
    expect(screen.getByText("Ticket template")).toBeTruthy();
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

  it("switches the preview's Light/Dark toggle and back, updating the mail-client shell and iframe together", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    previewEventTemplate.mockResolvedValue({
      subject: "Hi",
      html: '<!doctype html><html><head><style>.logo{color:#222}</style></head><body><img src="logo.png"></body></html>',
    });

    renderPage();

    const frame = await screen.findByTitle<HTMLIFrameElement>("Email preview");
    const shell = frame.closest(".communication-mail-client");
    expect(shell?.className).not.toContain("communication-mail-client--dark");
    expect(frame.className).not.toContain("communication-preview-frame--dark-sim");
    expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(shell?.className).toContain("communication-mail-client--dark");
    expect(frame.className).toContain("communication-preview-frame--dark-sim");
    expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    // The iframe's own content was re-run through forcePreviewColorScheme for "dark" too, not
    // just the surrounding shell's CSS class.
    expect(frame.srcdoc).toContain("filter:invert(1) hue-rotate(180deg) !important");

    fireEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(shell?.className).not.toContain("communication-mail-client--dark");
    expect(frame.className).not.toContain("communication-preview-frame--dark-sim");
    expect(frame.srcdoc).not.toContain("hue-rotate");
  });

  it("shows a safe initial-load error when template loading fails outside the API layer", async () => {
    fetchEventTemplates.mockRejectedValueOnce(new Error("network unavailable"));
    fetchEventTemplate.mockResolvedValue(legacyTemplate);

    renderPage();

    expect(await screen.findByText("Could not load template.")).toBeTruthy();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("retries the initial template load when Retry is clicked", async () => {
    fetchEventTemplates.mockRejectedValueOnce(new Error("network unavailable"));
    fetchEventTemplate.mockResolvedValue(legacyTemplate);

    renderPage();
    await screen.findByText("Could not load template.");

    fetchEventTemplates.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Ticket email")).toBeTruthy();
    });
    expect(screen.queryByText("Could not load template.")).toBeNull();
  });

  it("reports the API status and gives an event-access error for a forbidden initial load", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockRejectedValueOnce(new ApiError(403, "not_for_operator"));
    fetchEventTemplate.mockResolvedValue(legacyTemplate);

    renderPage();

    expect(await screen.findByText("You do not have access to this event.")).toBeTruthy();
    // The EmptyState title must match this specific cause, not the generic "Could not load
    // template" heading used for every other load failure (bot review).
    expect(screen.getByText("You do not have access to this event")).toBeTruthy();
    expect(screen.queryByText("Could not load template")).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("gives the generic message (not the 403 access one) for a non-403 API error on initial load", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockRejectedValueOnce(new ApiError(500, "internal_error"));
    fetchEventTemplate.mockResolvedValue(legacyTemplate);

    renderPage();

    expect(await screen.findByText("Could not load template.")).toBeTruthy();
    expect(screen.getByText("Could not load template")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);
  });

  it("still renders the page when the sender name/address lookup fails", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    fetchEventMailSettings.mockRejectedValueOnce(new Error("network unavailable"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });
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

    const view = getBodyView("HTML body");
    setBodyValue(view, "<p>New body</p>");
    expect(bodyValue(view)).toBe("<p>New body</p>");
  });

  it("selects persisted ticket template from the picker", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Template, Ticket email" })).toBeTruthy();
    });
    expect(fetchEventTemplateById).toHaveBeenCalledWith("evt-comm", "tpl-ticket", expect.any(AbortSignal));
  });

  it("switches templates from the Send tab's own picker", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Template, Ticket email" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("tab", { name: /Email/i }));
    await screen.findByRole("tab", { name: /Email/i, selected: true });

    fireEvent.click(screen.getByRole("button", { name: "Template, Ticket email" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reminder" }));

    await waitFor(() => {
      expect(fetchEventTemplateById).toHaveBeenCalledWith("evt-comm", "tpl-rem");
    });
    expect(screen.getByRole("button", { name: "Template, Reminder" })).toBeTruthy();
  });

  it("disables Edit with an explanatory tooltip for the virtual ticket entry, enables it for a real template", async () => {
    fetchEventTemplates.mockResolvedValue([reminderRow]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ticket email")).toBeTruthy();
    });
    const editBtn = screen.getByRole("button", { name: "Edit template" }) as HTMLButtonElement;
    expect(editBtn.disabled).toBe(true);
    expect(getTooltipText(editBtn)).toBe("Save this template once to edit its details.");

    await selectTemplate("Reminder");

    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });
    expect((screen.getByRole("button", { name: "Edit template" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables the nested Delete button with an explanatory tooltip for a real ticket-named template", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    await renderTemplatesTab();
    fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
    const editDialog = await screen.findByRole("dialog", { name: "Edit template" });
    const deleteBtn = within(editDialog).getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
    expect(getTooltipText(deleteBtn)).toBe("The default ticket template can't be deleted.");
  });

  it("pre-fills the edit modal with the active template's current label/icon/description and saves the edit", async () => {
    fetchEventTemplates.mockResolvedValue([
      ticketRow,
      { ...reminderRow, icon: "bell", description: "Sent 24h before the event." },
    ]);
    updateEventTemplateMetadata.mockResolvedValue({
      ...reminderRow,
      label: "Final reminder",
      icon: "clock",
      description: "Sent 1h before doors open.",
    });

    const editDialog = await renderSelectAndOpenEditModal("Reminder", "Reminder subject");
    expect(within(editDialog).getByLabelText("Template label")).toHaveProperty("value", "Reminder");
    expect(within(editDialog).getByLabelText("Description")).toHaveProperty(
      "value",
      "Sent 24h before the event.",
    );
    expect(
      within(editDialog).getByRole("button", { name: "Reminder" }) as HTMLButtonElement,
    ).toHaveProperty("ariaPressed", "true");

    fireEvent.change(within(editDialog).getByLabelText("Template label"), {
      target: { value: "Final reminder" },
    });
    fireEvent.change(within(editDialog).getByLabelText("Description"), {
      target: { value: "Sent 1h before doors open." },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Last call" }));
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateEventTemplateMetadata).toHaveBeenCalledWith("evt-comm", "tpl-rem", {
        label: "Final reminder",
        icon: "clock",
        description: "Sent 1h before doors open.",
      });
      expect(screen.queryByRole("dialog", { name: "Edit template" })).toBeNull();
      expect(screen.getByRole("button", { name: "Template, Final reminder" })).toBeTruthy();
    });
  });

  it("blocks saving an empty label without calling the API", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    const editDialog = await renderSelectAndOpenEditModal("Reminder", "Reminder subject");
    fireEvent.change(within(editDialog).getByLabelText("Template label"), {
      target: { value: "   " },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    expect(within(editDialog).getByText("Enter a template label.")).toBeTruthy();
    expect(updateEventTemplateMetadata).not.toHaveBeenCalled();
  });

  it("toasts an operator-safe message when the metadata save fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
    updateEventTemplateMetadata.mockRejectedValue(new ApiError(500, "server_error"));

    const editDialog = await renderSelectAndOpenEditModal("Reminder", "Reminder subject");
    // Save is disabled on a clean load - dirty the field so it becomes clickable.
    fireEvent.change(within(editDialog).getByLabelText("Template label"), {
      target: { value: "Reminder!" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Update failed.")).toBeTruthy();
      expect(screen.getByRole("dialog", { name: "Edit template" })).toBeTruthy();
    });
  });

  it("toasts Update failed when metadata save rejects with a non-API error", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
    updateEventTemplateMetadata.mockRejectedValue(new Error("network down"));

    const editDialog = await renderSelectAndOpenEditModal("Reminder", "Reminder subject");
    // Save is disabled on a clean load - dirty the field so it becomes clickable.
    fireEvent.change(within(editDialog).getByLabelText("Template label"), {
      target: { value: "Reminder!" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Update failed.")).toBeTruthy();
    });
  });

  it("keeps the edit modal open on Escape/Cancel while a metadata save is in flight", async () => {
    updateEventTemplateMetadata.mockImplementation(() => new Promise(() => {}));
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    const editDialog = await renderSelectAndOpenEditModal("Reminder", "Reminder subject");
    // Save is disabled on a clean load - dirty the field so it becomes clickable.
    fireEvent.change(within(editDialog).getByLabelText("Template label"), {
      target: { value: "Reminder!" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(within(editDialog).getByRole("button", { name: "Save" }).getAttribute("aria-busy")).toBe("true");
    });

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Edit template" })).toBeTruthy();
  });

  it("closes the edit modal when Cancel is clicked while idle", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    const editDialog = await renderSelectAndOpenEditModal("Reminder", "Reminder subject");
    fireEvent.click(within(editDialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Edit template" })).toBeNull();
  });

  it("deletes the active template from inside the edit modal", async () => {
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates
      .mockResolvedValueOnce([ticketRow, reminderRow])
      .mockResolvedValueOnce([ticketRow]);

    await renderAndSelect("Reminder", "Reminder subject");

    await deleteActiveTemplateViaModal();

    await waitFor(() => {
      expect(deleteEventTemplate).toHaveBeenCalledWith("evt-comm", "tpl-rem");
      expect(screen.queryByRole("dialog", { name: "Edit template" })).toBeNull();
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
  });

  it("asks to discard unsaved subject/body edits before deleting from the edit modal", async () => {
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates
      .mockResolvedValueOnce([ticketRow, reminderRow])
      .mockResolvedValueOnce([ticketRow]);

    await renderAndSelect("Reminder", "Reminder subject");

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Unsaved reminder" } });
    await deleteActiveTemplateViaModal();

    expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
    expect(deleteEventTemplate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(deleteEventTemplate).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Unsaved reminder")).toBeTruthy();

    await deleteActiveTemplateViaModal();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(deleteEventTemplate).toHaveBeenCalledWith("evt-comm", "tpl-rem");
      expect(screen.queryByRole("dialog", { name: "Edit template" })).toBeNull();
    });
  });

  it("shows each template's own icon in the picker, falling back to the default when unset", async () => {
    fetchEventTemplates.mockResolvedValue([{ ...reminderRow, icon: "bell" }, announcementRow]);

    renderPage();

    const trigger = await screen.findByRole("button", { name: "Template, Ticket email" });
    expect(trigger.querySelector(".ti-ticket")).toBeTruthy();

    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Template, Reminder" }).querySelector(".ti-bell"),
      ).toBeTruthy();
    });

    await selectTemplate("Announcement");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Template, Announcement" }).querySelector(".ti-mail"),
      ).toBeTruthy();
    });
  });

  it("does not refetch legacy template when switching between persisted templates", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    await renderTemplatesTab();

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

    await renderTemplatesTab();

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

    await renderTemplatesTab();

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
    createBtn.focus();
    fireEvent.click(createBtn);
    fireEvent.click(createBtn);

    expect(createEventTemplate).toHaveBeenCalledTimes(1);
    // The busy Create keeps its label and its focus (it is aria-disabled, not disabled) and says it works.
    await waitFor(() => expect(createBtn.getAttribute("aria-busy")).toBe("true"));
    expect(within(dialog).getByRole("button", { name: "Create" })).toBe(createBtn);
    expect(createBtn.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(createBtn);
  });

  it("keeps the keyboard focus in the label field when Enter creates the template, which only stops accepting text meanwhile", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    createEventTemplate.mockImplementation(() => new Promise(() => {}));

    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New template" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    const dialog = screen.getByRole("dialog", { name: "New template" });
    const input = within(dialog).getByLabelText("Template label") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "Announcement" } });

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(createEventTemplate).toHaveBeenCalledTimes(1));
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("shows discard confirm when switching templates with dirty form", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    await renderTemplatesTab();

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

    await renderTemplatesTab();

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Dirty draft" } });
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "New template" })).toBeTruthy();
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
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Create failed/);
    });
  });

  it("toasts a generic message when create template fails outside the API layer", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    createEventTemplate.mockRejectedValueOnce(new Error("network unavailable"));
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
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Create failed/);
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

    setBodyValue(getBodyView("HTML body"), "<p>New body</p>");

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
        expect(screen.getByTestId("at-toast").textContent).toMatch(/Preview failed/);
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
    expect(screen.getByTitle("Email preview").getAttribute("srcdoc")).toBe(
      makeEmailPreviewInert("<p>Rendered preview</p>"),
    );
  });

  it("keeps the format unchanged when the switch-format confirmation is cancelled", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);

    renderPage();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("radio", { name: "MJML" }));
    await clickKeepEditing();
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

  it("lists multiple preview validation errors as a bullet list", async () => {
    const { TemplateValidationError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    previewEventTemplateById.mockRejectedValue(
      new TemplateValidationError(["Missing {{ticket_url}}", "Missing {{first_name}}"]),
    );

    renderPage();

    expect(await screen.findByText("Missing {{ticket_url}}", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText("Missing {{first_name}}")).toBeTruthy();
  });

  it("Send-tab preview uses the legacy endpoint for the virtual ticket template", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    previewEventTemplate.mockResolvedValue({ subject: "Inherited subject", html: "<p>Inherited</p>" });

    renderSendPage();

    expect(await screen.findByText("Inherited subject")).toBeTruthy();
    expect(previewEventTemplate).toHaveBeenCalled();
    expect(previewEventTemplateById).not.toHaveBeenCalled();
  });

  it("toasts a generic message when preview fails outside the API layer", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    previewEventTemplateById.mockRejectedValue(new Error("network unavailable"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Preview failed/);
    });
  });

  it("Send tab's own preview (separate route/mocks from the Templates tab) has the same working Light/Dark toggle", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    previewEventTemplate.mockResolvedValue({ subject: "Inherited subject", html: "<p>Inherited</p>" });

    renderSendPage();

    const frame = await screen.findByTitle<HTMLIFrameElement>("Email preview");

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(frame.closest(".communication-mail-client")?.className).toContain("communication-mail-client--dark");
    expect(frame.className).toContain("communication-preview-frame--dark-sim");
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
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not load template/);
    });
  });

  it("toasts a generic message when template switch fails outside the API layer", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    fetchEventTemplateById.mockRejectedValueOnce(new Error("network unavailable"));
    fireEvent.click(screen.getByRole("button", { name: /^Template,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reminder" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not load template/);
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
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Save failed/);
    });
  });

  it("toasts a generic message when save fails outside the API layer", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Updated ticket subject" } });
    saveEventTemplateById.mockRejectedValueOnce(new Error("network unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Save failed/);
    });
  });

  it("toasts a success message after saving a template", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Updated ticket subject" } });
    saveEventTemplateById.mockResolvedValueOnce({
      ...ticketRow,
      subject_template: "Updated ticket subject",
      body_template: "<p>Body</p>",
      compiled_html_template: "<p>Body</p>",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Template saved/);
    });
  });

  it("renders inline validation errors returned by save", async () => {
    const { TemplateValidationError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Updated ticket subject" } });
    saveEventTemplateById.mockRejectedValueOnce(
      new TemplateValidationError(["Subject must include {{ticket_url}}"]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    expect(
      await screen.findByText("Subject must include {{ticket_url}}", {}, { timeout: 2000 }),
    ).toBeTruthy();
  });

  it("shows the shared-default banner on the Send tab", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("tab", { name: /Email/i }));
    await screen.findByRole("tab", { name: /Email/i, selected: true });

    expect(
      await screen.findByText(/This event has no template of its own yet/),
    ).toBeTruthy();
  });

  it("lets the operator cancel out of creating an override for the shared default template", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "New subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));

    expect(
      await screen.findByText(/This will create an event-specific template override/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText(/This will create an event-specific template override/)).toBeNull();
    });
  });

  it("creates an event override for the shared default template on confirm", async () => {
    const { saveEventTemplate } = await import("../../src/api/client.js");
    fetchEventTemplates.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "New subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    await screen.findByText(/This will create an event-specific template override/);

    saveEventTemplate.mockResolvedValueOnce(undefined);
    fetchEventTemplates.mockResolvedValueOnce([ticketRow]);
    fetchEventTemplateById.mockResolvedValueOnce({
      ...ticketRow,
      body_template: "<p>Body</p>",
      compiled_html_template: "<p>Body</p>",
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(saveEventTemplate).toHaveBeenCalledWith("evt-comm", expect.objectContaining({ subject_template: "New subject" }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Template saved/);
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

  it("keeps reporting the address a test send actually used after the field is edited again", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    testSendEventTemplateById.mockResolvedValueOnce({ status: "sent" });

    renderPage();
    const email = await screen.findByLabelText("Recipient");
    fireEvent.change(email, { target: { value: "first@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Test email sent.")).toBeTruthy();
    expect(screen.getByText(/to first@example\.com/)).toBeTruthy();

    fireEvent.change(email, { target: { value: "second@example.com" } });

    expect(screen.getByText(/to first@example\.com/)).toBeTruthy();
    expect(screen.queryByText(/to second@example\.com/)).toBeNull();
  });

  it("loads the remaining ticket template after deleting the active non-ticket template", async () => {
    deleteEventTemplate.mockResolvedValue(undefined);
    fetchEventTemplates
      .mockResolvedValueOnce([ticketRow, reminderRow])
      .mockResolvedValueOnce([ticketRow]);

    await renderTemplatesTab();
    await selectTemplate("Reminder");
    expect(await screen.findByDisplayValue("Reminder subject")).toBeTruthy();

    await deleteActiveTemplateViaModal();

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
    await deleteActiveTemplateViaModal();

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

    await renderTemplatesTab();

    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    await deleteActiveTemplateViaModal();

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
      expect(isOff(screen.getByRole("button", { name: "Saved" }))).toBe(true);
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

    await renderTemplatesTab();

    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    await deleteActiveTemplateViaModal();

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

    await deleteActiveTemplateViaModal();

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

    await renderAndSelect("Announcement", "Announcement subject");

    await deleteActiveTemplateViaModal();

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

    await renderAndSelect("Announcement", "Announcement subject");

    await deleteActiveTemplateViaModal();

    await waitFor(() => {
      expect(screen.getByText("Delete failed.")).toBeTruthy();
      expect(screen.queryByText("some_new_code")).toBeNull();
    });
  });

  it("says nothing about a delete that fails after the event was switched", async () => {
    mockTwoEvents();
    const deletion = deferred<void>();
    deleteEventTemplate.mockReturnValueOnce(deletion.promise);
    renderPageWithEventSwitch();
    await screen.findByDisplayValue("Ticket");
    await selectTemplate("Reminder");
    await screen.findByDisplayValue("Reminder subject");
    await deleteActiveTemplateViaModal();
    await waitFor(() => expect(deleteEventTemplate).toHaveBeenCalledWith("evt-a", "tpl-rem"));

    await switchToEventB();
    await act(async () => deletion.reject(new Error("network down")));

    expect(screen.queryByText("Delete failed.")).toBeNull();
    expect(screen.getByRole("button", { name: "New template" }).hasAttribute("disabled")).toBe(false);
  });

  it("still says a delete failed when the operator has only left the page for another page of the same event", async () => {
    mockTwoEvents();
    const deletion = deferred<void>();
    deleteEventTemplate.mockReturnValueOnce(deletion.promise);
    renderPageWithLeaveLink();
    await screen.findByDisplayValue("Ticket");
    await selectTemplate("Reminder");
    await screen.findByDisplayValue("Reminder subject");
    await deleteActiveTemplateViaModal();
    await waitFor(() => expect(deleteEventTemplate).toHaveBeenCalledWith("evt-a", "tpl-rem"));

    fireEvent.click(screen.getByRole("link", { name: "Leave page" }));
    expect(await screen.findByText("Elsewhere")).toBeTruthy();
    await act(async () => deletion.reject(new Error("network down")));

    expect(await screen.findByText("Delete failed.")).toBeTruthy();
  });

  it.each([
    ["succeeds", "Template saved."],
    ["fails", "Save failed."],
  ] as const)("says nothing about a Save that %s after the event was switched", async (outcome, message) => {
    mockTwoEvents();
    const saved = deferred<unknown>();
    saveEventTemplateById.mockReturnValueOnce(saved.promise);
    renderPageWithEventSwitch();
    await screen.findByLabelText("Subject");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited ticket subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    await waitFor(() => expect(saveEventTemplateById).toHaveBeenCalledWith("evt-a", "tpl-ticket", expect.anything()));

    await switchToEventB();
    await act(async () => {
      if (outcome === "succeeds") saved.resolve({ ...ticketRow, subject_template: "Edited ticket subject", body_template: "<p>Hi</p>" });
      else saved.reject(new Error("network down"));
    });

    expect(screen.queryByText(message)).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it.each([
    ["succeeds", "Template saved."],
    ["fails", "Save failed."],
  ] as const)("still says a Save %s when the operator has only left the page for another page of the same event", async (outcome, message) => {
    mockTwoEvents();
    const saved = deferred<unknown>();
    saveEventTemplateById.mockReturnValueOnce(saved.promise);
    renderPageWithLeaveLink();
    await screen.findByLabelText("Subject");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited ticket subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    await waitFor(() => expect(saveEventTemplateById).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("link", { name: "Leave page" }));
    expect(await screen.findByText("Elsewhere")).toBeTruthy();
    await act(async () => {
      if (outcome === "succeeds") saved.resolve({ ...ticketRow, subject_template: "Edited ticket subject", body_template: "<p>Hi</p>" });
      else saved.reject(new Error("network down"));
    });

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("still says a Save failed when the operator has left for a page that belongs to no event", async () => {
    mockTwoEvents();
    const saved = deferred<unknown>();
    saveEventTemplateById.mockReturnValueOnce(saved.promise);
    renderPageWithLeaveLink("/admin/users");
    await screen.findByLabelText("Subject");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited ticket subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    await waitFor(() => expect(saveEventTemplateById).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("link", { name: "Leave page" }));
    expect(await screen.findByText("Elsewhere")).toBeTruthy();
    await act(async () => saved.reject(new Error("network down")));

    expect(await screen.findByText("Save failed.")).toBeTruthy();
  });

  it.each([
    ["succeeds", "Template saved."],
    ["fails", "Save failed."],
  ] as const)("says nothing about a Save that %s after the operator went straight to a page of another event", async (outcome, message) => {
    mockTwoEvents();
    const saved = deferred<unknown>();
    saveEventTemplateById.mockReturnValueOnce(saved.promise);
    renderPageWithLinkToAnotherEventsPage();
    await screen.findByLabelText("Subject");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited ticket subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Save *" }));
    await waitFor(() => expect(saveEventTemplateById).toHaveBeenCalledWith("evt-a", "tpl-ticket", expect.anything()));

    fireEvent.click(screen.getByRole("link", { name: "Go to event B" }));
    expect(await screen.findByText("Elsewhere")).toBeTruthy();
    await act(async () => {
      if (outcome === "succeeds") saved.resolve({ ...ticketRow, subject_template: "Edited ticket subject", body_template: "<p>Hi</p>" });
      else saved.reject(new Error("network down"));
    });

    expect(screen.queryByText(message)).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("says nothing about a delete that fails after the operator went straight to a page of another event", async () => {
    mockTwoEvents();
    const deletion = deferred<void>();
    deleteEventTemplate.mockReturnValueOnce(deletion.promise);
    renderPageWithLinkToAnotherEventsPage();
    await screen.findByDisplayValue("Ticket");
    await selectTemplate("Reminder");
    await screen.findByDisplayValue("Reminder subject");
    await deleteActiveTemplateViaModal();
    await waitFor(() => expect(deleteEventTemplate).toHaveBeenCalledWith("evt-a", "tpl-rem"));

    fireEvent.click(screen.getByRole("link", { name: "Go to event B" }));
    expect(await screen.findByText("Elsewhere")).toBeTruthy();
    await act(async () => deletion.reject(new Error("network down")));

    expect(screen.queryByText("Delete failed.")).toBeNull();
  });

  it("says nothing about a template that could not be opened after the event was switched", async () => {
    mockTwoEvents();
    const opening = deferred<unknown>();
    renderPageWithEventSwitch();
    await screen.findByDisplayValue("Ticket");
    fetchEventTemplateById.mockReturnValueOnce(opening.promise as never);
    await selectTemplate("Reminder");

    await switchToEventB();
    await act(async () => opening.reject(new Error("network down")));

    expect(screen.queryByText("Could not load template.")).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("says nothing about a template that could not be created after the event was switched", async () => {
    mockTwoEvents();
    const creation = deferred<unknown>();
    createEventTemplate.mockReturnValueOnce(creation.promise);
    renderPageWithEventSwitch();
    await screen.findByDisplayValue("Ticket");
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    const dialog = await screen.findByRole("dialog", { name: "New template" });
    fireEvent.change(within(dialog).getByLabelText("Template label"), { target: { value: "Announcement" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createEventTemplate).toHaveBeenCalledTimes(1));

    await switchToEventB();
    await act(async () => creation.reject(new Error("network down")));

    expect(screen.queryByText("Create failed.")).toBeNull();
    expect(screen.getByRole("button", { name: "New template" }).hasAttribute("disabled")).toBe(false);
  });

  it("says nothing about a preview that fails after the event was switched", async () => {
    mockTwoEvents();
    const preview = deferred<unknown>();
    previewEventTemplateById.mockImplementation((eventId: string) =>
      eventId === "evt-a" ? preview.promise : Promise.resolve({ subject: "", html: "<p></p>" }),
    );
    renderPageWithEventSwitch();
    await waitFor(() => expect(previewEventTemplateById).toHaveBeenCalledWith("evt-a", "tpl-ticket", expect.anything()), {
      timeout: 3_000,
    });

    await switchToEventB();
    await act(async () => preview.reject(new Error("network down")));

    expect(screen.queryByText("Preview failed.")).toBeNull();
  });

  it("ignores a stale metadata save after switching events mid-flight", async () => {
    let resolvePatch!: (value: unknown) => void;
    updateEventTemplateMetadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    fetchEventTemplates.mockImplementation(async (id: string) => {
      if (id === "evt-a") return [ticketRow, reminderRow];
      return [{ ...ticketRow, id: "tpl-ticket-b", label: "Ticket B" }];
    });
    fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
      if (id === "tpl-rem") {
        return { ...reminderRow, body_template: "<mjml></mjml>" };
      }
      if (id === "tpl-ticket-b") {
        return { ...ticketRow, id: "tpl-ticket-b", label: "Ticket B", body_template: "<mjml></mjml>" };
      }
      return { ...ticketRow, body_template: "<mjml></mjml>" };
    });

    renderPageWithEventSwitch();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
    const editDialog = await screen.findByRole("dialog", { name: "Edit template" });
    fireEvent.change(within(editDialog).getByLabelText("Template label"), {
      target: { value: "Final reminder" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    expect(updateEventTemplateMetadata).toHaveBeenCalledWith("evt-a", "tpl-rem", {
      label: "Final reminder",
      icon: null,
      description: null,
    });

    fireEvent.click(screen.getByRole("link", { name: "Switch event" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Template, Ticket B" })).toBeTruthy();
    });

    await act(async () => {
      resolvePatch({
        ...reminderRow,
        label: "Final reminder",
        icon: "clock",
        description: null,
      });
    });

    expect(screen.queryByText("Template updated.")).toBeNull();
    expect(screen.getByRole("button", { name: "Template, Ticket B" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Template, Final reminder" })).toBeNull();
  });

  it("ignores a stale metadata failure after switching events mid-flight", async () => {
    let rejectPatch!: (err: Error) => void;
    updateEventTemplateMetadata.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPatch = reject;
        }),
    );
    fetchEventTemplates.mockImplementation(async (id: string) => {
      if (id === "evt-a") return [ticketRow, reminderRow];
      return [{ ...ticketRow, id: "tpl-ticket-b", label: "Ticket B" }];
    });
    fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
      if (id === "tpl-rem") {
        return { ...reminderRow, body_template: "<mjml></mjml>" };
      }
      if (id === "tpl-ticket-b") {
        return { ...ticketRow, id: "tpl-ticket-b", label: "Ticket B", body_template: "<mjml></mjml>" };
      }
      return { ...ticketRow, body_template: "<mjml></mjml>" };
    });

    renderPageWithEventSwitch();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Reminder subject")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
    const editDialog = await screen.findByRole("dialog", { name: "Edit template" });
    // Save is disabled on a clean load - dirty the field so it becomes clickable.
    fireEvent.change(within(editDialog).getByLabelText("Template label"), {
      target: { value: "Reminder!" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    fireEvent.click(screen.getByRole("link", { name: "Switch event" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Template, Ticket B" })).toBeTruthy();
    });

    await act(async () => {
      rejectPatch(new Error("network down"));
    });

    expect(screen.queryByText("Update failed.")).toBeNull();
  });

  it("disables content Save while a metadata save is in flight", async () => {
    updateEventTemplateMetadata.mockImplementation(() => new Promise(() => {}));
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);

    await renderAndSelect("Reminder", "Reminder subject");

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited reminder" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
    const editDialog = await screen.findByRole("dialog", { name: "Edit template" });
    // The metadata dialog's own Save is disabled on a clean load - dirty its field so it
    // becomes clickable (separate from the content Subject field dirtied above).
    fireEvent.change(within(editDialog).getByLabelText("Template label"), {
      target: { value: "Reminder!" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(within(editDialog).getByRole("button", { name: "Save" }).getAttribute("aria-busy")).toBe("true");
    });

    const saveBtn = screen.getByRole("button", { name: "Save *" });
    expect(isOff(saveBtn)).toBe(true);
  });

  it("discards unsaved changes and lets the blocked navigation proceed", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });

    blockerState.state = "blocked";
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Ignored" } });

    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(blockerState.proceed).toHaveBeenCalled();
  });

  it("keeps editing and resets the blocked navigation", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });

    blockerState.state = "blocked";
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Ignored" } });

    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(blockerState.reset).toHaveBeenCalled();
  });

  it("switches from the Send tab to Templates via the tab bar", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderSendPage();

    await screen.findByRole("tab", { name: /Email/i, selected: true });
    fireEvent.click(screen.getByRole("tab", { name: /Templates/i }));
    expect(await screen.findByLabelText("Subject")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
  });

  it("shows the configured sender address and Updating status while preview refreshes", async () => {
    let resolvePreview: ((value: unknown) => void) | undefined;
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    fetchEventMailSettings.mockResolvedValue({
      fields: {
        fromName: { value: "Admitto Mailer" },
        fromAddress: { value: "tickets@example.com" },
      },
    });
    previewEventTemplateById
      .mockResolvedValueOnce({ subject: "Hello", html: "<p>First</p>" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePreview = resolve;
          }),
      );

    renderPage();
    expect(await screen.findByText(/tickets@example\.com/)).toBeTruthy();
    expect(screen.getByText("Admitto Mailer")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited subject" } });
    expect(await screen.findByText(/Updating/)).toBeTruthy();
    await act(async () => {
      resolvePreview?.({ subject: "Edited subject", html: "<p>Second</p>" });
      await Promise.resolve();
    });
  });

  it("renders QR, wallet, and custom image placeholder chips with their tooltips", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    fetchEventTemplate.mockResolvedValueOnce({
      ...legacyTemplate,
      allowed_placeholders: [
        "first_name",
        "qr_image_url",
        "apple_wallet_url",
        "google_wallet_url",
        "sponsor_banner",
        "mystery_token",
      ],
      image_placeholders: ["qr_image_url", "sponsor_banner"],
      required_url_placeholders: [],
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "{{qr_image_url}}" })).toBeTruthy();
    });

    expect(screen.getByText("Images")).toBeTruthy();
    expect(getTooltipText(screen.getByRole("button", { name: "{{sponsor_banner}}" }))).toBe(
      "Custom image asset for this event.",
    );
    expect(getTooltipText(screen.getByRole("button", { name: "{{mystery_token}}" }))).toBe(
      "{{mystery_token}}",
    );
    expect(getTooltipText(screen.getByRole("button", { name: "{{apple_wallet_url}}" }))).toBe(
      "Link to add the ticket to Apple Wallet.",
    );
    fireEvent.click(screen.getByRole("button", { name: "{{qr_image_url}}" }));
    fireEvent.click(screen.getByRole("button", { name: "{{apple_wallet_url}}" }));
  });

  it("no-ops when the already-selected format radio is clicked again", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("HTML body")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("radio", { name: "HTML" }));
    expect(screen.getByLabelText("HTML body")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch format" })).toBeNull();
  });

  it("reports the previewed subject on a clean test send and hides it while dirty", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    previewEventTemplateById.mockResolvedValue({ subject: "Saved subject", html: "<p>Hi</p>" });
    testSendEventTemplateById.mockResolvedValue({ status: "sent" });

    renderPage();
    const email = await screen.findByLabelText("Recipient");
    fireEvent.change(email, { target: { value: "ops@example.com" } });
    expect(await screen.findByText("Saved subject")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Test email sent.")).toBeTruthy();
    expect(within(screen.getByRole("status")).getByText("Saved subject")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Dirty subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Test email sent.")).toBeTruthy();
    expect(within(screen.getByRole("status")).queryByText("Subject")).toBeNull();
  });

  it("uses the named template label, a generic failed message, and a non-API error path on test send", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
    testSendEventTemplateById
      .mockResolvedValueOnce({ status: "failed" })
      .mockRejectedValueOnce(new Error("network down"));

    renderPage();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Ticket")).toBeTruthy();
    });
    await selectTemplate("Reminder");
    const email = await screen.findByLabelText("Recipient");
    fireEvent.change(email, { target: { value: "ops@example.com" } });

    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Send failed.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Send failed.")).toBeTruthy();
  });

  it("test-sends the inherited virtual ticket template by name", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    testSendEventTemplate.mockResolvedValue({ status: "sent" });

    renderPage();
    const email = await screen.findByLabelText("Recipient");
    fireEvent.change(email, { target: { value: "ops@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Test email sent.")).toBeTruthy();
    expect(testSendEventTemplate).toHaveBeenCalled();
    expect(within(screen.getByRole("status")).getByText("Ticket email")).toBeTruthy();
  });

  it("ignores stale preview responses when switching templates mid-flight", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
    previewEventTemplateById.mockImplementation(((_eventId: string, id: string) => {
      if (id === "tpl-ticket") {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ subject: "Reminder preview", html: "<p>Rem</p>" });
    }) as typeof previewEventTemplateById);

    renderPage();
    await waitFor(() => {
      expect(previewEventTemplateById).toHaveBeenCalled();
    });
    await selectTemplate("Reminder");
    expect(await screen.findByText("Reminder preview")).toBeTruthy();
    await act(async () => {
      resolveFirst?.({ subject: "Stale ticket", html: "<p>Stale</p>" });
      await Promise.resolve();
    });
    expect(screen.queryByText("Stale ticket")).toBeNull();
  });

  it("ignores stale preview failures when a newer preview has already started", async () => {
    let rejectFirst: ((reason?: unknown) => void) | undefined;
    fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
    previewEventTemplateById.mockImplementation(((_eventId: string, id: string) => {
      if (id === "tpl-ticket") {
        return new Promise((_, reject) => {
          rejectFirst = reject;
        });
      }
      return Promise.resolve({ subject: "Reminder preview", html: "<p>Rem</p>" });
    }) as typeof previewEventTemplateById);

    renderPage();
    await waitFor(() => {
      expect(previewEventTemplateById).toHaveBeenCalled();
    });
    await selectTemplate("Reminder");
    expect(await screen.findByText("Reminder preview")).toBeTruthy();
    await act(async () => {
      rejectFirst?.(new Error("stale fail"));
      await Promise.resolve();
    });
    expect(screen.queryByText("Preview failed.")).toBeNull();
    expect(screen.getByText("Reminder preview")).toBeTruthy();
  });

  it("reloads Send-tab preview after switching events with the same active template key", async () => {
    fetchEventTemplates.mockImplementation(async (id: string) => {
      if (id === "evt-a") return [ticketRow];
      return [{ ...ticketRow, id: "tpl-ticket-b", label: "Ticket B" }];
    });
    fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
      if (id === "tpl-ticket-b") {
        return { ...ticketRow, id: "tpl-ticket-b", label: "Ticket B", body_template: "<mjml></mjml>" };
      }
      return { ...ticketRow, body_template: "<mjml></mjml>" };
    });
    previewEventTemplateById.mockImplementation(async (eventId: string) => {
      if (eventId === "evt-a") return { subject: "Preview A", html: "<p>A</p>" };
      return { subject: "Preview B", html: "<p>B</p>" };
    });

    renderSendPageWithEventSwitch();

    expect(await screen.findByText("Preview A")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Switch event" }));

    await waitFor(() => {
      expect(screen.getByText("Preview B")).toBeTruthy();
    });
    expect(screen.queryByText("Preview A")).toBeNull();
  });

  it("drops an in-flight preview that resolves after switching events", async () => {
    let resolveA: ((value: unknown) => void) | undefined;
    fetchEventTemplates.mockImplementation(async (id: string) => {
      if (id === "evt-a") return [ticketRow];
      return [{ ...ticketRow, id: "tpl-ticket-b", label: "Ticket B" }];
    });
    fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => {
      if (id === "tpl-ticket-b") {
        return { ...ticketRow, id: "tpl-ticket-b", label: "Ticket B", body_template: "<mjml></mjml>" };
      }
      return { ...ticketRow, body_template: "<mjml></mjml>" };
    });
    previewEventTemplateById.mockImplementation((eventId: string) => {
      if (eventId === "evt-a") {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve({ subject: "Preview B", html: "<p>B</p>" });
    });

    renderSendPageWithEventSwitch();
    await waitFor(() => {
      expect(previewEventTemplateById).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("link", { name: "Switch event" }));
    expect(await screen.findByText("Preview B")).toBeTruthy();

    await act(async () => {
      resolveA?.({ subject: "Stale Preview A", html: "<p>Stale A</p>" });
      await Promise.resolve();
    });

    expect(screen.queryByText("Stale Preview A")).toBeNull();
    expect(screen.getByText("Preview B")).toBeTruthy();
  });

  it("keeps bulk-send polling alive when switching away from the Send tab", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    sendEventBulk.mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
    fetchBulkSendStatus
      .mockResolvedValueOnce({ queued: 2, sent: 0, failed: 0, cancelled: 0 })
      .mockResolvedValueOnce({ queued: 0, sent: 2, failed: 0, cancelled: 0 });

    renderSendPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchBulkSendStatus).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("tab", { name: /Templates/i }));
      expect(screen.getByRole("tab", { name: /Templates/i, selected: true })).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(fetchBulkSendStatus).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByRole("tab", { name: /Email/i }));
      expect(screen.getByRole("tab", { name: /Email/i, selected: true })).toBeTruthy();
      expect(screen.getByText("Send complete")).toBeTruthy();
      expect(screen.getByText("2 sent · 0 failed out of 2 total")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("previews the saved template on the Send tab, not an unsaved Templates draft", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    previewEventTemplateById.mockImplementation(async (_eventId: string, _id: string, body: {
      subject_template?: string;
      body_template?: string;
    }) => ({
      subject: body.subject_template ?? "missing",
      html: `<p>${body.body_template ?? ""}</p>`,
    }));

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });
    // Templates-tab draft preview should see the dirty subject.
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Unsaved draft subject" } });
    await waitFor(
      () => {
        expect(screen.getByText("Unsaved draft subject")).toBeTruthy();
      },
      { timeout: 2000 },
    );

    const callsBeforeSend = previewEventTemplateById.mock.calls.length;
    fireEvent.click(screen.getByRole("tab", { name: /Email/i }));
    await screen.findByRole("tab", { name: /Email/i, selected: true });

    await waitFor(() => {
      expect(previewEventTemplateById.mock.calls.length).toBeGreaterThan(callsBeforeSend);
    });
    const sendPreviewCall = previewEventTemplateById.mock.calls.at(-1);
    expect(sendPreviewCall?.[2]).toEqual(
      expect.objectContaining({
        subject_template: "Ticket",
        body_template: "<p>Ticket</p>",
      }),
    );
    expect(await screen.findByText("Ticket", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Unsaved draft subject")).toBeNull();
  });

  it("aborts in-flight overview and mail-settings fetches on unmount", async () => {
    let resolveMail: ((value: unknown) => void) | undefined;
    let rejectMail: ((reason?: unknown) => void) | undefined;
    let rejectOverview: ((reason?: unknown) => void) | undefined;
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    fetchEventOverview.mockImplementation(
      (_eventId: string, signal?: AbortSignal) =>
        new Promise((_, reject) => {
          rejectOverview = reject;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    fetchEventMailSettings
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMail = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectMail = reject;
          }),
      );

    const first = renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });
    first.unmount();
    await act(async () => {
      resolveMail?.({
        fields: { fromName: { value: "Late" }, fromAddress: { value: "late@example.com" } },
      });
      await Promise.resolve();
    });

    // Second mount: overview rejects with a non-AbortError after abort so the
    // `ac.signal.aborted` guard (not just the AbortError instanceof check) is exercised.
    fetchEventOverview.mockImplementation(
      (_eventId: string, signal?: AbortSignal) =>
        new Promise((_, reject) => {
          rejectOverview = reject;
          signal?.addEventListener("abort", () => {
            queueMicrotask(() => reject(new Error("late overview")));
          });
        }),
    );
    const second = renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toBeTruthy();
    });
    second.unmount();
    await act(async () => {
      rejectMail?.(new Error("gone"));
      rejectOverview?.(new Error("late overview"));
      await Promise.resolve();
    });
  });
});

describe("recoverLegacyAfterDelete", () => {
  it("warns to reload when there is no cached inherited ticket to fall back to", async () => {
    fetchEventTemplate.mockRejectedValueOnce(new Error("gone"));
    const applyLegacyTemplate = vi.fn();
    const setActiveKey = vi.fn();
    const addToast = vi.fn();

    await recoverLegacyAfterDelete({
      scopeEventId: "evt-1",
      seq: 1,
      deleteTemplateSeqRef: { current: 1 },
      currentEventIdRef: { current: "evt-1" },
      legacyTemplateRef: { current: null },
      applyLegacyTemplate,
      setActiveKey,
      addToast,
    });

    expect(applyLegacyTemplate).not.toHaveBeenCalled();
    expect(setActiveKey).toHaveBeenCalledWith("virtual-ticket");
    expect(addToast).toHaveBeenCalledWith(
      "Template deleted. Could not load default ticket. Reload the page.",
      "warning",
    );
  });
});

describe("resolveTestSendTemplateLabel", () => {
  it("falls back to Template when the active id is no longer in the list", () => {
    expect(resolveTestSendTemplateLabel("virtual-ticket", [])).toBe("Ticket email");
    expect(resolveTestSendTemplateLabel("tpl-missing", [{ id: "tpl-other", label: "Other" }])).toBe(
      "Template",
    );
  });
});

function renderSendTab() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-comm/communication?tab=send"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CommunicationPage Send tab template description", () => {
  it("shows the built-in default description for the virtual ticket template", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    renderSendTab();

    expect(
      await screen.findByText(
        "The built-in ticket confirmation email. Used as the fallback when you send until this event saves its own override.",
      ),
    ).toBeTruthy();
  });

  it("shows a saved template's own description", async () => {
    fetchEventTemplates.mockResolvedValue([
      { ...reminderRow, description: "Sent 24h before the event to confirmed attendees." },
    ]);
    renderSendTab();

    await screen.findByRole("button", { name: /^Template,/ });
    await selectTemplate("Reminder");
    expect(
      await screen.findByText("Sent 24h before the event to confirmed attendees."),
    ).toBeTruthy();
  });

  it("shows nothing when a saved template has no description", async () => {
    fetchEventTemplates.mockResolvedValue([reminderRow]);
    renderSendTab();

    await screen.findByRole("button", { name: /^Template,/ });
    await selectTemplate("Reminder");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Template, Reminder" })).toBeTruthy();
    });
    expect(screen.queryByText(/^Sent 24h before/)).toBeNull();
    expect(
      screen.queryByText(
        "The built-in ticket confirmation email. Used as the fallback when you send until this event saves its own override.",
      ),
    ).toBeNull();
  });
});

describe("CommunicationPage Send tab preview reload", () => {
  it("keeps the mail-client chrome (last preview) mounted while a new one loads after switching templates, instead of flashing empty", async () => {
    fetchEventTemplates.mockResolvedValue([reminderRow, announcementRow]);
    let resolveAnnouncementPreview: ((value: unknown) => void) | undefined;
    previewEventTemplateById.mockImplementation(async (_eventId: string, templateId: string) => {
      if (templateId === "tpl-rem") {
        return { subject: "Reminder preview subject", html: "<p>Reminder body</p>" };
      }
      return new Promise((resolve) => {
        resolveAnnouncementPreview = resolve;
      });
    });

    renderSendTab();
    await screen.findByRole("button", { name: /^Template,/ });
    await selectTemplate("Reminder");
    await screen.findByText("Reminder preview subject");

    await selectTemplate("Announcement");
    await waitFor(() => expect(resolveAnnouncementPreview).toBeDefined());

    // The new preview is still in flight - the last successful one stays on screen (stale but
    // not wrong) instead of the whole mail-client card unmounting to an empty/loading placeholder
    // and remounting once the fetch resolves (the bug: "cały podgląd miga" on template switch).
    expect(screen.getByText("Reminder preview subject")).toBeTruthy();
    expect(screen.queryByText("Preview will appear here.")).toBeNull();
    expect(await screen.findByText(/Updating…/)).toBeTruthy();

    resolveAnnouncementPreview?.({ subject: "Announcement preview subject", html: "<p>Ann body</p>" });
    expect(await screen.findByText("Announcement preview subject")).toBeTruthy();
  });
});

describe("CommunicationPage first load on the loading standard", () => {
  const placeholder = () => screen.queryByRole("status", { name: "Loading communication" });

  it("draws the open tab's cards after 200ms, says it is taking longer after 8 seconds and ends in an error with a Retry after 30", async () => {
    fetchEventTemplates.mockImplementation(hangUntilAborted);
    vi.useFakeTimers();
    try {
      renderPage();
      expect(placeholder()?.className).toContain("at-loading-hold");
      await advanceTimers(200);
      expect(placeholder()?.className).not.toContain("at-loading-hold");
      expect(placeholder()?.textContent).not.toContain("Taking longer than usual");
      await advanceTimers(7_800);
      expect(placeholder()?.textContent).toContain("Taking longer than usual");

      await advanceTimers(22_000);
      await advanceTimers(0);
      expect(placeholder()).toBeNull();
      expect(screen.getByText("Could not load template")).toBeTruthy();
      expect(screen.getByText(/The server did not answer in time/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Templates", selected: true })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the error on screen with a busy Retry until the answer is in, then moves the focus to the open tab", async () => {
    fetchEventTemplates.mockRejectedValueOnce(new Error("network down"));
    renderPage();
    const retry = await screen.findByRole("button", { name: "Retry" });
    retry.focus();
    const answer = deferred<unknown>();
    fetchEventTemplates.mockReturnValueOnce(answer.promise);

    fireEvent.click(retry);
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(placeholder()).toBeNull();
    fireEvent.click(retry);
    expect(fetchEventTemplates).toHaveBeenCalledTimes(2);

    await act(async () => answer.resolve([ticketRow]));
    expect(await screen.findByLabelText("Subject")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tab", { name: /^Templates/, selected: true })));
  });

  it("leaves the focus alone when it is on a tab, not on the Retry that worked", async () => {
    fetchEventTemplates.mockRejectedValueOnce(new Error("network down"));
    renderPage();
    await screen.findByRole("button", { name: "Retry" });
    const walletsTab = screen.getByRole("tab", { name: "Wallets" });
    walletsTab.focus();
    fetchEventTemplates.mockResolvedValueOnce([ticketRow]);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Subject")).toBeTruthy();
    await act(async () => {});
    expect(document.activeElement).toBe(walletsTab);
  });

  it("does not pull the focus to the page when it was on nothing (a click that did not focus the Retry) while the Retry worked", async () => {
    fetchEventTemplates.mockRejectedValueOnce(new Error("network down"));
    renderPage();
    await screen.findByRole("button", { name: "Retry" });
    (document.activeElement as HTMLElement | null)?.blur();
    fetchEventTemplates.mockResolvedValueOnce([ticketRow]);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Subject")).toBeTruthy();
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
  });

  it("still says the viewer has no access for a 403, with the server's wording hidden", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockRejectedValueOnce(new ApiError(403, "forbidden_internal", "forbidden_internal"));
    renderPage();

    expect(await screen.findByText("You do not have access to this event")).toBeTruthy();
    expect(screen.getByText("You do not have access to this event.")).toBeTruthy();
    expect(screen.queryByText(/forbidden_internal/)).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("keeps the no-access wording while a Retry runs, and changes it only when the answer is in", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventTemplates.mockRejectedValueOnce(new ApiError(403, "forbidden_internal", "forbidden_internal"));
    renderPage();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("You do not have access to this event")).toBeTruthy();
    const answer = deferred<unknown>();
    fetchEventTemplates.mockReturnValueOnce(answer.promise);

    fireEvent.click(retry);
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByText("You do not have access to this event")).toBeTruthy();
    expect(screen.getByText("You do not have access to this event.")).toBeTruthy();
    expect(screen.queryByText("Could not load template")).toBeNull();

    await act(async () => answer.reject(new ApiError(500, "secret_internal")));
    expect(await screen.findByText("Could not load template")).toBeTruthy();
    expect(screen.queryByText("You do not have access to this event")).toBeNull();
  });

  it.each([
    ["is on its way", () => fetchEventTemplates.mockImplementation(hangUntilAborted)],
    ["has failed", () => fetchEventTemplates.mockRejectedValue(new Error("network down"))],
  ] as const)("does not preview the blank draft of a page whose read %s", async (state, arrange) => {
    arrange();
    vi.useFakeTimers();
    try {
      renderPage();
      // Let a failed read settle, then give the debounce of the preview more than its 500ms.
      await advanceTimers(0);
      await advanceTimers(1_500);
      if (state === "has failed") expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(previewEventTemplate).not.toHaveBeenCalled();
      expect(previewEventTemplateById).not.toHaveBeenCalled();
      expect(screen.queryByText("Preview failed.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["send", ["Email message", "Send to"]],
    ["wallets", ["Message", "Preview", "Send to"]],
    ["templates", ["", "Ticket template", "Send test"]],
    ["log", ["Delivery log"]],
  ] as const)("draws the cards of the %s tab, as the real tab lays them out, while the page's first read is on its way", async (tab, titles) => {
    fetchEventTemplates.mockImplementation(hangUntilAborted);
    vi.useFakeTimers();
    try {
      renderPageOnTab(tab);
      await advanceTimers(200);
      const cards = [...placeholder()!.querySelectorAll(".at-card")];
      expect(cards.map((card) => card.querySelector(".at-card__title")?.textContent ?? "")).toEqual([...titles]);
      expect(screen.getByRole("tab", { name: /^Email/, selected: tab === "send" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws the message and its preview of the Wallets tab side by side, with the notice's room between them and the Send to card", async () => {
    fetchEventTemplates.mockImplementation(hangUntilAborted);
    vi.useFakeTimers();
    try {
      renderPageOnTab("wallets");
      await advanceTimers(200);
      const region = placeholder()!;
      const split = region.querySelector(".communication-templates-split");
      expect([...(split?.querySelectorAll(".at-card__title") ?? [])].map((title) => title.textContent)).toEqual(["Message", "Preview"]);
      const children = [...region.children].map((child) => (child.matches(".at-card") ? "card" : child.className || child.tagName));
      expect(children).toEqual(["communication-templates-split", "DIV", "card"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a fresh page for another event: the first event's editor is gone and the placeholder is drawn", async () => {
    fetchEventTemplates.mockImplementation(((id: string) => (id === "evt-a" ? Promise.resolve([ticketRow]) : new Promise(() => {}))) as never);
    renderPageWithEventSwitch();
    await screen.findByLabelText("Subject");

    fireEvent.click(screen.getByRole("link", { name: "Switch event" }));
    await waitFor(() => expect(screen.queryByLabelText("Subject")).toBeNull());
    expect(placeholder()).not.toBeNull();
  });

  it("titles the editor's fallback like the editor does: 'Ticket template' for the ticket, 'Template' for another one", () => {
    const { unmount } = renderWithToast(<TemplateEditorFallback />);
    expect(screen.getByText("Ticket template")).toBeTruthy();
    unmount();
    renderWithToast(<TemplateEditorFallback ticket={false} />);
    expect(screen.getByText("Template")).toBeTruthy();
    expect(screen.queryByText("Ticket template")).toBeNull();
  });

  it("shows the template editor's fallback as grey shapes of the card, held for 200ms, with the slow note after 8 seconds", async () => {
    vi.useFakeTimers();
    try {
      renderWithToast(<TemplateEditorFallback />);
      const region = () => screen.getByRole("status", { name: "Loading editor" });
      expect(region().className).toContain("at-loading-hold");
      expect(screen.getByText("Ticket template")).toBeTruthy();
      await advanceTimers(200);
      expect(region().className).not.toContain("at-loading-hold");
      await advanceTimers(7_800);
      expect(region().textContent).toContain("Taking longer than usual");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CommunicationPage Save and Send test on the loading standard", () => {
  it("shows Save busy while the template saves, with its label kept and its focus, then 'Saved' stays focusable", async () => {
    fetchEventTemplates.mockResolvedValue([ticketRow]);
    renderPage();
    await screen.findByLabelText("Subject");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Updated ticket subject" } });
    const saved = deferred<unknown>();
    saveEventTemplateById.mockReturnValueOnce(saved.promise);
    const save = screen.getByRole("button", { name: "Save *" });
    save.focus();

    fireEvent.click(save);
    await waitFor(() => expect(save.getAttribute("aria-busy")).toBe("true"));
    expect(save.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(save);
    expect(screen.queryByText("Saving…")).toBeNull();
    fireEvent.click(save);
    expect(saveEventTemplateById).toHaveBeenCalledTimes(1);

    await act(async () => saved.resolve({ ...ticketRow, subject_template: "Updated ticket subject", body_template: "<p>Hi</p>" }));
    const after = await screen.findByRole("button", { name: "Saved" });
    expect(after).toBe(save);
    expect(isOff(after)).toBe(true);
    expect(after.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(after);
  });

  it("shows Send test busy as 'Sending…' while it sends, keeps its focus and ignores a second click", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    const sent = deferred<unknown>();
    testSendEventTemplate.mockReturnValueOnce(sent.promise);
    renderPage();
    fireEvent.change(await screen.findByLabelText("Recipient"), { target: { value: "ops@example.com" } });
    const send = screen.getByRole("button", { name: "Send test" });
    send.focus();

    fireEvent.click(send);
    const busy = await screen.findByRole("button", { name: "Sending…" });
    expect(busy).toBe(send);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(testSendEventTemplate).toHaveBeenCalledTimes(1);

    await act(async () => sent.resolve({ status: "sent" }));
    expect(await screen.findByText("Test email sent.")).toBeTruthy();
  });

  it("keeps Send test off, but focusable, while the recipient is not a valid address, and says why", async () => {
    fetchEventTemplates.mockResolvedValue([]);
    renderPage();
    await screen.findByLabelText("Recipient");
    const send = screen.getByRole("button", { name: "Send test" });
    expect(isOff(send)).toBe(true);
    expect(send.hasAttribute("disabled")).toBe(false);
    const description = (send.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
    expect(description).toBe("Enter a valid email address.");
    fireEvent.click(send);
    expect(testSendEventTemplate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "ops@example.com" } });
    expect(isOff(send)).toBe(false);
    expect(send.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
  });
});
