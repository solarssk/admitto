// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "../../src/components/DatePicker.js";
import * as eventDates from "../../src/utils/event-dates.js";

afterEach(cleanup);

describe("DatePicker", () => {
  it("shows placeholder when empty", () => {
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");
    render(<DatePicker value="" onChange={() => {}} label="Date" />);
    expect(screen.getByPlaceholderText("dd.mm.yyyy")).toBeTruthy();
  });

  it("shows formatted selected date in the input", () => {
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockReturnValue("2 Jul 2026");
    render(<DatePicker value="2026-07-02" onChange={() => {}} label="Date" />);
    expect(screen.getByDisplayValue("2 Jul 2026")).toBeTruthy();
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
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");

    render(<DatePicker value="" onChange={onChange} label="Date" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(screen.getByRole("dialog", { name: "Choose date" })).toBeTruthy();
    fireEvent.click(screen.getByRole("gridcell", { name: "2026-07-15" }));
    expect(onChange).toHaveBeenCalledWith("2026-07-15");
  });

  it("parses typed ISO dates on blur", () => {
    const onChange = vi.fn();
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");
    vi.spyOn(eventDates, "parseFlexibleCalendarDate").mockReturnValue("2026-08-20");
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockReturnValue("20 Aug 2026");

    render(<DatePicker value="" onChange={onChange} label="Date" />);
    const input = screen.getByLabelText(/date/i);
    fireEvent.change(input, { target: { value: "2026-08-20" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("2026-08-20");
  });

  it("clears parent value when typed date is invalid on blur", () => {
    const onChange = vi.fn();
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockReturnValue("2 Jul 2026");
    vi.spyOn(eventDates, "parseFlexibleCalendarDate").mockReturnValue(null);

    render(<DatePicker value="2026-07-02" onChange={onChange} label="Date" />);
    const input = screen.getByLabelText(/date/i);
    fireEvent.change(input, { target: { value: "not-a-date" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("");
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
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockReturnValue("2 Jul 2026");
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");

    render(<DatePicker value="" onChange={onChange} label="Date" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onChange).toHaveBeenCalledWith("2026-07-02");
  });

  it("closes on Escape and returns focus to the input", async () => {
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
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");

    render(<DatePicker value="" onChange={() => {}} label="Date" />);
    const input = screen.getByLabelText(/date/i);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const panel = screen.getByRole("dialog", { name: "Choose date" });
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Choose date" })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("moves highlight with arrow keys and selects with Enter", () => {
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
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");

    render(<DatePicker value="2026-07-02" onChange={onChange} label="Date" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const panel = screen.getByRole("dialog", { name: "Choose date" });
    fireEvent.keyDown(panel, { key: "ArrowRight" });
    fireEvent.keyDown(panel, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("2026-07-03");
  });

  it("allows navigating to another month when editing an existing date", () => {
    const onChange = vi.fn();
    vi.spyOn(eventDates, "todayIsoDate").mockReturnValue("2026-07-02");
    vi.spyOn(eventDates, "formatCalendarMonth").mockImplementation((year, month) => `${year}-${month}`);
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
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");

    render(<DatePicker value="2026-07-15" onChange={onChange} label="Date" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(screen.getByText("2026-7")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("2026-8")).toBeTruthy();

    fireEvent.click(screen.getByRole("gridcell", { name: "2026-08-20" }));
    expect(onChange).toHaveBeenCalledWith("2026-08-20");
  });
});
