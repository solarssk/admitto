// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimezoneSelect } from "../../src/components/TimezoneSelect.js";

afterEach(cleanup);

function openPicker() {
  fireEvent.click(screen.getByRole("button"));
}

describe("TimezoneSelect", () => {
  it("renders with the selected value visible on the trigger", () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    expect(screen.getByRole("button").textContent).toContain("UTC");
  });

  it("shows city, IANA, and UTC offset on one trigger line", () => {
    render(<TimezoneSelect value="Europe/Warsaw" onChange={() => {}} />);
    const text = screen.getByRole("button").textContent ?? "";
    expect(text).toContain("Warsaw");
    expect(text).toContain("Europe/Warsaw");
    expect(text).toMatch(/UTC[+-]\d/);
    expect(text).not.toMatch(/GMT[+-]/);
  });

  it("renders an optional hint describing timezone IDs", () => {
    render(
      <TimezoneSelect
        value="Europe/Warsaw"
        onChange={() => {}}
        hint="Search by city. The saved value is a standard timezone ID."
      />,
    );
    expect(screen.getByText(/standard timezone ID/)).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("aria-describedby")).toBeTruthy();
  });

  it("renders the placeholder when no timezone is selected", () => {
    render(<TimezoneSelect value="" onChange={() => {}} />);
    expect(screen.getByText("Select timezone…")).toBeTruthy();
  });

  it("opens a searchable listbox", () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    expect(screen.getByRole("listbox", { name: "Select timezone" })).toBeTruthy();
    expect(screen.getByLabelText("Search timezones")).toBeTruthy();
  });

  it("filters options when searching by city", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "tokyo" },
    });
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options.some((o) => o.textContent?.toLowerCase().includes("tokyo"))).toBe(true);
      expect(options.length).toBeLessThan(80);
    });
  });

  it("matches city names with spaces in the query", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "new york" },
    });
    await waitFor(() => {
      expect(
        screen.getAllByRole("option").some((o) => o.textContent?.includes("America/New_York")),
      ).toBe(true);
    });
  });

  it("matches a GMT-offset query like '+9'", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "+9" },
    });
    await waitFor(() => {
      expect(
        screen.getAllByRole("option").some((o) => o.textContent?.includes("Tokyo")),
      ).toBe(true);
    });
  });

  it("calls onChange when a new timezone is selected", async () => {
    const onChange = vi.fn();
    render(<TimezoneSelect value="UTC" onChange={onChange} />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "tokyo" },
    });
    await waitFor(() => {
      expect(screen.getAllByRole("option").some((o) => o.textContent?.includes("Tokyo"))).toBe(
        true,
      );
    });
    const tokyoOption = screen
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("Asia/Tokyo"));
    expect(tokyoOption).toBeDefined();
    fireEvent.click(tokyoOption!);
    expect(onChange).toHaveBeenCalledWith("Asia/Tokyo");
  });

  it("keeps the panel open while the pointer moves into its fixed results layer", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    const option = (await screen.findAllByRole("option"))[0]!;
    fireEvent.pointerDown(option);
    fireEvent.mouseEnter(option);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("highlights the option currently under the pointer", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    const option = (await screen.findAllByRole("option")).find((entry) =>
      entry.textContent?.includes("Anchorage"),
    )!;
    fireEvent.pointerMove(option);
    expect(option.classList.contains("timezone-select__option--highlighted")).toBe(true);
  });

  it("keeps an unrecognized stored value visible when not in the catalogue", async () => {
    render(<TimezoneSelect value="Legacy/Removed" onChange={() => {}} />);
    openPicker();
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Legacy\/Removed/ })).toBeTruthy();
    });
  });

  it("finds India when searching india and does not pin unrelated selection", async () => {
    render(<TimezoneSelect value="Europe/Warsaw" onChange={() => {}} />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "india" },
    });
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(
        options.some(
          (o) =>
            o.textContent?.includes("Asia/Kolkata") || o.textContent?.includes("Asia/Calcutta"),
        ),
      ).toBe(true);
      expect(options.some((o) => o.textContent?.includes("Europe/Warsaw"))).toBe(false);
      expect(options[0]?.textContent).toMatch(/Kolkata|Calcutta/);
    });
  });

  it("shows one Kolkata option for the current and legacy IANA identifiers", async () => {
    render(<TimezoneSelect value="Asia/Calcutta" onChange={() => {}} />);
    expect(screen.getByRole("button").textContent).toContain("Asia/Kolkata");

    openPicker();
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "calcutta" },
    });

    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(1);
      expect(options[0]?.textContent).toContain("Kolkata");
      expect(options[0]?.textContent).toContain("Asia/Kolkata");
      expect(options[0]?.textContent).toContain("UTC+");
    });
  });

  it("shows the full IANA list sorted by offset when browsing", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options.length).toBeGreaterThan(200);
      expect(document.querySelector(".timezone-select__group")).toBeTruthy();
    });
  });

  it("returns Russian zones when searching russia", async () => {
    render(<TimezoneSelect value="Europe/Warsaw" onChange={() => {}} />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "russia" },
    });
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options.some((o) => o.textContent?.includes("Europe/Moscow"))).toBe(true);
      expect(options.some((o) => o.textContent?.includes("Asia/Vladivostok"))).toBe(true);
      expect(options.some((o) => o.textContent?.includes("Europe/Warsaw"))).toBe(false);
    });
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    const trigger = screen.getByRole("button");
    openPicker();
    fireEvent.keyDown(screen.getByLabelText("Search timezones"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("closes without stealing focus back when the user tabs to a control outside the panel", async () => {
    render(
      <div>
        <TimezoneSelect value="UTC" onChange={() => {}} />
        <button type="button">Next field</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: /UTC/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();

    const nextField = screen.getByRole("button", { name: "Next field" });
    // Real focus transfer (not just a synthetic focusin dispatch) — this is what actually
    // lands `document.activeElement` on the next control, the way a real Tab keypress would.
    // act()-wrapped so the resulting setOpen(false) flushes before the assertions below.
    act(() => nextField.focus());

    expect(screen.queryByRole("listbox")).toBeNull();
    // Unlike Escape, a Tab-driven close must not pull focus back to the trigger — that
    // would trap keyboard navigation instead of letting it continue to the next field.
    await waitFor(() => {
      expect(document.activeElement).toBe(nextField);
    });
  });

  it("wires aria-activedescendant to the highlighted option for screen readers", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    const search = screen.getByLabelText("Search timezones");

    await waitFor(() => {
      expect(search.getAttribute("aria-activedescendant")).toBeTruthy();
    });

    const initialId = search.getAttribute("aria-activedescendant");
    const initialOption = document.getElementById(initialId!);
    expect(initialOption).not.toBeNull();
    expect(initialOption?.getAttribute("role")).toBe("option");
    expect(initialOption?.className).toContain("timezone-select__option--highlighted");

    fireEvent.keyDown(search, { key: "ArrowDown" });

    await waitFor(() => {
      const nextId = search.getAttribute("aria-activedescendant");
      expect(nextId).not.toBe(initialId);
      const nextOption = document.getElementById(nextId!);
      expect(nextOption).not.toBeNull();
      expect(nextOption?.className).toContain("timezone-select__option--highlighted");
    });
  });

  it("omits aria-activedescendant when there are no matching options", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "zzznomatch" },
    });
    await waitFor(() => {
      expect(screen.getByText("No matching timezones")).toBeTruthy();
      expect(
        screen.getByLabelText("Search timezones").hasAttribute("aria-activedescendant"),
      ).toBe(false);
    });
  });

  it("closes when the trigger is clicked while open", () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /UTC/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("highlights an option on mouse enter", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    fireEvent.mouseEnter(options[1]!);
    expect(options[1]!.className).toContain("timezone-select__option--highlighted");
  });

  it("clamps panel height using scrollHeight when the viewport is short", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 40,
      bottom: 80,
      left: 20,
      right: 300,
      width: 280,
      height: 40,
      x: 20,
      y: 40,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(200);

    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    const panel = await screen.findByRole("listbox");
    const shell = panel.closest(".timezone-select__panel") as HTMLElement | null;
    expect(shell?.style.maxHeight).toBeTruthy();
    expect(Number.parseFloat(shell!.style.maxHeight)).toBeGreaterThanOrEqual(200);
  });

  it("closes on ancestor scroll without refocusing the trigger", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: /UTC/ }) as HTMLButtonElement;
    openPicker();
    expect(screen.getByRole("listbox")).toBeTruthy();

    const focusSpy = vi.spyOn(trigger, "focus");
    const scrollEvent = new Event("scroll", { bubbles: true });
    Object.defineProperty(scrollEvent, "target", { value: document.body });
    act(() => {
      window.dispatchEvent(scrollEvent);
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("ignores trigger clicks while disabled", () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} disabled />);
    fireEvent.click(screen.getByRole("button", { name: /UTC/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves highlight with ArrowUp/ArrowDown and selects with Enter", async () => {
    const onChange = vi.fn();
    render(<TimezoneSelect value="UTC" onChange={onChange} />);
    openPicker();
    const search = screen.getByLabelText("Search timezones");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("estimates panel-above placement before open when space below is tight", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 500,
      bottom: 540,
      left: 20,
      right: 300,
      width: 280,
      height: 40,
      x: 20,
      y: 500,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(580);
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    const panel = screen.getByRole("listbox").closest(".timezone-select__panel");
    expect(panel?.className).toContain("timezone-select__panel--above");
  });

  it("defaults panel-above to false when getBoundingClientRect is unavailable at open", () => {
    let calls = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => {
      calls += 1;
      // First call is openPanel's estimate; later calls are the layout effect.
      if (calls === 1) return undefined as unknown as DOMRect;
      return {
        top: 100,
        bottom: 140,
        left: 20,
        right: 300,
        width: 280,
        height: 40,
        x: 20,
        y: 100,
        toJSON: () => ({}),
      } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(300);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024);
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    openPicker();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("shows a fallback UTC+0 group label for unknown IANA values", async () => {
    render(<TimezoneSelect value="Etc/Unknown_Zone" onChange={() => {}} />);
    openPicker();
    await waitFor(() => {
      expect(screen.getByText("UTC+0")).toBeTruthy();
      expect(
        screen.getAllByRole("option").some((o) => o.textContent?.includes("Etc/Unknown_Zone")),
      ).toBe(true);
    });
  });

  it("closes and stays closed when clicking an external <label for> while open", () => {
    render(
      <div>
        <label htmlFor="event-tz">Event timezone</label>
        <TimezoneSelect id="event-tz" value="UTC" onChange={() => {}} />
      </div>,
    );
    fireEvent.click(document.getElementById("event-tz")!);
    expect(screen.getByRole("listbox")).toBeTruthy();

    const externalLabel = screen.getByText("Event timezone");
    fireEvent.pointerDown(externalLabel);
    fireEvent.click(externalLabel);

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("stays closed after an outside pointerdown that would otherwise reopen via the trigger click", () => {
    vi.useFakeTimers();
    try {
      render(
        <div>
          <button type="button">Outside</button>
          <TimezoneSelect id="tz-suppress" value="UTC" onChange={() => {}} />
        </div>,
      );
      fireEvent.click(document.getElementById("tz-suppress")!);
      expect(screen.getByRole("listbox")).toBeTruthy();

      fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
      expect(screen.queryByRole("listbox")).toBeNull();

      // Same gesture's click can land on the re-focused trigger; suppress that reopen.
      fireEvent.click(document.getElementById("tz-suppress")!);
      expect(screen.queryByRole("listbox")).toBeNull();
      act(() => {
        vi.runAllTimers();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows reopening after an ordinary outside close once the closing gesture finishes", () => {
    vi.useFakeTimers();
    try {
      render(
        <div>
          <button type="button">Outside</button>
          <TimezoneSelect id="tz-reopen" value="UTC" onChange={() => {}} />
        </div>,
      );
      fireEvent.click(document.getElementById("tz-reopen")!);
      expect(screen.getByRole("listbox")).toBeTruthy();

      fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
      expect(screen.queryByRole("listbox")).toBeNull();
      // Click landed on Outside, not the trigger - flush the gesture so suppression clears.
      fireEvent.click(screen.getByRole("button", { name: "Outside" }));
      act(() => {
        vi.runAllTimers();
      });

      fireEvent.click(document.getElementById("tz-reopen")!);
      expect(screen.getByRole("listbox")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
