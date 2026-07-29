// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { EventOverviewPage } from "../../src/pages/EventOverviewPage.js";
import type {
  EventContactDto,
  EventOverviewDto,
  EventRecentActivityEntry,
  EventResourceDto,
} from "../../src/api/types.js";
import type { StreamCheckinEvent } from "../../src/hooks/useEventStream.js";
import { makeTicketType, renderWithToast } from "../test-utils.js";
import { formatEventCalendarDate } from "../../src/utils/event-dates.js";

const fetchEventOverview = vi.fn();
const fetchTicketTypes = vi.fn();
const reportApiError = vi.fn();

let streamHandler: ((event: StreamCheckinEvent) => void) | null = null;
// Lets a test simulate the SSE handshake not having completed yet (#C) — defaults to true so
// every other test keeps its original "always connected" behavior.
let mockStreamConnected = true;

vi.mock("../../src/hooks/useEventStream.js", () => ({
  useEventStream: (_eventId: string, onCheckin: (event: StreamCheckinEvent) => void) => {
    streamHandler = onCheckin;
    return { connected: mockStreamConnected, status: mockStreamConnected ? "connected" : "connecting" };
  },
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ state: "connected", reportApiError }),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
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
  fetchTicketTypes: (...args: unknown[]) => fetchTicketTypes(...args),
  patchEventNote: vi.fn(),
  createEventContact: vi.fn(),
  updateEventContact: vi.fn(),
  deleteEventContact: vi.fn(),
  createEventResource: vi.fn(),
  updateEventResource: vi.fn(),
  deleteEventResource: vi.fn(),
}));

import {
  patchEventNote,
  createEventContact,
  updateEventContact,
  createEventResource,
} from "../../src/api/client.js";

const mockPatchEventNote = vi.mocked(patchEventNote);
const mockCreateEventContact = vi.mocked(createEventContact);
const mockUpdateEventContact = vi.mocked(updateEventContact);
const mockCreateEventResource = vi.mocked(createEventResource);

const overviewFixture = (
  admitted = 5,
  overrides: Partial<EventOverviewDto> = {},
): EventOverviewDto => ({
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
  last_check_in_at: null,
  busiest_hour: null,
  ticket_type_breakdown: [],
  recent_activity: [],
  contacts: [],
  resources: [],
  ...overrides,
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

/** The 4 KPI tiles - scope queries here since some plain numbers/labels also appear elsewhere on
 * the page (e.g. the Failed delivery count vs. the Setup checklist). */
function statsRow(): HTMLElement {
  return document.querySelector(".overview-stats") as HTMLElement;
}

/** The Check-in progress card's admission ring legend now owns the admitted count display (the
 * top KPI row's old "Checked in" tile was removed in favor of a Days-to-event tile, #E1) — this
 * still carries the optimistic SSE delta instantly, same as the removed tile used to. */
function admittedLegendValue(): string {
  return document.querySelector(".overview-progress__legend-item strong")?.textContent ?? "";
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  streamHandler = null;
  mockStreamConnected = true;
});

describe("EventOverviewPage live stats", () => {
  beforeEach(() => {
    fetchEventOverview.mockReset();
    fetchTicketTypes.mockReset();
    fetchTicketTypes.mockResolvedValue([]);
  });

  it("refetches admitted count after a new SSE check-in", async () => {
    fetchEventOverview
      .mockResolvedValueOnce(overviewFixture(5))
      .mockResolvedValue(overviewFixture(6));

    renderPage();

    await waitFor(() => {
      expect(admittedLegendValue()).toBe("5");
    });

    act(() => {
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(admittedLegendValue()).toBe("6");
    });

    await waitFor(
      () => {
        expect(fetchEventOverview).toHaveBeenCalledTimes(2);
        expect(admittedLegendValue()).toBe("6");
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
        expect(admittedLegendValue()).toBe("5");
      });

      act(() => {
        streamHandler?.(liveEvent);
      });

      await waitFor(() => {
        expect(admittedLegendValue()).toBe("6");
      });

      fetchEventOverview.mockResolvedValue(overviewFixture(6));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      await waitFor(() => {
        expect(admittedLegendValue()).toBe("6");
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
        expect(admittedLegendValue()).toBe("5");
      });

      act(() => {
        streamHandler?.(liveEvent);
      });

      await waitFor(() => {
        expect(admittedLegendValue()).toBe("6");
      });

      fetchEventOverview.mockResolvedValue(overviewFixture(6));

      // Reconcile at 3s is within the 5s admit-dedup TTL; absorbServerOverview prunes stale keys only.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(() => {
        expect(admittedLegendValue()).toBe("6");
        expect(fetchEventOverview).toHaveBeenCalledTimes(2);
      });

      act(() => {
        streamHandler?.(liveEvent);
      });

      expect(admittedLegendValue()).toBe("6");
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
      expect(admittedLegendValue()).toBe("5");
    });

    act(() => {
      streamHandler?.(liveEvent);
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(admittedLegendValue()).toBe("6");
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
      expect(admittedLegendValue()).toBe("6");
    });

    const callsAfterLoad = fetchEventOverview.mock.calls.length;

    act(() => {
      streamHandler?.(liveEvent);
      streamHandler?.(liveEvent);
    });

    await waitFor(
      () => {
        expect(fetchEventOverview.mock.calls).toHaveLength(callsAfterLoad + 1);
      },
      { timeout: 5000 },
    );
    expect(admittedLegendValue()).toBe("6");
  });

  it("resolves a live check-in's ticket_type key to the catalog's current label instead of the key (batch 04 / #351), in the Recent activity feed", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));
    fetchTicketTypes.mockResolvedValue([makeTicketType("vip", "VIP Guest")]);

    renderPage();

    await waitFor(() => {
      expect(admittedLegendValue()).toBe("5");
    });

    act(() => {
      streamHandler?.({ ...liveEvent, attendeeName: "Vip Guest", ticketType: "vip" });
    });

    await waitFor(() => {
      expect(screen.getByText("Vip Guest")).toBeTruthy();
      expect(screen.getByText("VIP Guest")).toBeTruthy();
    });
    expect(screen.queryByText("vip")).toBeNull();
  });

  it("still shows an orphaned/unmatched ticket_type key in the live feed rather than hiding it (fail-open)", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));
    fetchTicketTypes.mockResolvedValue([makeTicketType("vip", "VIP Guest")]);

    renderPage();

    await waitFor(() => {
      expect(admittedLegendValue()).toBe("5");
    });

    act(() => {
      streamHandler?.({ ...liveEvent, attendeeName: "Orphan Guest", ticketType: "staff_2" });
    });

    await waitFor(() => {
      expect(screen.getByText("Orphan Guest")).toBeTruthy();
      expect(screen.getByText("staff_2")).toBeTruthy();
    });
  });
});

