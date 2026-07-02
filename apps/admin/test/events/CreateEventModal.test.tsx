// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEventModal } from "../../src/events/CreateEventModal.js";
import * as eventDates from "../../src/utils/event-dates.js";

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  createEvent: vi.fn(),
}));

afterEach(cleanup);

function pickEventDate(iso: string) {
  fireEvent.click(screen.getByRole("button", { name: /Event date/ }));
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
});
