// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimezoneSelect } from "../../src/components/TimezoneSelect.js";

afterEach(cleanup);

describe("TimezoneSelect", () => {
  it("renders with the selected value visible", () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    expect((screen.getByLabelText("Select timezone") as HTMLSelectElement).value).toBe("UTC");
    expect(screen.getByText(/Selected:/)).toBeTruthy();
    expect(screen.getByText("UTC", { selector: "strong" })).toBeTruthy();
  });

  it("filters options when searching by city", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "tokyo" },
    });
    await waitFor(() => {
      const select = screen.getByLabelText("Select timezone") as HTMLSelectElement;
      const labels = Array.from(select.options).map((o) => o.text);
      expect(labels.some((l) => l.toLowerCase().includes("tokyo"))).toBe(true);
      expect(labels.length).toBeLessThan(590);
    });
  });

  it("matches city names with spaces in the query", async () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "new york" },
    });
    await waitFor(() => {
      const select = screen.getByLabelText("Select timezone") as HTMLSelectElement;
      expect(Array.from(select.options).some((o) => o.value === "America/New_York")).toBe(true);
    });
  });

  it("calls onChange when a new timezone is selected", async () => {
    const onChange = vi.fn();
    render(<TimezoneSelect value="UTC" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "tokyo" },
    });
    await waitFor(() => {
      const select = screen.getByLabelText("Select timezone") as HTMLSelectElement;
      expect(Array.from(select.options).some((o) => o.value.includes("Tokyo"))).toBe(true);
    });
    const select = screen.getByLabelText("Select timezone");
    const tokyoOption = Array.from((select as HTMLSelectElement).options).find((o) =>
      o.value.includes("Tokyo"),
    );
    expect(tokyoOption).toBeDefined();
    fireEvent.change(select, { target: { value: tokyoOption!.value } });
    expect(onChange).toHaveBeenCalledWith(tokyoOption!.value);
  });

  it("keeps custom IANA value visible when not in filtered list", async () => {
    render(<TimezoneSelect value="Pacific/Kiritimati" onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search timezones"), {
      target: { value: "zzznomatch" },
    });
    await waitFor(() => {
      const select = screen.getByLabelText("Select timezone") as HTMLSelectElement;
      expect(Array.from(select.options).some((o) => o.value === "Pacific/Kiritimati")).toBe(true);
    });
  });
});
