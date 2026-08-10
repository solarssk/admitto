// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import type { EventDto } from "../../src/api/types.js";
import { EventsPickerPage } from "../../src/pages/EventsPickerPage.js";

const adminAssignments = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];

const createdEvent: EventDto = {
  id: "evt-new",
  title: "Spring Summit",
  slug: "spring-summit",
  date: "2026-04-01",
  timezone: "Europe/Warsaw",
  location: null,
  capacity: 200,
  archived_at: null,
};

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: adminAssignments }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => {
  const connectionState = { reportApiError: vi.fn() };
  return { useConnectionState: () => connectionState };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchAdminEvents: vi.fn() };
});

vi.mock("../../src/events/CreateEventModal.js", () => ({
  CreateEventModal: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated: (event: EventDto) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onCreated(createdEvent)}>
        Mock create event
      </button>
    ) : null,
}));

import { fetchAdminEvents } from "../../src/api/client.js";

afterEach(cleanup);

describe("EventsPickerPage — post-create navigation", () => {
  it("navigates to the event overview after create", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<EventsPickerPage />} />
          <Route path="/admin/events/:eventId/overview" element={<div>Overview landing</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "New event" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock create event" }));

    await waitFor(() => {
      expect(screen.getByText("Overview landing")).toBeTruthy();
    });
  });
});
