// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "../../src/components/DatePicker.js";
import * as eventDates from "../../src/utils/event-dates.js";

afterEach(cleanup);

describe("DatePicker", () => {
  it("shows placeholder when empty", () => {
    render(<DatePicker value="" onChange={() => {}} label="Date" />);
    expect(screen.getByText("Pick a date…")).toBeTruthy();
  });

  it("shows formatted selected date on the trigger", () => {
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockReturnValue("2 Jul 2026");
    render(<DatePicker value="2026-07-02" onChange={() => {}} label="Date" />);
    expect(screen.getByRole("button").textContent).toContain("2 Jul 2026");
  });

  it("opens a calendar panel and selects a day", () => {
    const onChange = vi.fn();
    vi.spyOn(eventDates, "todayIsoDate").mockReturnValue("2026-07-02");
    vi.spyOn(eventDates, "formatCalendarMonth").mockReturnValue("July 2026");
    vi.spyOn(eventDates, "getWeekdayLabelsShort").mockReturnValue([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockImplementation((iso) => iso);

    render(<DatePicker value="" onChange={onChange} label="Date" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("dialog", { name: "Choose date" })).toBeTruthy();
    fireEvent.click(screen.getByRole("gridcell", { name: "2026-07-15" }));
    expect(onChange).toHaveBeenCalledWith("2026-07-15");
  });

  it("sets today from the footer action", () => {
    const onChange = vi.fn();
    vi.spyOn(eventDates, "todayIsoDate").mockReturnValue("2026-07-02");
    vi.spyOn(eventDates, "formatCalendarMonth").mockReturnValue("July 2026");
    vi.spyOn(eventDates, "getWeekdayLabelsShort").mockReturnValue([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);

    render(<DatePicker value="" onChange={onChange} label="Date" />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onChange).toHaveBeenCalledWith("2026-07-02");
  });
});
