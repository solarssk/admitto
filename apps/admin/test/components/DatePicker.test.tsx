// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DatePicker } from "../../src/components/DatePicker.js";
import * as eventDates from "../../src/utils/event-dates.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockOpenCalendarBasics() {
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
}

/** Stubs the layout reads DatePicker's placement effect uses - jsdom has no real layout engine,
 * so getBoundingClientRect/scrollHeight/offsetWidth/innerWidth/innerHeight all default to 0. */
function mockPlacementLayout(opts: {
  rect: { top: number; bottom: number; left: number };
  panelHeight: number;
  panelWidth: number;
  innerWidth: number;
  innerHeight: number;
}) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(opts.rect as DOMRect);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(opts.panelHeight);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(opts.panelWidth);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(opts.innerWidth);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(opts.innerHeight);
}

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

  it("shows an optional hint when there is no validation error", () => {
    render(
      <DatePicker
        value=""
        onChange={() => {}}
        label="Date"
        hint="Use the event's local date."
      />,
    );

    expect(screen.getByText("Use the event's local date.")).toBeTruthy();
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
    // Real focus transfer (not just a synthetic focusin dispatch) — this is what actually
    // lands `document.activeElement` on the next control, the way a real Tab keypress would.
    // act()-wrapped so the resulting setOpen(false) flushes before the assertions below.
    act(() => nextField.focus());

    expect(screen.queryByRole("dialog", { name: "Choose date" })).toBeNull();
    // Unlike Escape, a Tab-driven close must not pull focus back to the input — that would
    // trap keyboard navigation instead of letting it continue to the next field.
    await waitFor(() => {
      expect(document.activeElement).toBe(nextField);
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

  it("threads ariaLabel to both the input and the calendar toggle button when there's no visible label", () => {
    vi.spyOn(eventDates, "localeDateInputPattern").mockReturnValue("dd.mm.yyyy");
    render(<DatePicker value="" onChange={() => {}} ariaLabel="From" placeholder="From (dd/mm/yyyy)" />);

    expect(screen.getByLabelText("From")).toBeTruthy();
    expect(screen.getByRole("button", { name: "From: Open calendar" })).toBeTruthy();
  });

  it("right-aligns the calendar panel when the field sits close to the viewport's right edge", async () => {
    mockOpenCalendarBasics();
    mockPlacementLayout({
      rect: { top: 100, bottom: 140, left: 900 },
      panelHeight: 300,
      panelWidth: 296,
      innerWidth: 1024,
      innerHeight: 768,
    });

    render(<DatePicker value="" onChange={() => {}} label="Date" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));

    const dialog = await screen.findByRole("dialog", { name: "Choose date" });
    expect(dialog.className).toContain("date-picker__panel--right");
  });

  it("does not right-align when there's room to the field's right", async () => {
    mockOpenCalendarBasics();
    mockPlacementLayout({
      rect: { top: 100, bottom: 140, left: 50 },
      panelHeight: 300,
      panelWidth: 296,
      innerWidth: 1024,
      innerHeight: 768,
    });

    render(<DatePicker value="" onChange={() => {}} label="Date" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));

    const dialog = await screen.findByRole("dialog", { name: "Choose date" });
    expect(dialog.className).not.toContain("date-picker__panel--right");
  });

  it("clamps the calendar panel's height when neither above nor below has room for it", async () => {
    mockOpenCalendarBasics();
    mockPlacementLayout({
      rect: { top: 50, bottom: 90, left: 50 },
      panelHeight: 500,
      panelWidth: 296,
      innerWidth: 1024,
      innerHeight: 200,
    });

    render(<DatePicker value="" onChange={() => {}} label="Date" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));

    const dialog = await screen.findByRole("dialog", { name: "Choose date" });
    expect(dialog.style.maxHeight).toBe("160px");
    expect(dialog.style.overflowY).toBe("auto");
  });

  it("does not clamp the panel's height when it fits in the available space", async () => {
    mockOpenCalendarBasics();
    mockPlacementLayout({
      rect: { top: 100, bottom: 140, left: 50 },
      panelHeight: 300,
      panelWidth: 296,
      innerWidth: 1024,
      innerHeight: 768,
    });

    render(<DatePicker value="" onChange={() => {}} label="Date" />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));

    const dialog = await screen.findByRole("dialog", { name: "Choose date" });
    expect(dialog.style.maxHeight).toBe("");
  });
});