describe("EventOverviewPage redesign (#344-#350, #373, #374)", () => {
  beforeEach(() => {
    fetchEventOverview.mockReset();
    fetchTicketTypes.mockReset();
    fetchTicketTypes.mockResolvedValue([]);
  });

  it("shows a loading placeholder for the Attendees KPI instead of the raw (revoked-inclusive) events-picker count (#374)", async () => {
    let resolveOverview!: (value: EventOverviewDto) => void;
    fetchEventOverview.mockReturnValue(
      new Promise<EventOverviewDto>((resolve) => {
        resolveOverview = resolve;
      }),
    );

    renderPage();

    // event.attendee_count from useOutletContext is 50 (picker total); the real overview total
    // below is different (48, active-only) - the tile must never show either raw number pre-load.
    // Every KPI tile shows the same "…" placeholder pre-load, so assert at least one renders
    // rather than a single exact match.
    await waitFor(() => {
      expect(screen.getAllByText("…").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("50")).toBeNull();

    await act(async () => {
      resolveOverview(overviewFixture(5, { attendee_count: 48 }));
    });

    await waitFor(() => {
      expect(screen.getByText("48")).toBeTruthy();
    });
  });

  it("never claims a tile/section is confirmed-empty during the no-flash grace window of the very first load (Sonar/PO review)", () => {
    // Regression test: every one of these must gate on the raw loading flag, not the delayed
    // showLoading flag alone — otherwise the pre-delay window (real fetch in flight,
    // currentOverview still null) falls straight through to a "confirmed" state: the KPI dash,
    // the cards' "Unavailable", or the notes/contacts/links sections' empty-state add-CTAs.
    // Checked synchronously right after render (no await) — currentOverview is null on the very
    // first render already, so there is nothing to wait for, and waiting would itself risk
    // crossing the 200ms grace window this test exists to probe.
    fetchEventOverview.mockImplementationOnce(() => new Promise(() => {}));
    renderPage();

    expect(within(statsRow()).queryAllByText("-")).toHaveLength(0);
    expect(screen.queryAllByText("Unavailable")).toHaveLength(0);
    expect(screen.queryByText("Add a pinned note for staff")).toBeNull();
    expect(screen.queryByText("Add a key contact")).toBeNull();
    expect(screen.queryByText("Add a link or file")).toBeNull();
  });

  it("replaces the duplicate-date Event date tile with a Failed delivery tile and labels the KPI row per the mockup (#350)", async () => {
    fetchEventOverview.mockResolvedValue(
      overviewFixture(5, { email_failed: 2, email_bounced: 1 }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Attendees")).toBeTruthy();
    });
    expect(within(statsRow()).getByText("Tickets sent")).toBeTruthy();
    expect(within(statsRow()).getByText("Failed delivery")).toBeTruthy();
    expect(within(statsRow()).getByText("3")).toBeTruthy();
    expect(screen.queryByText("Event date")).toBeNull();
  });

  it("renders the 4 KPI tiles with the bespoke icon-square-left layout, not the generic Stat's icon-circle-top-right (D)", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));

    renderPage();

    await waitFor(() => {
      expect(within(statsRow()).getByText("Attendees")).toBeTruthy();
    });
    expect(statsRow().querySelectorAll(".overview-kpi")).toHaveLength(4);
    expect(statsRow().querySelectorAll(".overview-kpi__icon")).toHaveLength(4);
    // @admitto/ui's generic Stat component (icon-circle-top-right layout) this once diverged
    // from has since been removed entirely (see #590) - .at-stat can no longer render anywhere.
    expect(statsRow().querySelector(".at-stat")).toBeNull();
  });

  it("replaces the Checked in KPI tile with an Event countdown tile in the 3rd position, reusing the existing countdown util (#E1)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Fixture event date is 2026-07-01T18:00:00Z (UTC); 5 calendar days after this faked "now"
      // (also UTC) - computeLabel() returns "In 5 days" for that gap.
      vi.setSystemTime(new Date("2026-06-26T10:00:00.000Z"));
      fetchEventOverview.mockResolvedValue(overviewFixture(5));

      renderPage();

      await waitFor(() => {
        expect(within(statsRow()).getByText("Attendees")).toBeTruthy();
      });

      const labels = Array.from(statsRow().querySelectorAll(".overview-kpi__label")).map(
        (el) => el.textContent,
      );
      expect(labels).toEqual(["Attendees", "Tickets sent", "Event countdown", "Failed delivery"]);
      expect(within(statsRow()).queryByText("Checked in")).toBeNull();
      expect(within(statsRow()).getByText("In 5 days")).toBeTruthy();
      // No sub-line (round 5, item A) - the calendar date is only shown in the page header now.
      expect(
        within(statsRow()).queryByText(formatEventCalendarDate("2026-07-01T18:00:00.000Z")),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the neutral 'Event countdown' label, not 'Days to event', for an event that ended within the past week", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // 3 calendar days after the fixture's 2026-07-01 event date - still inside the +-7 day
      // window, so the value is prose ("Ended 3 days ago") rather than a bare number.
      vi.setSystemTime(new Date("2026-07-04T10:00:00.000Z"));
      fetchEventOverview.mockResolvedValue(overviewFixture(5));

      renderPage();

      await waitFor(() => {
        expect(within(statsRow()).getByText("Attendees")).toBeTruthy();
      });

      expect(within(statsRow()).getByText("Ended 3 days ago")).toBeTruthy();
      expect(within(statsRow()).getByText("Event countdown")).toBeTruthy();
      expect(within(statsRow()).queryByText("Days to event")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a raw day count under the 'Days to event' label for events more than a week out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // 30 calendar days before the fixture's 2026-07-01 event date - computeLabel() itself would
      // fall back to the plain calendar date here, which is wrong for this numeric KPI tile (and
      // would just repeat the date already shown in the page header).
      vi.setSystemTime(new Date("2026-06-01T10:00:00.000Z"));
      fetchEventOverview.mockResolvedValue(overviewFixture(5));

      renderPage();

      await waitFor(() => {
        expect(within(statsRow()).getByText("Attendees")).toBeTruthy();
      });

      expect(within(statsRow()).getByText("30")).toBeTruthy();
      // Still upcoming, so the label stays "Days to event" (only the far-past case swaps it) and
      // there's no "days to go" sub-line anymore - direction reads from the label alone.
      expect(within(statsRow()).getByText("Days to event")).toBeTruthy();
      expect(within(statsRow()).queryByText("days to go")).toBeNull();
      expect(
        within(statsRow()).queryByText(formatEventCalendarDate("2026-07-01T18:00:00.000Z")),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches the label to 'Days since event' for events more than a week in the past", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // 30 calendar days after the fixture's 2026-07-01 event date.
      vi.setSystemTime(new Date("2026-07-31T10:00:00.000Z"));
      fetchEventOverview.mockResolvedValue(overviewFixture(5));

      renderPage();

      await waitFor(() => {
        expect(within(statsRow()).getByText("Attendees")).toBeTruthy();
      });

      expect(within(statsRow()).getByText("Days since event")).toBeTruthy();
      expect(within(statsRow()).getByText("30")).toBeTruthy();
      expect(within(statsRow()).queryByText("Days to event")).toBeNull();
      expect(within(statsRow()).queryByText("days ago")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("merges Needs attention + Event readiness into a single Setup checklist card (#348)", async () => {
    fetchEventOverview.mockResolvedValue(
      overviewFixture(5, {
        checkin_staff_count: 0,
        attendee_count: 0,
        attendees_with_ticket: 0,
        email_failed: 1,
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Setup checklist")).toBeTruthy();
    });
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByText("Event readiness")).toBeNull();
    expect(screen.getByText("Email delivery")).toBeTruthy();
    expect(screen.getByText("View full checklist in Event settings")).toBeTruthy();
  });

  it("shows an all-clear line in the checklist when nothing needs action", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(50));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Setup checklist")).toBeTruthy();
    });
    expect(screen.getByText("All checks look good")).toBeTruthy();
  });

  it("renders the Check-in progress card's ring percentage and glance stats", async () => {
    fetchEventOverview.mockResolvedValue(
      overviewFixture(25, {
        attendee_count: 50,
        last_check_in_at: "2026-07-01T10:00:00.000Z",
        busiest_hour: { hour: "13:00", count: 4 },
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Check-in progress")).toBeTruthy();
    });
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("Busiest hour")).toBeTruthy();
    expect(screen.getByText("13:00–14:00")).toBeTruthy();
  });

  it("shows an honest dash placeholder for Last check-in and Busiest hour with zero check-ins, not a fabricated value (#F1)", async () => {
    // last_check_in_at/busiest_hour both null is the default overviewFixture() shape - the
    // zero-check-ins case - so this also guards against a stale hardcoded demo fallback (the
    // mockup source had literal "2 min ago" / "13:00-14:00" strings) leaking into these tiles.
    fetchEventOverview.mockResolvedValue(overviewFixture(0));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Check-in progress")).toBeTruthy();
    });
    const glanceTiles = document.querySelectorAll(".overview-glance__tile");
    expect(glanceTiles).toHaveLength(2);
    glanceTiles.forEach((tile) => {
      expect(within(tile as HTMLElement).getByText("-")).toBeTruthy();
    });
    expect(screen.queryByText("2 min ago")).toBeNull();
    expect(screen.queryByText("13:00–14:00")).toBeNull();
  });

  it("renders the ticket-type breakdown bar only when more than one type has attendees", async () => {
    fetchEventOverview.mockResolvedValue(
      overviewFixture(5, {
        ticket_type_breakdown: [
          { key: "standard", label: "Standard", color: "gray", count: 3 },
          { key: "vip", label: "VIP", color: "purple", count: 2 },
        ],
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Check-in progress")).toBeTruthy();
    });
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("VIP")).toBeTruthy();
  });

  it("doesn't crash Check-in progress when ticket_type_breakdown is entirely absent from the response (stale apps/web dev process predating this field)", async () => {
    const staleOverview = overviewFixture(5);
    // apps/web has no watch mode — a dev server running an older build genuinely omits fields
    // added since, unlike the fixture default `[]`. Simulate that instead of an empty array. If
    // the page ever reverts to reading this field without a fallback, `renderPage()` below throws
    // synchronously (no error boundary in this test tree) and fails the test.
    delete (staleOverview as Partial<EventOverviewDto>).ticket_type_breakdown;
    fetchEventOverview.mockResolvedValue(staleOverview);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Check-in progress")).toBeTruthy();
    });
  });

  it("hydrates Recent activity from the initial overview fetch, not only from a live SSE event (#373)", async () => {
    const recentActivity: EventRecentActivityEntry[] = [
      {
        id: "checkin:hist-1",
        type: "checkin",
        tone: "ok",
        attendee_name: "Historic Guest",
        attendee_id: "att-hist-1",
        message: "checked in",
        occurred_at: new Date().toISOString(),
      },
      {
        id: "mail:hist-1",
        type: "mail_failed",
        tone: "error",
        attendee_name: "Failed Guest",
        attendee_id: "att-hist-2",
        message: "Ticket email failed for failed@example.com",
        occurred_at: new Date().toISOString(),
      },
    ];
    fetchEventOverview.mockResolvedValue(overviewFixture(5, { recent_activity: recentActivity }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Historic Guest")).toBeTruthy();
    });
    expect(screen.getByText("Failed Guest")).toBeTruthy();
    expect(screen.getByText(/Ticket email failed/)).toBeTruthy();
    // No SSE event was ever fired above - this proves the feed hydrated purely from the initial fetch.
    expect(streamHandler).not.toBeNull();
  });

  it("filters Recent activity to warn/error entries only via the Issues toggle, rendered in the card header alongside the live badge (#E2)", async () => {
    const recentActivity: EventRecentActivityEntry[] = [
      {
        id: "checkin:ok-1",
        type: "checkin",
        tone: "ok",
        attendee_name: "Fine Guest",
        attendee_id: "att-ok-1",
        message: "checked in",
        occurred_at: new Date().toISOString(),
      },
      {
        id: "mail:err-1",
        type: "mail_bounced",
        tone: "error",
        attendee_name: "Bounced Guest",
        attendee_id: "att-err-1",
        message: "Ticket email bounced for bounced@example.com",
        occurred_at: new Date().toISOString(),
      },
    ];
    fetchEventOverview.mockResolvedValue(overviewFixture(5, { recent_activity: recentActivity }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Fine Guest")).toBeTruthy();
    });
    expect(screen.getByText("Bounced Guest")).toBeTruthy();

    // All/Issues live in the Card's header row next to "live", not a separate row above the timeline.
    const activityCard = screen.getByText("Recent activity").closest(".at-card") as HTMLElement;
    const header = activityCard.querySelector(".at-card__header") as HTMLElement;
    const allButton = within(header).getByRole("radio", { name: "All" });
    const issuesButton = within(header).getByRole("radio", { name: "Issues" });
    expect(allButton).toBeTruthy();
    expect(issuesButton).toBeTruthy();
    // Live indicator reuses the app's dot-Badge pattern (Badge variant="ok" dot), not a bespoke
    // dot+text pair.
    const liveBadge = within(header).getByText("live").closest(".at-badge") as HTMLElement;
    expect(liveBadge.className).toContain("at-badge--ok");
    expect(liveBadge.className).toContain("overview-live-badge");

    // All/Issues render as the shared Segmented control (radiogroup/radio + aria-checked), the
    // same standard used for Instance Settings' toggles - not a bespoke button pair.
    expect(allButton.getAttribute("aria-checked")).toBe("true");
    expect(issuesButton.getAttribute("aria-checked")).toBe("false");

    act(() => {
      issuesButton.click();
    });

    await waitFor(() => {
      expect(screen.queryByText("Fine Guest")).toBeNull();
    });
    expect(screen.getByText("Bounced Guest")).toBeTruthy();
    expect(allButton.getAttribute("aria-checked")).toBe("false");
    expect(issuesButton.getAttribute("aria-checked")).toBe("true");
  });

  it("still renders the live badge when the SSE handshake hasn't connected yet, instead of hiding it (#C)", async () => {
    // Right after page load (or mid-reconnect) useEventStream's `connected` is false for a beat -
    // the badge affirms "this feed receives live updates" as a static design element and must not
    // flicker away for that window; the actual SSE connection health has its own surface elsewhere
    // (e.g. CheckInPage's stream status banner).
    mockStreamConnected = false;
    fetchEventOverview.mockResolvedValue(overviewFixture(5));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Recent activity")).toBeTruthy();
    });
    const activityCard = screen.getByText("Recent activity").closest(".at-card") as HTMLElement;
    const header = activityCard.querySelector(".at-card__header") as HTMLElement;
    expect(within(header).getByText("live")).toBeTruthy();
  });

  it("keeps the Recent activity scroll container mounted (stable card height) even when the Issues filter matches nothing, instead of swapping in a bare paragraph", async () => {
    const recentActivity: EventRecentActivityEntry[] = [
      {
        id: "checkin:ok-1",
        type: "checkin",
        tone: "ok",
        attendee_name: "Fine Guest",
        attendee_id: "att-ok-1",
        message: "checked in",
        occurred_at: new Date().toISOString(),
      },
    ];
    fetchEventOverview.mockResolvedValue(overviewFixture(5, { recent_activity: recentActivity }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Fine Guest")).toBeTruthy();
    });
    // .overview-timeline is the fixed-height scroll container (staff.css) - it must already be
    // present for the populated "All" view.
    expect(document.querySelector(".overview-timeline")).toBeTruthy();

    const activityCard = screen.getByText("Recent activity").closest(".at-card") as HTMLElement;
    const header = activityCard.querySelector(".at-card__header") as HTMLElement;
    act(() => {
      within(header).getByRole("radio", { name: "Issues" }).click();
    });

    await waitFor(() => {
      expect(screen.getByText("No issues right now")).toBeTruthy();
    });
    // The empty state renders *inside* .overview-timeline, not as a sibling replacing it - so the
    // container (and the card's footprint) never disappears when a filter matches zero items.
    // It's also centered in the fixed-height box (#A2), not pinned to the top over dead space.
    const timeline = document.querySelector(".overview-timeline");
    expect(timeline).toBeTruthy();
    expect(timeline?.className).toContain("overview-timeline--empty");
    expect(within(timeline as HTMLElement).getByText("No issues right now")).toBeTruthy();
    expect(within(timeline as HTMLElement).getByText("Everything's running smoothly.")).toBeTruthy();
  });

  it("links a checkin/mail activity entry with an attendee_id to that attendee's detail page, and leaves attendee-less entries (imports) unlinked (#E4)", async () => {
    const recentActivity: EventRecentActivityEntry[] = [
      {
        id: "checkin:linked-1",
        type: "checkin",
        tone: "ok",
        attendee_name: "Linked Guest",
        attendee_id: "att-linked-1",
        message: "checked in",
        occurred_at: new Date().toISOString(),
      },
      {
        id: "import:batch-1",
        type: "import",
        tone: "muted",
        attendee_id: null,
        message: "4 attendees imported",
        occurred_at: new Date().toISOString(),
      },
    ];
    fetchEventOverview.mockResolvedValue(overviewFixture(5, { recent_activity: recentActivity }));

    renderPage();

    const attendeeLink = await screen.findByRole("link", { name: "Linked Guest" });
    expect(attendeeLink.getAttribute("href")).toBe("/admin/events/evt-1/attendees/att-linked-1");

    // The import entry has no single attendee - its message renders as plain text, not a link.
    expect(screen.getByText("4 attendees imported").closest("a")).toBeNull();
  });

  it("keeps the merged Recent activity feed sorted newest-first after reconcile, even when a live check-in ages out of the server's own capped window (CodeRabbit)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchEventOverview.mockResolvedValueOnce(overviewFixture(5));

      renderPage();

      await waitFor(() => {
        expect(admittedLegendValue()).toBe("5");
      });

      act(() => {
        streamHandler?.({ ...liveEvent, attendeeName: "Stale Guest", admittedAt: "2020-01-01T00:00:00.000Z" });
      });

      await waitFor(() => {
        expect(screen.getByText("Stale Guest")).toBeTruthy();
      });

      // Reconcile poll returns a genuinely newer server activity that does NOT include the stale
      // live check-in - simulating it having aged out of the server's own RECENT_ACTIVITY_LIMIT
      // window before the 3s reconcile fired. A naive prepend would strand it above this newer row.
      fetchEventOverview.mockResolvedValue(
        overviewFixture(5, {
          recent_activity: [
            {
              id: "import:fresh-1",
              type: "import",
              tone: "muted",
              attendee_id: null,
              message: "4 attendees imported",
              occurred_at: new Date().toISOString(),
            },
          ],
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(() => {
        expect(screen.getByText("4 attendees imported")).toBeTruthy();
      });

      const items = Array.from(document.querySelectorAll(".overview-activity__item"));
      const freshIndex = items.findIndex((el) => el.textContent?.includes("4 attendees imported"));
      const staleIndex = items.findIndex((el) => el.textContent?.includes("Stale Guest"));
      expect(freshIndex).toBeGreaterThanOrEqual(0);
      expect(staleIndex).toBeGreaterThan(freshIndex);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles a live check-in against its server row by attendee_id, not name+timestamp, since SSE's admittedAt and the server's DB-default occurred_at never match exactly (CodeRabbit)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchEventOverview.mockResolvedValueOnce(overviewFixture(5));

      renderPage();

      await waitFor(() => {
        expect(admittedLegendValue()).toBe("5");
      });

      act(() => {
        streamHandler?.({ ...liveEvent, attendeeId: "att-9", attendeeName: "Same Person", admittedAt: "2026-07-22T10:00:00.000Z" });
      });

      await waitFor(() => {
        expect(screen.getByText("Same Person")).toBeTruthy();
      });

      // Reconcile poll's server row is for the SAME attendee (att-9) but a slightly different
      // timestamp - CheckIn.checked_in_at's own DB-side default, not the app's admittedAt clock.
      fetchEventOverview.mockResolvedValue(
        overviewFixture(5, {
          recent_activity: [
            {
              id: "checkin:att-9",
              type: "checkin",
              tone: "ok",
              attendee_name: "Same Person",
              attendee_id: "att-9",
              message: "checked in",
              occurred_at: "2026-07-22T10:00:00.842Z",
            },
          ],
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(() => {
        expect(fetchEventOverview).toHaveBeenCalledTimes(2);
      });

      // Exactly one row for this attendee - the live entry was dropped once the server's own
      // row for the same attendee_id reconciled, not left duplicated by a timestamp mismatch.
      const rows = Array.from(document.querySelectorAll(".overview-activity__item")).filter((el) =>
        el.textContent?.includes("Same Person"),
      );
      expect(rows).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("merges Pinned note, Key contacts, and Links & files into one Notes & contacts card, each with a leading header icon (#344, #345, #346)", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Notes & contacts")).toBeTruthy();
    });

    // All three sub-sections now live inside the same outer card, not three separate cards.
    const notesCard = screen.getByText("Notes & contacts").closest(".at-card") as HTMLElement;
    expect(within(notesCard).getByText("Pinned note")).toBeTruthy();
    expect(within(notesCard).getByText("Key contacts")).toBeTruthy();
    expect(within(notesCard).getByText("Links & files")).toBeTruthy();
    expect(screen.queryByText("Important links & files")).toBeNull();

    // All three headers read as a consistent family: each has a leading icon, always present
    // (not only once its section has content).
    expect(notesCard.querySelector(".ti-pin")).toBeTruthy();
    expect(notesCard.querySelector(".ti-address-book")).toBeTruthy();
    expect(notesCard.querySelector(".ti-paperclip")).toBeTruthy();
  });

  it("opens Key contacts' add flow as a modal dialog instead of expanding inline, and updates the list on save", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));
    mockCreateEventContact.mockResolvedValueOnce({
      id: "c1",
      name: "Jane Doe",
      role: "Security lead",
      phone: null,
      email: null,
      note: null,
      sort_order: 0,
    } satisfies EventContactDto);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Notes & contacts")).toBeTruthy();
    });

    const keyContactsSection = screen.getByText("Key contacts").closest(".overview-notes-section") as HTMLElement;
    expect(screen.queryByRole("dialog")).toBeNull();
    // Starting from zero contacts, the add flow opens from the dashed empty-state tile, not a
    // header button (that only appears once there's at least one contact to add more alongside).
    act(() => {
      within(keyContactsSection).getByRole("button", { name: "Add a key contact" }).click();
    });

    // Renders as a modal dialog, not an inline-expanding form pushing the card content down.
    const dialog = await screen.findByRole("dialog", { name: "Add contact" });
    expect(within(dialog).getByLabelText("Name *")).toBeTruthy();
    expect(document.querySelector(".btn")).toBeNull();

    fireEvent.change(within(dialog).getByLabelText("Name *"), { target: { value: "Jane Doe" } });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "Security lead" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mockCreateEventContact).toHaveBeenCalledWith("evt-1", {
        name: "Jane Doe",
        role: "Security lead",
        phone: null,
        email: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(within(keyContactsSection).getByText("Jane Doe")).toBeTruthy();
  });

  it("opens Key contacts' row edit icon as the same modal used for Add, pre-filled with the contact's data", async () => {
    fetchEventOverview.mockResolvedValue(
      overviewFixture(5, {
        contacts: [
          { id: "c1", name: "Jane Doe", role: "Security lead", phone: null, email: null, note: null, sort_order: 0 },
        ],
      }),
    );
    mockUpdateEventContact.mockResolvedValueOnce({
      id: "c1",
      name: "Jane Doe",
      role: "Ops lead",
      phone: null,
      email: null,
      note: null,
      sort_order: 0,
    } satisfies EventContactDto);

    renderPage();

    const editButton = await screen.findByRole("button", { name: "Edit Jane Doe" });
    fireEvent.click(editButton);

    const dialog = await screen.findByRole("dialog", { name: "Edit contact" });
    // Same shared modal/panel as Add - only the field values and submit label differ.
    expect(dialog.querySelector(".overview-modal__panel")).toBeTruthy();
    const nameField = within(dialog).getByLabelText("Name *") as HTMLInputElement;
    expect(nameField.value).toBe("Jane Doe");

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "Ops lead" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateEventContact).toHaveBeenCalledWith("evt-1", "c1", {
        name: "Jane Doe",
        role: "Ops lead",
        phone: null,
        email: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("opens Links & files' add flow as a modal dialog and updates the list on save", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));
    mockCreateEventResource.mockResolvedValueOnce({
      id: "r1",
      title: "Venue floor plan",
      type: "link",
      url: "https://example.com/floor-plan",
      description: null,
      sort_order: 0,
    } satisfies EventResourceDto);

    renderPage();

    const linksSection = await screen.findByText("Links & files").then((el) => el.closest(".overview-notes-section") as HTMLElement);
    // Starting from zero resources, the add flow opens from the dashed empty-state tile.
    act(() => {
      within(linksSection).getByRole("button", { name: "Add a link or file" }).click();
    });

    const dialog = await screen.findByRole("dialog", { name: "Add link or file" });
    fireEvent.change(within(dialog).getByLabelText("Title *"), { target: { value: "Venue floor plan" } });
    fireEvent.change(within(dialog).getByLabelText("URL *"), {
      target: { value: "https://example.com/floor-plan" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mockCreateEventResource).toHaveBeenCalledWith("evt-1", {
        title: "Venue floor plan",
        type: "link",
        url: "https://example.com/floor-plan",
        description: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(within(linksSection).getByText("Venue floor plan")).toBeTruthy();
  });

  it("shows a specific inline validation message for an invalid URL instead of a vague save failure, and never calls the API (#D3)", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));

    renderPage();

    const linksSection = await screen.findByText("Links & files").then((el) => el.closest(".overview-notes-section") as HTMLElement);
    // Starting from zero resources, the add flow opens from the dashed empty-state tile.
    act(() => {
      within(linksSection).getByRole("button", { name: "Add a link or file" }).click();
    });

    const dialog = await screen.findByRole("dialog", { name: "Add link or file" });
    fireEvent.change(within(dialog).getByLabelText("Title *"), { target: { value: "Broken link" } });
    fireEvent.change(within(dialog).getByLabelText("URL *"), { target: { value: "not-a-url" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(
      within(dialog).getByText("Enter a valid URL starting with http:// or https://"),
    ).toBeTruthy();
    expect(mockCreateEventResource).not.toHaveBeenCalled();

    // Editing the field clears the inline error instead of leaving a stale message.
    fireEvent.change(within(dialog).getByLabelText("URL *"), {
      target: { value: "https://example.com/fixed" },
    });
    expect(
      within(dialog).queryByText("Enter a valid URL starting with http:// or https://"),
    ).toBeNull();
  });

  it("renders the Pinned note empty state as a dashed add button (not a header button), and saving through its modal fills the section without an inline expansion", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));
    mockPatchEventNote.mockResolvedValueOnce(undefined);

    renderPage();

    const addNote = await screen.findByRole("button", { name: "Add a pinned note for staff" });
    expect(addNote.className).toContain("overview-note-empty");
    // The old header-level "Add note" action is gone - only the dashed empty-state button remains.
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();

    fireEvent.click(addNote);
    const dialog = await screen.findByRole("dialog", { name: "Add pinned note" });
    fireEvent.change(within(dialog).getByPlaceholderText("Short operational note visible to all staff…"), {
      target: { value: "Gate B is closed today" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchEventNote).toHaveBeenCalledWith("evt-1", "Gate B is closed today");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByText("Gate B is closed today")).toBeTruthy();
    // Filled state now shows the standard Edit action, same placement as before this change.
    expect(screen.getByRole("button", { name: "Edit pinned note" })).toBeTruthy();
  });

  it("renders Key contacts and Links & files empty states as the same dashed add tile as Pinned note, with no header Add button until something exists (PO review)", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));

    renderPage();

    const keyContactsSection = await screen
      .findByText("Key contacts")
      .then((el) => el.closest(".overview-notes-section") as HTMLElement);
    const addContact = within(keyContactsSection).getByRole("button", { name: "Add a key contact" });
    expect(addContact.className).toContain("overview-note-empty");
    expect(within(keyContactsSection).queryByRole("button", { name: "Add" })).toBeNull();

    const linksSection = screen.getByText("Links & files").closest(".overview-notes-section") as HTMLElement;
    const addLink = within(linksSection).getByRole("button", { name: "Add a link or file" });
    expect(addLink.className).toContain("overview-note-empty");
    expect(within(linksSection).queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("shows the header Add button (not the dashed tile) for Key contacts and Links & files once at least one row already exists", async () => {
    fetchEventOverview.mockResolvedValue(
      overviewFixture(5, {
        contacts: [
          { id: "c1", name: "Jane Doe", role: "Security lead", phone: null, email: null, note: null, sort_order: 0 },
        ],
        resources: [
          { id: "r1", title: "Venue floor plan", type: "link", url: "https://example.com/floor-plan", description: null, sort_order: 0 },
        ],
      }),
    );

    renderPage();

    const keyContactsSection = await screen
      .findByText("Key contacts")
      .then((el) => el.closest(".overview-notes-section") as HTMLElement);
    expect(within(keyContactsSection).getByRole("button", { name: "Add" })).toBeTruthy();
    expect(within(keyContactsSection).queryByRole("button", { name: "Add a key contact" })).toBeNull();

    const linksSection = screen.getByText("Links & files").closest(".overview-notes-section") as HTMLElement;
    expect(within(linksSection).getByRole("button", { name: "Add" })).toBeTruthy();
    expect(within(linksSection).queryByRole("button", { name: "Add a link or file" })).toBeNull();
  });

  it("shows an icon empty state instead of a permanent 0% ring on Check-in progress when the event has no attendees yet (PO review)", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(0, { attendee_count: 0 }));

    renderPage();

    const checkInCard = await screen
      .findByText("Check-in progress")
      .then((el) => el.closest(".at-card") as HTMLElement);
    expect(within(checkInCard).getByText("No attendees yet")).toBeTruthy();
    expect(within(checkInCard).getByText("Import attendees to start tracking check-ins.")).toBeTruthy();
    expect(checkInCard.querySelector(".overview-ring")).toBeNull();
  });

  it("renders the Pinned note filled state on the standard card surface, not a custom warn-tinted wrapper (#347)", async () => {
    fetchEventOverview.mockResolvedValue(
      overviewFixture(5, { event: { ...overviewFixture(5).event, pinned_note: "Gate B is closed today" } }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Gate B is closed today")).toBeTruthy();
    });
    expect(document.querySelector(".overview-pinned-note")).toBeNull();
  });
});
