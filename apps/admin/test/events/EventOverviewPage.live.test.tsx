// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EventOverviewPage } from "../../src/pages/EventOverviewPage.js";
import type { EventOverviewDto } from "../../src/api/types.js";
import type { StreamCheckinEvent } from "../../src/hooks/useEventStream.js";
import { renderWithToast } from "../test-utils.js";

const fetchEventOverview = vi.fn();
const reportApiError = vi.fn();

let streamHandler: ((event: StreamCheckinEvent) => void) | null = null;

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: (_eventId: string, onCheckin: (event: StreamCheckinEvent) => void) => {
    streamHandler = onCheckin;
    return { connected: true, status: "connected" };
  },
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ state: "connected", reportApiError }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo Event",
        slug: "demo",
        date: "2026-07-01T18:00:00.000Z",
        timezone: "UTC",
        location: "Hall A",
        capacity: 100,
        archived_at: null,
        organization_id: "org-1",
        attendee_count: 50,
      },
    }),
  };
});

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  fetchEventOverview: (...args: unknown[]) => fetchEventOverview(...args),
  patchEventNote: vi.fn(),
  createEventContact: vi.fn(),
  updateEventContact: vi.fn(),
  deleteEventContact: vi.fn(),
  createEventResource: vi.fn(),
  updateEventResource: vi.fn(),
  deleteEventResource: vi.fn(),
}));

const overviewFixture = (admitted = 5): EventOverviewDto => ({
  event: {
    id: "evt-1",
    title: "Demo Event",
    slug: "demo",
    date: "2026-07-01T18:00:00.000Z",
    timezone: "UTC",
    location: "Hall A",
    capacity: 100,
    archived_at: null,
    organization_id: "org-1",
    pinned_note: null,
  },
  attendee_count: 50,
  admitted_count: admitted,
  email_sent: 40,
  email_failed: 0,
  email_bounced: 0,
  email_queued: 0,
  requirements_count: 0,
  checkin_staff_count: 1,
  attendees_with_ticket: 50,
  contacts: [],
  resources: [],
});

const liveEvent: StreamCheckinEvent = {
  type: "checkin",
  attendeeId: "att-9",
  attendeeName: "Sam Guest",
  ticketType: null,
  admittedAt: "2026-06-01T11:00:00.000Z",
  operatorId: null,
  deviceLabel: null,
};

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/overview"]}>
      <Routes>
        <Route path="/admin/events/:eventId/overview" element={<EventOverviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  streamHandler = null;
});

describe("EventOverviewPage live stats", () => {
  beforeEach(() => {
    fetchEventOverview.mockReset();
  });

  it("refetches admitted count after a new SSE check-in", async () => {
    fetchEventOverview
      .mockResolvedValueOnce(overviewFixture(5))
      .mockResolvedValue(overviewFixture(6));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("5")).toBeTruthy();
    });

    act(() => {
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(screen.getByText("6")).toBeTruthy();
    });

    await waitFor(
      () => {
        expect(fetchEventOverview).toHaveBeenCalledTimes(2);
        expect(screen.getByText("6")).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });

  it("clears optimistic delta when the periodic overview refresh succeeds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchEventOverview.mockResolvedValue(overviewFixture(5));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("5")).toBeTruthy();
      });

      act(() => {
        streamHandler?.(liveEvent);
      });

      await waitFor(() => {
        expect(screen.getByText("6")).toBeTruthy();
      });

      fetchEventOverview.mockResolvedValue(overviewFixture(6));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      await waitFor(() => {
        expect(screen.getByText("6")).toBeTruthy();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves recent admit dedup across reconcile refresh (TTL prune, not full clear)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchEventOverview.mockResolvedValue(overviewFixture(5));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("5")).toBeTruthy();
      });

      act(() => {
        streamHandler?.(liveEvent);
      });

      await waitFor(() => {
        expect(screen.getByText("6")).toBeTruthy();
      });

      fetchEventOverview.mockResolvedValue(overviewFixture(6));

      // Reconcile at 3s is within the 5s admit-dedup TTL; absorbServerOverview prunes stale keys only.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(() => {
        expect(screen.getByText("6")).toBeTruthy();
        expect(fetchEventOverview).toHaveBeenCalledTimes(2);
      });

      act(() => {
        streamHandler?.(liveEvent);
      });

      expect(screen.getByText("6")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates repeated SSE for the same admit", async () => {
    fetchEventOverview
      .mockResolvedValueOnce(overviewFixture(5))
      .mockResolvedValue(overviewFixture(6));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("5")).toBeTruthy();
    });

    act(() => {
      streamHandler?.(liveEvent);
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(screen.getByText("6")).toBeTruthy();
    });

    await waitFor(
      () => {
        expect(fetchEventOverview).toHaveBeenCalledTimes(2);
      },
      { timeout: 5000 },
    );
  });

  it("does not schedule extra refetches for replayed SSE events", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(6));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("6")).toBeTruthy();
    });

    const callsAfterLoad = fetchEventOverview.mock.calls.length;

    act(() => {
      streamHandler?.(liveEvent);
      streamHandler?.(liveEvent);
    });

    await waitFor(
      () => {
        expect(fetchEventOverview.mock.calls.length).toBe(callsAfterLoad + 1);
      },
      { timeout: 5000 },
    );
    expect(screen.getByText("6")).toBeTruthy();
  });
});
