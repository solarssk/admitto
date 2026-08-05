// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { EventCard, eventGridClassName } from "../../src/components/EventCard.js";
import type { EventCardProps } from "../../src/components/EventCard.js";
import type { EventDto } from "../../src/api/types.js";
import { eventCardDateParts, eventCardStatus } from "../../src/utils/event-card-status.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const baseEvent: EventDto = {
  id: "evt-1",
  title: "Spring Summit",
  slug: "spring-summit",
  date: "2026-09-15T12:00:00.000Z",
  timezone: "Europe/Warsaw",
  location: "Warsaw",
  has_coordinates: true,
  map_preview_path: "/m/evt-1.png?v=9_52.230000_21.010000_z15&context=list",
  map_attribution: "© OpenStreetMap contributors",
  organization_id: "org-1",
  archived_at: null,
  attendee_count: 42,
};

function LocationProbe() {
  const location = useLocation();
  const state = location.state as { event?: EventDto } | null;
  return <p>state-event-id:{state?.event?.id ?? "none"}</p>;
}

function renderCard(
  overrides: Partial<Omit<EventCardProps, "event" | "href">> = {},
  event: EventDto = baseEvent,
) {
  return render(
    <MemoryRouter initialEntries={["/from"]}>
      <Routes>
        <Route path="/from" element={<EventCard event={event} href="/to" {...overrides} />} />
        <Route path="/to" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("eventCardDateParts", () => {
  it("uses the UTC calendar day from the stored event date", () => {
    expect(eventCardDateParts("2026-06-02T12:00:00.000Z")).toEqual({ month: "JUN", day: "2" });
  });

  it("returns em dashes for an invalid date", () => {
    expect(eventCardDateParts("not-a-date")).toEqual({ month: "—", day: "—" });
  });
});

describe("eventCardStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00.000Z"));
  });

  it("labels archived events", () => {
    expect(
      eventCardStatus({
        date: "2026-03-12T12:00:00.000Z",
        timezone: "Europe/Warsaw",
        archived_at: "2026-04-01T00:00:00.000Z",
      }),
    ).toEqual({ label: "Archived", variant: "neutral" });
  });

  it("labels past active events as Needs archiving", () => {
    expect(
      eventCardStatus({
        date: "2026-06-02T12:00:00.000Z",
        timezone: "Europe/Warsaw",
        archived_at: null,
      }),
    ).toEqual({ label: "Needs archiving", variant: "warn" });
  });

  it("labels far-future events as In N days", () => {
    expect(
      eventCardStatus({
        date: "2026-09-29T12:00:00.000Z",
        timezone: "Europe/Warsaw",
        archived_at: null,
      }),
    ).toEqual({ label: "In 57 days", variant: "neutral" });
  });

  it("falls back to Active when the date is empty", () => {
    expect(
      eventCardStatus({
        date: "",
        timezone: "Europe/Warsaw",
        archived_at: null,
      }),
    ).toEqual({ label: "Active", variant: "neutral" });
  });

  it("labels tomorrow", () => {
    expect(
      eventCardStatus({
        date: "2026-08-04T12:00:00.000Z",
        timezone: "Europe/Warsaw",
        archived_at: null,
      }),
    ).toEqual({ label: "Tomorrow", variant: "neutral" });
  });

  it("labels the event calendar day as Today (date-only, no fabricated hours)", () => {
    vi.setSystemTime(new Date("2026-08-03T08:00:00.000Z"));
    expect(
      eventCardStatus({
        date: "2026-08-03T12:00:00.000Z",
        timezone: "UTC",
        archived_at: null,
      }),
    ).toEqual({ label: "Today", variant: "neutral" });

    vi.setSystemTime(new Date("2026-08-03T23:30:00.000Z"));
    expect(
      eventCardStatus({
        date: "2026-08-03T12:00:00.000Z",
        timezone: "UTC",
        archived_at: null,
      }),
    ).toEqual({ label: "Today", variant: "neutral" });
  });
});

