// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EventOverviewPage } from "../../src/pages/EventOverviewPage.js";
import type {
  EventContactDto,
  EventOverviewDto,
  EventRecentActivityEntry,
  EventResourceDto,
} from "../../src/api/types.js";
import type { StreamCheckinEvent } from "../../src/hooks/useEventStream.js";
import { makeTicketType, renderWithToast } from "../test-utils.js";

const fetchEventOverview = vi.fn();
const fetchTicketTypes = vi.fn();
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

/** The 4 KPI tiles - scope queries here since several plain numbers/labels (e.g. the admitted
 * count, "Checked in") also appear in the Check-in progress card's ring legend. */
function statsRow(): HTMLElement {
  return document.querySelector(".overview-stats") as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  streamHandler = null;
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
      expect(within(statsRow()).getByText("5")).toBeTruthy();
    });

    act(() => {
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(within(statsRow()).getByText("6")).toBeTruthy();
    });

    await waitFor(
      () => {
        expect(fetchEventOverview).toHaveBeenCalledTimes(2);
        expect(within(statsRow()).getByText("6")).toBeTruthy();
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
        expect(within(statsRow()).getByText("5")).toBeTruthy();
      });

      act(() => {
        streamHandler?.(liveEvent);
      });

      await waitFor(() => {
        expect(within(statsRow()).getByText("6")).toBeTruthy();
      });

      fetchEventOverview.mockResolvedValue(overviewFixture(6));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      await waitFor(() => {
        expect(within(statsRow()).getByText("6")).toBeTruthy();
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
        expect(within(statsRow()).getByText("5")).toBeTruthy();
      });

      act(() => {
        streamHandler?.(liveEvent);
      });

      await waitFor(() => {
        expect(within(statsRow()).getByText("6")).toBeTruthy();
      });

      fetchEventOverview.mockResolvedValue(overviewFixture(6));

      // Reconcile at 3s is within the 5s admit-dedup TTL; absorbServerOverview prunes stale keys only.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      await waitFor(() => {
        expect(within(statsRow()).getByText("6")).toBeTruthy();
        expect(fetchEventOverview).toHaveBeenCalledTimes(2);
      });

      act(() => {
        streamHandler?.(liveEvent);
      });

      expect(within(statsRow()).getByText("6")).toBeTruthy();
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
      expect(within(statsRow()).getByText("5")).toBeTruthy();
    });

    act(() => {
      streamHandler?.(liveEvent);
      streamHandler?.(liveEvent);
    });

    await waitFor(() => {
      expect(within(statsRow()).getByText("6")).toBeTruthy();
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
      expect(within(statsRow()).getByText("6")).toBeTruthy();
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
    expect(within(statsRow()).getByText("6")).toBeTruthy();
  });

  it("resolves a live check-in's ticket_type key to the catalog's current label instead of the key (batch 04 / #351), in the Recent activity feed", async () => {
    fetchEventOverview.mockResolvedValue(overviewFixture(5));
    fetchTicketTypes.mockResolvedValue([makeTicketType("vip", "VIP Guest")]);

    renderPage();

    await waitFor(() => {
      expect(within(statsRow()).getByText("5")).toBeTruthy();
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
      expect(within(statsRow()).getByText("5")).toBeTruthy();
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
    // Fixture's event.capacity is 100, so the sub-label is the capacity phrasing, not "Active".
    expect(screen.getByText("of 100 capacity")).toBeTruthy();
  });

  it("replaces the duplicate-date Event date tile with a Failed delivery tile and labels the KPI row per the mockup (#350)", async () => {
    fetchEventOverview.mockResolvedValue(
      overviewFixture(5, { email_failed: 2, email_bounced: 1 }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Attendees")).toBeTruthy();
    });
    // "Checked in" also appears in the Check-in progress card's ring legend - scope to the KPI row.
    expect(within(statsRow()).getByText("Tickets sent")).toBeTruthy();
    expect(within(statsRow()).getByText("Checked in")).toBeTruthy();
    expect(within(statsRow()).getByText("Failed delivery")).toBeTruthy();
    expect(within(statsRow()).getByText("3")).toBeTruthy();
    expect(within(statsRow()).getByText("Needs attention")).toBeTruthy();
    expect(screen.queryByText("Event date")).toBeNull();
  });

  it("merges Needs attention + Event readiness into a single Setup checklist card (#348)", async () => {
    fetchEventOverview.mockResolvedValue(
      overviewFixture(5, { checkin_staff_count: 0, attendee_count: 0, attendees_with_ticket: 0 }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Setup checklist")).toBeTruthy();
    });
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByText("Event readiness")).toBeNull();
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

  it("shows an honest em-dash placeholder for Last check-in and Busiest hour with zero check-ins, not a fabricated value (#F1)", async () => {
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
      expect(within(tile as HTMLElement).getByText("—")).toBeTruthy();
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
    expect(within(header).getByRole("button", { name: "All" })).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Issues" })).toBeTruthy();
    expect(within(header).getByText("live")).toBeTruthy();

    act(() => {
      within(header).getByRole("button", { name: "Issues" }).click();
    });

    await waitFor(() => {
      expect(screen.queryByText("Fine Guest")).toBeNull();
    });
    expect(screen.getByText("Bounced Guest")).toBeTruthy();
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
    act(() => {
      within(keyContactsSection).getByRole("button", { name: "Add" }).click();
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
    act(() => {
      within(linksSection).getByRole("button", { name: "Add" }).click();
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
    act(() => {
      within(linksSection).getByRole("button", { name: "Add" }).click();
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
