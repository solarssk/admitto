// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from "react-router-dom";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
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
});

beforeEach(() => {
  fetchEventTemplates.mockResolvedValue([]);
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

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByText(/3 emails bounced/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "View delivery log" })).toBeTruthy();
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
      expect(screen.getByRole("tab", { name: /Compose/i })).toBeTruthy();
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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View delivery log" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "View delivery log" }));

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
      expect(screen.getByRole("tab", { name: /Compose/i })).toBeTruthy();
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
