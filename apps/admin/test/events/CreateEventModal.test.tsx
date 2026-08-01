// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEventModal } from "../../src/events/CreateEventModal.js";
import * as eventDates from "../../src/utils/event-dates.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    createEvent: vi.fn(),
    searchGeocoding: vi.fn(),
  };
});

import { createEvent, searchGeocoding } from "../../src/api/client.js";
import { ApiError } from "../../src/api/client.js";

const mockCreateEvent = vi.mocked(createEvent);
const mockSearchGeocoding = vi.mocked(searchGeocoding);

afterEach(cleanup);

function pickEventDate(iso: string) {
  fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
  fireEvent.click(screen.getByRole("gridcell", { name: iso }));
}

describe("CreateEventModal", () => {
  beforeEach(() => {
    mockCreateEvent.mockReset();
    mockSearchGeocoding.mockReset();
    mockSearchGeocoding.mockResolvedValue({ results: [], contact_configured: true });
    vi.spyOn(eventDates, "todayIsoDate").mockReturnValue("2026-09-01");
    vi.spyOn(eventDates, "formatCalendarMonth").mockReturnValue("September 2026");
    vi.spyOn(eventDates, "getWeekdayLabelsShort").mockReturnValue([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockImplementation((value) => value);
  });

  it("auto-generates slug from title until slug is manually edited", () => {
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Event title/), {
      target: { value: "Autumn Summit 2026" },
    });

    expect((screen.getByLabelText(/URL slug/) as HTMLInputElement).value).toBe("autumn-summit-2026");
  });

  it("keeps submit disabled until date is set", () => {
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Event title/), {
      target: { value: "Test Event" },
    });

    expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    pickEventDate("2026-09-29");

    expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("shows operator-safe create failure", async () => {
    mockCreateEvent.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Event title/), { target: { value: "Test Event" } });
    pickEventDate("2026-09-29");
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => {
      expect(screen.getByText(/Failed to create event/)).toBeTruthy();
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("drops a selected suggestion's coordinates after manually editing the venue", async () => {
    const result = {
      name: "Convention Center",
      formatted_address: "1 Example Square, Warsaw",
      latitude: 52.2297,
      longitude: 21.0122,
      provider: "nominatim",
    };
    mockSearchGeocoding.mockResolvedValueOnce({ results: [result], contact_configured: true });
    mockCreateEvent.mockResolvedValueOnce({
      id: "evt-1",
      title: "Test Event",
      slug: "test-event",
      date: "2026-09-29",
      timezone: "Europe/Warsaw",
      location: null,
      organization_id: "org-1",
      archived_at: null,
    });
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Event title/), { target: { value: "Test Event" } });
    pickEventDate("2026-09-29");
    const venue = screen.getByLabelText("Location (optional)");
    fireEvent.change(venue, { target: { value: "Convention Center" } });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));
    fireEvent.click(await screen.findByRole("button", { name: /Convention Center/ }));

    fireEvent.change(venue, { target: { value: "Convention Center Annex" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => {
      expect(mockCreateEvent).toHaveBeenCalledWith({
        title: "Test Event",
        slug: "test-event",
        date: "2026-09-29",
        timezone: expect.any(String),
        venue_name: "Convention Center Annex",
        formatted_address: undefined,
        latitude: undefined,
        longitude: undefined,
        geocoding_provider: undefined,
      });
    });
  });
});
