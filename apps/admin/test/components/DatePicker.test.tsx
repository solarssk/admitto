// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
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

  it("clears parent value when typed date is invalid on blur", async () => {
    function Harness() {
      const [value, setValue] = useState("2026-07-02");
      return <DatePicker value={value} onChange={setValue} label="Date" />;
    }
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockReturnValue("2 Jul 2026");
    vi.spyOn(eventDates, "parseFlexibleCalendarDate").mockReturnValue(null);

    render(<Harness />);
    const input = screen.getByLabelText(/date/i);
    fireEvent.change(input, { target: { value: "not-a-date" } });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("not-a-date");
    });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/valid date/i);
    });
    expect((input as HTMLInputElement).value).toBe("not-a-date");
  });

  it("keeps invalid typed text and error after blur without clearing the message", async () => {
    function Harness() {
      const [value, setValue] = useState("");
      return <DatePicker value={value} onChange={setValue} label="Date" />;
    }
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");
    vi.spyOn(eventDates, "parseFlexibleCalendarDate").mockReturnValue(null);

    render(<Harness />);
    const input = screen.getByLabelText(/date/i);
    fireEvent.change(input, { target: { value: "3." } });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("3.");
    });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/valid date/i);
    });
    expect((input as HTMLInputElement).value).toBe("3.");
  });

  it("does not clear value when Enter is pressed on an unchanged display date", () => {
    const onChange = vi.fn();
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockReturnValue("2 Jul 2026");

    render(<DatePicker value="2026-07-02" onChange={onChange} label="Date" />);
    const input = screen.getByLabelText(/date/i);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps parent value when blurring unchanged localized display text", () => {
    const onChange = vi.fn();
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");
    vi.spyOn(eventDates, "formatIsoCalendarDate").mockReturnValue("2 Jul 2026");
    vi.spyOn(eventDates, "parseFlexibleCalendarDate").mockReturnValue(null);

    render(<DatePicker value="2026-07-02" onChange={onChange} label="Date" />);
    const input = screen.getByLabelText(/date/i);
    fireEvent.change(input, { target: { value: "2 Jul 2026" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
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

  it("closes without stealing focus back when the user tabs to a control outside the panel", async () => {
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

    render(
      <div>
        <DatePicker value="" onChange={() => {}} label="Date" />
        <button type="button">Next field</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(screen.getByRole("dialog", { name: "Choose date" })).toBeTruthy();

    const nextField = screen.getByRole("button", { name: "Next field" });
    fireEvent.focusIn(nextField);

    expect(screen.queryByRole("dialog", { name: "Choose date" })).toBeNull();
    // Unlike Escape, a Tab-driven close must not pull focus back to the input — that would
    // trap keyboard navigation instead of letting it continue to the next field.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(screen.getByLabelText(/date/i));
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
