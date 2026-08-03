// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { CheckInEntryPage } from "../../src/pages/CheckInEntryPage.js";

vi.mock("../../src/connection/ConnectionStateProvider.js", () => {
  const connectionState = { reportApiError: vi.fn() };
  return { useConnectionState: () => connectionState };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchCheckInEvents: vi.fn() };
});

import { fetchCheckInEvents } from "../../src/api/client.js";

afterEach(cleanup);

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/operator" element={<CheckInEntryPage />} />
        <Route path="/operator/events/:eventId/checkin" element={<p>checkin-target</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CheckInEntryPage", () => {
  it("renders touch-sized event cards with attendee counts when multiple events are available", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue([
      {
        id: "evt-1",
        title: "Spring Summit",
        slug: "spring-summit",
        date: "2026-05-01",
        timezone: "Europe/Warsaw",
        location: "Warsaw",
        organization_id: "org-1",
        archived_at: null,
        attendee_count: 42,
      },
      {
        id: "evt-2",
        title: "Autumn Forum",
        slug: "autumn-forum",
        date: "2026-10-01",
        timezone: "Europe/Warsaw",
        location: null,
        organization_id: "org-1",
        archived_at: null,
      },
    ]);

    renderAt("/operator");

    await waitFor(() => {
      expect(screen.getByText("Spring Summit")).toBeTruthy();
    });
    expect(screen.getByText("Autumn Forum")).toBeTruthy();
    expect(document.querySelector(".event-grid--cols-2")).toBeTruthy();
    expect(document.querySelector(".event-card--touch")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    // Only this page renders counts, so it is the one caller that opts into the extra query.
    expect(fetchCheckInEvents).toHaveBeenCalledWith({ includeAttendeeCount: true });
  });

  it("uses the two-column grid when at least four events are available, same as the admin picker", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `evt-${index + 1}`,
        title: `Event ${index + 1}`,
        slug: `event-${index + 1}`,
        date: "2026-01-01",
        timezone: "Europe/Warsaw",
        location: null,
        organization_id: "org-1",
        archived_at: null,
      })),
    );

    renderAt("/operator");

    await screen.findByText("Event 4");
    expect(document.querySelector(".event-grid")?.className).toContain("event-grid--cols-2");
    expect(document.querySelector(".event-grid")?.className).not.toContain("event-grid--cols-3");
  });

  it("auto-redirects straight to check-in when exactly one event is available", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue([
      {
        id: "evt-solo",
        title: "Solo Event",
        slug: "solo-event",
        date: "2026-05-01",
        timezone: "Europe/Warsaw",
        location: null,
        organization_id: "org-1",
        archived_at: null,
      },
    ]);

    renderAt("/operator");

    await waitFor(() => {
      expect(screen.getByText("checkin-target")).toBeTruthy();
    });
    expect(screen.queryByText("Solo Event")).toBeNull();
  });

  it("shows an empty state when no events have check-in access", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue([]);

    renderAt("/operator");

    await waitFor(() => {
      expect(
        screen.getByText("No events with check-in access were found for your account."),
      ).toBeTruthy();
    });
  });
});
