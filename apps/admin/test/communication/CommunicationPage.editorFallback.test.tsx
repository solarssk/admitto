// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { renderWithToast } from "../test-utils.js";
import { communicationApiMocks } from "./communicationApiMock.js";

const { fetchEventTemplates, fetchEventTemplate, fetchEventTemplateById, fetchEventOverview } = communicationApiMocks;

vi.mock("../../src/connection/ConnectionStateProvider.js");

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { buildCommunicationApiMock } = await import("./communicationApiMock.js");
  return buildCommunicationApiMock(await importOriginal<typeof import("../../src/api/client.js")>());
});

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => ({ event: { id: "evt-1", title: "Demo", archived_at: null } }),
  };
});

// The editor's code (a lazily loaded chunk) never arrives: the page keeps drawing the chunk's fallback.
vi.mock("../../src/communication/TemplateEditorCard.js", () => new Promise(() => {}));

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

const reminderRow = { ...ticketRow, id: "tpl-rem", name: "reminder", label: "Reminder", subject_template: "Reminder subject" };

beforeEach(() => {
  fetchEventOverview.mockResolvedValue({ email_bounced: 0, email_failed: 0, email_sent: 0, email_queued: 0 });
  fetchEventTemplate.mockResolvedValue({
    source: "builtin" as const,
    allowed_placeholders: [],
    required_url_placeholders: [],
    image_placeholders: [],
    subject_template: "Hello",
    body_template: "<p>Hi</p>",
    template_format: "html" as const,
  });
  fetchEventTemplates.mockResolvedValue([ticketRow, reminderRow]);
  fetchEventTemplateById.mockImplementation(async (_eventId: string, id: string) => ({
    ...(id === "tpl-rem" ? reminderRow : ticketRow),
    body_template: "<p>Body</p>",
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchEventTemplates.mockReset();
  fetchEventTemplate.mockReset();
  fetchEventTemplateById.mockReset();
});

describe("CommunicationPage while the template editor's code is on its way", () => {
  it("draws the editor's own card as grey shapes, titled for the template that is open", async () => {
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-comm/communication?tab=templates"]}>
        <Routes>
          <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const fallback = await screen.findByRole("status", { name: "Loading editor" });
    expect(within(fallback).getByText("Ticket template")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Template,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reminder" }));
    await waitFor(() => expect(within(screen.getByRole("status", { name: "Loading editor" })).getByText("Template")).toBeTruthy());
    expect(screen.queryByText("Ticket template")).toBeNull();
  });
});
