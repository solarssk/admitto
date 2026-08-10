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

  it("hides Link name and still submits an auto-generated slug from the title", async () => {
    mockCreateEvent.mockResolvedValueOnce({
      id: "evt-1",
      title: "Autumn Summit 2026",
      slug: "autumn-summit-2026",
      date: "2026-09-29",
      timezone: "Europe/Warsaw",
      location: null,
      organization_id: "org-1",
      archived_at: null,
    });
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Event title/), {
      target: { value: "Autumn Summit 2026" },
    });
    expect(screen.queryByLabelText(/Link name/)).toBeNull();
    pickEventDate("2026-09-29");
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => {
      expect(mockCreateEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Autumn Summit 2026",
          slug: "autumn-summit-2026",
        }),
      );
    });
  });

  it("keeps Create enabled for a non-ASCII title via a stable event-* slug fallback", async () => {
    mockCreateEvent.mockResolvedValueOnce({
      id: "evt-cyr",
      title: "Осенний саммит",
      slug: "event-placeholder",
      date: "2026-09-29",
      timezone: "Europe/Warsaw",
      location: null,
      organization_id: "org-1",
      archived_at: null,
    });
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Event title/), {
      target: { value: "Осенний саммит" },
    });
    pickEventDate("2026-09-29");

    expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => {
      expect(mockCreateEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Осенний саммит",
          slug: expect.stringMatching(/^event-[a-z0-9]+$/),
        }),
      );
    });
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

  it("shows a title-focused error when creation returns 409", async () => {
    mockCreateEvent.mockRejectedValueOnce(new ApiError(409, "slug_taken"));
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Event title/), { target: { value: "Test Event" } });
    pickEventDate("2026-09-29");
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    expect(
      await screen.findByText(
        "An event with a similar name already exists. Change the title slightly and try again.",
      ),
    ).toBeTruthy();
  });

  it("mentions Optional only once on the location field", () => {
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByText("Add a title and date.")).toBeTruthy();
    expect(screen.getByLabelText("Location (optional)")).toBeTruthy();
    expect(screen.queryByText(/Location is optional/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Find on map" })).toBeNull();
  });

  it("ignores close while submission is pending", async () => {
    let resolveCreate!: () => void;
    mockCreateEvent.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = () => resolve({
          id: "evt-1",
          title: "Test Event",
          slug: "test-event",
          date: "2026-09-29",
          timezone: "Europe/Warsaw",
          location: null,
          organization_id: "org-1",
          archived_at: null,
        });
      }),
    );
    const onClose = vi.fn();
    render(<CreateEventModal open onClose={onClose} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Event title/), { target: { value: "Test Event" } });
    pickEventDate("2026-09-29");
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    resolveCreate();
  });

  it("closes and resets when Escape is pressed while idle", () => {
    const onClose = vi.fn();
    render(<CreateEventModal open onClose={onClose} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Event title/), { target: { value: "Draft" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <CreateEventModal open={false} onClose={() => {}} onCreated={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("keeps Create disabled until the required fields are filled", () => {
    render(<CreateEventModal open onClose={() => {}} onCreated={() => {}} />);
    const submit = screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("uses formatted_address as the venue name when a suggestion has no POI name", async () => {
    mockSearchGeocoding.mockResolvedValueOnce({
      results: [
        {
          formatted_address: "1 Example Square, Warsaw",
          latitude: 52.2297,
          longitude: 21.0122,
          provider: "nominatim",
        },
      ],
      contact_configured: true,
    });
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
    fireEvent.change(screen.getByLabelText("Location (optional)"), {
      target: { value: "Example Square" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /1 Example Square/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => {
      expect(mockCreateEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          venue_name: "1 Example Square, Warsaw",
          formatted_address: "1 Example Square, Warsaw",
          latitude: 52.2297,
          longitude: 21.0122,
        }),
      );
    });
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
