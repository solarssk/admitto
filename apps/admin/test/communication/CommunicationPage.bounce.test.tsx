// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { MemoryRouter, Route, Routes, createMemoryRouter } from "react-router";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const fetchEventOverview = vi.fn();
const fetchEventTemplate = vi.fn();
const fetchEventTemplates = vi.fn();
const fetchEventDeliveries = vi.fn();
const reportApiError = vi.fn();

// A fresh `vi.fn()` per call (as this used to return) breaks CommunicationPage's own
// memoization: `reportApiError` sits in the dependency array of 3 effects (initial template
// load, the bounce-overview fetch, and the tab-switch delivery fetch), so an unstable identity
// re-fires all of them on every render, flickering `loading` fast enough that
// useDelayedLoading's 200ms window never elapses and the whole page intermittently renders
// null - a CI-only race, since a fast/idle local machine never lingers in that window long
// enough to observe it. Every sibling CommunicationPage test file already hoists this the same
// way; this file was the one holdout.
vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
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
  // The Send tab (now the default landing tab) auto-renders a preview on mount - resolve these
  // by default so that doesn't surface as an unrelated "Preview failed" error toast in tests
  // that never cared about preview content.
  previewEventTemplate: vi.fn().mockResolvedValue({ subject: "", html: "" }),
  previewEventTemplateById: vi.fn().mockResolvedValue({ subject: "", html: "" }),
  saveEventTemplate: vi.fn(),
  saveEventTemplateById: vi.fn(),
  createEventTemplate: vi.fn(),
  deleteEventTemplate: vi.fn(),
  testSendEventTemplate: vi.fn(),
  testSendEventTemplateById: vi.fn(),
  sendEventBulk: vi.fn(),
  fetchBulkSendStatus: vi.fn(),
  fetchTicketTypes: vi.fn().mockResolvedValue([]),
  fetchEventMailSettings: vi.fn().mockResolvedValue({
    fields: { fromName: { value: null }, fromAddress: { value: null } },
  }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: null },
    }),
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

function renderPageAt(eventId: string) {
  return renderWithToast(
    <MemoryRouter initialEntries={[`/admin/events/${eventId}/communication`]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderPage() {
  return renderPageAt("evt-1");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchEventTemplates.mockResolvedValue([]);
  // The delivery log tab (rendered by "View delivery log") uses useIsDesktop(), which reads
  // window.matchMedia - unimplemented in jsdom, so it must be stubbed even though this file's
  // focus is the bounce banner, not the log tab's responsive layout.
  mockMatchMedia(true);
});

describe("CommunicationPage bounce banner", () => {
  it("shows bounce banner when email_bounced > 0", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 3,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });

    renderPage();

    // Scoped to the captured alert node (not re-queried from `screen`) so a later, unrelated
    // re-render can't race this assertion the way two separate screen queries could.
    const banner = await screen.findByRole("alert");
    expect(banner.classList.contains("at-notice--warning")).toBe(true);
    expect(within(banner).getByText(/3 emails bounced/i)).toBeTruthy();
    expect(within(banner).getByRole("button", { name: "View delivery log" })).toBeTruthy();
  });

  it("uses singular wording when exactly one email bounced", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 1,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });

    renderPage();

    const banner = await screen.findByRole("alert");
    expect(within(banner).getByText(/^1 email bounced$/i)).toBeTruthy();
  });

  it("hides bounce banner when email_bounced is 0", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 0,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Send/i })).toBeTruthy();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("View delivery log switches to log tab with bounced filter", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockResolvedValue({
      email_bounced: 2,
      email_failed: 0,
      email_sent: 10,
      email_queued: 0,
    });
    fetchEventDeliveries.mockResolvedValue({ items: [], total: 0 });

    renderPage();

    // Captured once and reused, not re-queried from `screen` a second time (see #592's identical
    // fix a few tests up in this same file) - a later, unrelated re-render can't race this click
    // the way two separate screen queries could.
    const viewLogButton = await screen.findByRole("button", { name: "View delivery log" });
    fireEvent.click(viewLogButton);

    await waitFor(() => {
      expect(fetchEventDeliveries).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ status: "bounced", page: 1 }),
        expect.any(AbortSignal),
      );
    });
  });

  it("does not show bounce banner when overview fetch fails", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    fetchEventOverview.mockRejectedValue(new Error("network"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Send/i })).toBeTruthy();
    });
    expect(screen.queryByText(/emails bounced/i)).toBeNull();
  });

  it("clears stale bounce banner when navigating to another event", async () => {
    fetchEventTemplate.mockResolvedValue(templatePayload);
    let resolveSecondOverview: (value: unknown) => void;
    const secondOverview = new Promise((resolve) => {
      resolveSecondOverview = resolve;
    });
    fetchEventOverview.mockImplementation((eventId: string) => {
      if (eventId === "evt-1") {
        return Promise.resolve({
          email_bounced: 3,
          email_failed: 0,
          email_sent: 10,
          email_queued: 0,
        });
      }
      return secondOverview;
    });

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/communication", element: <CommunicationPage /> }],
      { initialEntries: ["/admin/events/evt-1/communication"] },
    );
    renderWithToast(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByText(/3 emails bounced/i)).toBeTruthy();
    });

    await router.navigate("/admin/events/evt-2/communication");

    await waitFor(() => {
      expect(screen.queryByText(/3 emails bounced/i)).toBeNull();
    });

    resolveSecondOverview!({
      email_bounced: 0,
      email_failed: 0,
      email_sent: 1,
      email_queued: 0,
    });

    await waitFor(() => {
      expect(screen.queryByText(/emails bounced/i)).toBeNull();
    });
  });
});
