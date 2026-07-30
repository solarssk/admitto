// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { EventCard, eventGridClassName } from "../../src/components/EventCard.js";
import type { EventCardProps } from "../../src/components/EventCard.js";
import type { EventDto } from "../../src/api/types.js";

afterEach(() => {
  cleanup();
});

const baseEvent: EventDto = {
  id: "evt-1",
  title: "Spring Summit",
  slug: "spring-summit",
  date: "2026-05-01",
  timezone: "Europe/Warsaw",
  location: "Warsaw",
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

describe("EventCard", () => {
  it("links to href and carries the full event through router state", () => {
    renderCard();
    const link = screen.getByRole("link", { name: /Spring Summit/ });
    expect(link.getAttribute("href")).toBe("/to");

    fireEvent.click(link);
    expect(screen.getByText("state-event-id:evt-1")).toBeTruthy();
  });

  it("hides the status badge and attendee count by default", () => {
    renderCard();
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Archived")).toBeNull();
    expect(screen.queryByText("attendees")).toBeNull();
  });

  it("shows an Active badge for a non-archived event when showStatusBadge is set", () => {
    renderCard({ showStatusBadge: true });
    expect(screen.getByText("Active")).toBeTruthy();
    expect(document.querySelector(".event-card")?.className).not.toContain("event-card--archived");
  });

  it("shows an Archived badge and the archived card class for an archived event", () => {
    renderCard({ showStatusBadge: true }, { ...baseEvent, archived_at: "2026-06-01T00:00:00.000Z" });
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(document.querySelector(".event-card")?.className).toContain("event-card--archived");
  });

  it("shows the attendee count when showAttendeeCount is set and attendee_count is present", () => {
    renderCard({ showAttendeeCount: true });
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("attendees")).toBeTruthy();
  });

  it("hides the attendee count when showAttendeeCount is set but attendee_count is missing", () => {
    renderCard({ showAttendeeCount: true }, { ...baseEvent, attendee_count: undefined });
    expect(screen.queryByText("attendees")).toBeNull();
  });

  it("adds the touch modifier class when touch is set", () => {
    renderCard({ touch: true });
    expect(document.querySelector(".event-card")?.className).toContain("event-card--touch");
  });

  it("omits the location separator and pin icon when location is null", () => {
    renderCard({}, { ...baseEvent, location: null });
    expect(screen.queryByText("Warsaw")).toBeNull();
    expect(document.querySelector(".ti-map-pin")).toBeNull();
  });
});

describe("eventGridClassName", () => {
  it("has no column modifier for zero events", () => {
    expect(eventGridClassName(0)).toBe("event-grid");
  });

  it("uses two columns for 1-3 events", () => {
    expect(eventGridClassName(1)).toBe("event-grid event-grid--cols-2");
    expect(eventGridClassName(3)).toBe("event-grid event-grid--cols-2");
  });

  it("uses three columns for 4 or more events", () => {
    expect(eventGridClassName(4)).toBe("event-grid event-grid--cols-3");
    expect(eventGridClassName(10)).toBe("event-grid event-grid--cols-3");
  });
});
