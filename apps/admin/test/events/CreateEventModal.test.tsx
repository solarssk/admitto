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
  };
});

import { createEvent } from "../../src/api/client.js";
import { ApiError } from "../../src/api/client.js";

const mockCreateEvent = vi.mocked(createEvent);

afterEach(cleanup);

function pickEventDate(iso: string) {
  fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
  fireEvent.click(screen.getByRole("gridcell", { name: iso }));
}

describe("CreateEventModal", () => {
  beforeEach(() => {
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
});
