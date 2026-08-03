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

  it("keeps custom IANA value visible when not in filtered list", async () => {
    render(<TimezoneSelect value="Pacific/Kiritimati" onChange={() => {}} />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "zzznomatch" },
    });
    await waitFor(() => {
      expect(screen.queryAllByRole("option")).toHaveLength(0);
      expect(screen.getByText("No matching timezones")).toBeTruthy();
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
});