describe("EventCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00.000Z"));
  });

  it("links to href and carries the full event through router state", () => {
    renderCard();
    const link = screen.getByRole("link", { name: /Spring Summit/ });
    expect(link.getAttribute("href")).toBe("/to");

    fireEvent.click(link);
    expect(screen.getByText("state-event-id:evt-1")).toBeTruthy();
  });

  it("hides the status badge and attendee count by default", () => {
    renderCard();
    expect(screen.queryByText("Needs archiving")).toBeNull();
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.queryByText("attendees")).toBeNull();
  });

  it("shows a countdown badge for an upcoming event when showStatusBadge is set", () => {
    renderCard({ showStatusBadge: true });
    expect(screen.getByText("In 43 days")).toBeTruthy();
    expect(document.querySelector(".event-card")?.className).not.toContain("event-card--archived");
    expect(document.querySelector(".at-badge__dot")).toBeNull();
  });

  it("shows an Archived badge and the archived card class for an archived event", () => {
    renderCard({ showStatusBadge: true }, { ...baseEvent, archived_at: "2026-06-01T00:00:00.000Z" });
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(document.querySelector(".event-card")?.className).toContain("event-card--archived");
  });

  it("shows Needs archiving for a past active event", () => {
    renderCard(
      { showStatusBadge: true },
      { ...baseEvent, date: "2026-06-02T12:00:00.000Z" },
    );
    expect(screen.getByText("Needs archiving")).toBeTruthy();
  });

  it("shows the attendee count when showAttendeeCount is set and attendee_count is present", () => {
    renderCard({ showAttendeeCount: true });
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("attendees")).toBeTruthy();
  });

  it("shows Not imported yet when attendee_count is zero", () => {
    renderCard({ showAttendeeCount: true }, { ...baseEvent, attendee_count: 0 });
    expect(screen.getByText("Not imported yet")).toBeTruthy();
  });

  it("hides the attendee count when showAttendeeCount is set but attendee_count is missing", () => {
    renderCard({ showAttendeeCount: true }, { ...baseEvent, attendee_count: undefined });
    expect(screen.queryByText("attendees")).toBeNull();
  });

  it("adds the touch modifier class when touch is set", () => {
    renderCard({ touch: true });
    expect(document.querySelector(".event-card")?.className).toContain("event-card--touch");
  });

  it("renders a map image from map_preview_path", () => {
    renderCard();
    const img = document.querySelector(".event-card__map-img") as HTMLImageElement | null;
    expect(img?.getAttribute("src")).toBe(
      "/m/evt-1.png?v=9_52.230000_21.010000_z15&context=list",
    );
  });

  it("renders Maps unavailable when a pin exists but map previews are disabled", () => {
    renderCard({}, { ...baseEvent, has_coordinates: true, map_preview_path: null });
    expect(document.querySelector(".event-card__map-img")).toBeNull();
    expect(screen.getByText("Maps unavailable")).toBeTruthy();
    expect(screen.queryByText("No location")).toBeNull();
  });

  it("renders a map placeholder when there is no pin", () => {
    renderCard({}, { ...baseEvent, has_coordinates: false, map_preview_path: undefined });
    expect(document.querySelector(".event-card__map-img")).toBeNull();
    expect(screen.getByText("No location")).toBeTruthy();
  });

  it("shows a location placeholder and reserved two-line slot when location is null", () => {
    renderCard({}, { ...baseEvent, location: null });
    expect(screen.getByText("No location set")).toBeTruthy();
    expect(document.querySelector(".event-card__location--empty")).toBeTruthy();
    expect(document.querySelector(".event-card__location")).toBeTruthy();
  });

  it("shows OpenStreetMap attribution on the map when a preview is present", () => {
    renderCard();
    expect(document.querySelector(".event-card__map-attribution")?.textContent).toBe(
      "© OpenStreetMap contributors",
    );
  });

  it("renders configured map_attribution for custom tile providers", () => {
    renderCard(
      {},
      { ...baseEvent, map_attribution: "© CARTO © OpenStreetMap" },
    );
    expect(document.querySelector(".event-card__map-attribution")?.textContent).toBe(
      "© CARTO © OpenStreetMap",
    );
  });

  it("hides map attribution when there is no map preview", () => {
    renderCard({}, { ...baseEvent, map_preview_path: null });
    expect(document.querySelector(".event-card__map-attribution")).toBeNull();
  });

  it("hides the weather chip when weather is omitted and there is no pin", () => {
    renderCard({}, { ...baseEvent, has_coordinates: false, map_preview_path: null });
    expect(document.querySelector(".event-card__weather")).toBeNull();
  });

  it("shows a no-weather chip with a tooltip when a pin exists but weather is omitted", () => {
    renderCard({}, { ...baseEvent, has_coordinates: true, weather: undefined });
    expect(screen.getByLabelText("No weather")).toBeTruthy();
  });

  it("shows forecast temperature when weather status is ok", () => {
    renderCard(
      {},
      {
        ...baseEvent,
        weather: {
          status: "ok",
          temp_c: 22,
          temp_min_c: 14,
          weather_code: 0,
          attribution: "Weather data by MET Norway",
        },
      },
    );
    expect(screen.getByLabelText("Forecast 22°C")).toBeTruthy();
    expect(screen.getByText("22°")).toBeTruthy();
  });

  it("shows a soft chip when forecast is too far out", () => {
    renderCard(
      {},
      {
        ...baseEvent,
        weather: { status: "too_far", opens_in_days: 5, horizon_days: 9 },
      },
    );
    expect(
      screen.getByLabelText("Forecast available 9 days before the event"),
    ).toBeTruthy();
  });

  it("shows unavailable weather chip when the provider fails", () => {
    renderCard(
      {},
      {
        ...baseEvent,
        weather: { status: "unavailable", attribution: "Weather data by MET Norway" },
      },
    );
    expect(screen.getByLabelText("Weather unavailable")).toBeTruthy();
    expect(screen.getByText("-°")).toBeTruthy();
  });

  it("does not render Archive or Unarchive actions", () => {
    renderCard({ showStatusBadge: true, showAttendeeCount: true });
    expect(screen.queryByRole("button", { name: /Archive/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Unarchive/i })).toBeNull();
  });
});

describe("eventGridClassName", () => {
  it("has no column modifier for zero events", () => {
    expect(eventGridClassName(0)).toBe("event-grid");
  });

  it("uses two columns whenever there is at least one event", () => {
    expect(eventGridClassName(1)).toBe("event-grid event-grid--cols-2");
    expect(eventGridClassName(3)).toBe("event-grid event-grid--cols-2");
    expect(eventGridClassName(4)).toBe("event-grid event-grid--cols-2");
    expect(eventGridClassName(10)).toBe("event-grid event-grid--cols-2");
  });
});
