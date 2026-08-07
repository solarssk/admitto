// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect, type SearchableSelectOption } from "../../src/components/SearchableSelect.js";

afterEach(cleanup);

// Above the component's own search-visibility threshold (6) so the search-behavior tests below
// exercise a real search box - ControlledSelectShort (fewer options) covers the below-threshold,
// no-search-box case instead.
const OPTIONS: SearchableSelectOption[] = [
  { id: "apple", label: "Apple", icon: "circle" },
  { id: "banana", label: "Banana", icon: "circle" },
  { id: "cherry", label: "Cherry", icon: "circle" },
  { id: "date", label: "Date", icon: "circle" },
  { id: "elderberry", label: "Elderberry", icon: "circle" },
  { id: "fig", label: "Fig", icon: "circle" },
  { id: "grape", label: "Grape", icon: "circle" },
];

const SHORT_OPTIONS: SearchableSelectOption[] = [
  { id: "apple", label: "Apple", icon: "circle" },
  { id: "banana", label: "Banana", icon: "circle" },
  { id: "cherry", label: "Cherry", icon: "circle" },
];

function ControlledSelect({ onChange }: Readonly<{ onChange: (id: string) => void }>) {
  const [value, setValue] = useState("");
  return (
    <SearchableSelect
      id="fruit"
      label="Fruit"
      placeholder="Pick a fruit…"
      searchPlaceholder="Search fruit…"
      emptyLabel="No fruit found"
      value={value}
      options={OPTIONS}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}

function ControlledSelectShort({ onChange }: Readonly<{ onChange: (id: string) => void }>) {
  const [value, setValue] = useState("");
  return (
    <SearchableSelect
      id="fruit"
      label="Fruit"
      placeholder="Pick a fruit…"
      searchPlaceholder="Search fruit…"
      emptyLabel="No fruit found"
      value={value}
      options={SHORT_OPTIONS}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}

describe("SearchableSelect", () => {
  it("filters the option list as the search box is typed into", () => {
    render(<ControlledSelect onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    expect(screen.getByRole("button", { name: "Apple" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Banana" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cherry" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search fruit…"), { target: { value: "an" } });

    expect(screen.getByRole("button", { name: "Banana" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apple" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cherry" })).toBeNull();
  });

  it("shows the empty label when nothing matches the search", () => {
    render(<ControlledSelect onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    fireEvent.change(screen.getByLabelText("Search fruit…"), { target: { value: "zzz" } });

    expect(screen.getByText("No fruit found")).toBeTruthy();
  });

  it("selects the first filtered result on Enter, without submitting a form", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    const search = screen.getByLabelText("Search fruit…");
    fireEvent.change(search, { target: { value: "che" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("cherry");
    expect(screen.getByRole("button", { name: "Fruit, Cherry" })).toBeTruthy();
  });

  it("does nothing on Enter when the search matches no option", () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    const search = screen.getByLabelText("Search fruit…");
    fireEvent.change(search, { target: { value: "zzz" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a visible caption above the trigger, not just the trigger's own aria-label", () => {
    render(<ControlledSelect onChange={vi.fn()} />);
    const label = document.querySelector('label[for="fruit"]');
    expect(label?.textContent).toBe("Fruit");
  });

  it("skips the search box for a short option list, showing every option directly", () => {
    render(<ControlledSelectShort onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    expect(screen.queryByLabelText("Search fruit…")).toBeNull();
    expect(screen.getByRole("button", { name: "Apple" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Banana" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cherry" })).toBeTruthy();
  });

  it("omits its own caption when the caller already renders one (showLabel=false)", () => {
    render(
      <SearchableSelect
        id="fruit"
        label="Fruit"
        showLabel={false}
        placeholder="Pick a fruit…"
        searchPlaceholder="Search fruit…"
        emptyLabel="No fruit found"
        value=""
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );

    expect(document.querySelector('label[for="fruit"]')).toBeNull();
    // The button's own accessible name still carries the field's purpose either way.
    expect(screen.getByRole("button", { name: "Fruit, none selected" })).toBeTruthy();
  });
});
