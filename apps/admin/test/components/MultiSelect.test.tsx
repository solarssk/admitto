// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiSelect } from "../../src/components/MultiSelect.js";
import type { SearchableSelectOption } from "../../src/components/SearchableSelect.js";

afterEach(cleanup);

// Above the component's own search-visibility threshold (6), same convention as
// SearchableSelect.test.tsx - ShortOptions below covers the below-threshold, no-search-box,
// no-select-all-footer (single option) cases instead.
const OPTIONS: SearchableSelectOption[] = [
  { id: "apple", label: "Apple" },
  { id: "banana", label: "Banana" },
  { id: "cherry", label: "Cherry" },
  { id: "date", label: "Date" },
  { id: "elderberry", label: "Elderberry" },
  { id: "fig", label: "Fig" },
  { id: "grape", label: "Grape" },
];

const SHORT_OPTIONS: SearchableSelectOption[] = [
  { id: "apple", label: "Apple" },
  { id: "banana", label: "Banana" },
  { id: "cherry", label: "Cherry" },
];

function ControlledMultiSelect({
  onChange,
  initial = [],
  options = OPTIONS,
}: Readonly<{ onChange: (ids: string[]) => void; initial?: string[]; options?: SearchableSelectOption[] }>) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <MultiSelect
      id="fruit"
      label="Fruit"
      placeholder="Any fruit"
      searchPlaceholder="Search fruit…"
      emptyLabel="No fruit found"
      value={value}
      options={options}
      onChange={(ids) => {
        setValue(ids);
        onChange(ids);
      }}
    />
  );
}

describe("MultiSelect", () => {
  it("summarizes the closed trigger as placeholder / one label / \"N selected\"", () => {
    render(<ControlledMultiSelect onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Fruit, none selected" })).toBeTruthy();
    cleanup();

    render(<ControlledMultiSelect onChange={vi.fn()} initial={["apple"]} />);
    expect(screen.getByRole("button", { name: "Fruit, Apple" })).toBeTruthy();
    cleanup();

    render(<ControlledMultiSelect onChange={vi.fn()} initial={["apple", "banana"]} />);
    expect(screen.getByRole("button", { name: "Fruit, 2 selected" })).toBeTruthy();
  });

  it("toggling a checkbox keeps the panel open and reports the new selection", () => {
    const onChange = vi.fn();
    render(<ControlledMultiSelect onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Apple" }));
    expect(onChange).toHaveBeenCalledWith(["apple"]);
    // Still open (and re-rendered with the new value) - a real close-on-click would make this
    // query fail since the panel would have unmounted.
    expect(screen.getByRole("checkbox", { name: "Banana" })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Banana" }));
    expect(onChange).toHaveBeenCalledWith(["apple", "banana"]);
  });

  it("unchecking a selected option removes just that id", () => {
    const onChange = vi.fn();
    render(<ControlledMultiSelect onChange={onChange} initial={["apple", "banana"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, 2 selected" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Apple" }));
    expect(onChange).toHaveBeenCalledWith(["banana"]);
  });

  it("Select all checks every option, Clear empties the selection", () => {
    const onChange = vi.fn();
    render(<ControlledMultiSelect onChange={onChange} initial={["apple"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, Apple" }));

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onChange).toHaveBeenCalledWith(OPTIONS.map((o) => o.id));

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("hides the Select all / Clear footer for a single-option list", () => {
    render(<ControlledMultiSelect onChange={vi.fn()} options={[{ id: "apple", label: "Apple" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Apple" })).toBeTruthy();
  });

  it("skips the search box below the threshold, and filters the option list above it", () => {
    render(<ControlledMultiSelect onChange={vi.fn()} options={SHORT_OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));
    expect(screen.queryByLabelText("Search fruit…")).toBeNull();

    cleanup();
    render(<ControlledMultiSelect onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));
    fireEvent.change(screen.getByLabelText("Search fruit…"), { target: { value: "an" } });

    expect(screen.getByRole("checkbox", { name: "Banana" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Apple" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Cherry" })).toBeNull();
  });

  it("shows the empty label when nothing matches the search", () => {
    render(<ControlledMultiSelect onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));
    fireEvent.change(screen.getByLabelText("Search fruit…"), { target: { value: "zzz" } });

    expect(screen.getByText("No fruit found")).toBeTruthy();
  });

  it("toggles the first filtered result on Enter, without closing the panel", () => {
    const onChange = vi.fn();
    render(<ControlledMultiSelect onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    const search = screen.getByLabelText("Search fruit…");
    fireEvent.change(search, { target: { value: "che" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["cherry"]);
  });

  it("does nothing on a non-Enter keystroke in the search box", () => {
    const onChange = vi.fn();
    render(<ControlledMultiSelect onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    fireEvent.keyDown(screen.getByLabelText("Search fruit…"), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to the placeholder text when the sole selected id is no longer in the option list", () => {
    // e.g. a filter still referencing a ticket type that was since deleted from the catalog.
    render(<ControlledMultiSelect onChange={vi.fn()} initial={["kumquat"]} />);
    expect(screen.getByRole("button", { name: "Fruit, Any fruit" })).toBeTruthy();
  });

  it("does nothing on Enter when the search matches no option", () => {
    const onChange = vi.fn();
    render(<ControlledMultiSelect onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Fruit, none selected" }));

    const search = screen.getByLabelText("Search fruit…");
    fireEvent.change(search, { target: { value: "zzz" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a visible caption above the trigger, omitting it when showLabel=false", () => {
    const { rerender } = render(<ControlledMultiSelect onChange={vi.fn()} />);
    expect(document.querySelector('label[for="fruit"]')?.textContent).toBe("Fruit");

    rerender(
      <MultiSelect
        id="fruit"
        label="Fruit"
        showLabel={false}
        placeholder="Any fruit"
        searchPlaceholder="Search fruit…"
        emptyLabel="No fruit found"
        value={[]}
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector('label[for="fruit"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Fruit, none selected" })).toBeTruthy();
  });

  it("shows a hint with the same .at-hint styling Input uses, wired via aria-describedby", () => {
    render(
      <MultiSelect
        id="fruit"
        label="Fruit"
        placeholder="Any fruit"
        searchPlaceholder="Search fruit…"
        emptyLabel="No fruit found"
        value={[]}
        options={OPTIONS}
        hint="Pick every fruit this order ships with."
        onChange={vi.fn()}
      />,
    );

    const hint = screen.getByText("Pick every fruit this order ships with.");
    expect(hint.className).toBe("at-hint");
    expect(screen.getByRole("button", { name: "Fruit, none selected" }).getAttribute("aria-describedby")).toBe(
      hint.id,
    );
  });

  it("marks the trigger invalid and disabled when asked", () => {
    render(
      <MultiSelect
        id="fruit"
        label="Fruit"
        placeholder="Any fruit"
        searchPlaceholder="Search fruit…"
        emptyLabel="No fruit found"
        value={[]}
        options={OPTIONS}
        invalid
        disabled
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Fruit, none selected" }) as HTMLButtonElement;
    expect(trigger.className).toContain("searchable-select__trigger--invalid");
    expect(trigger.disabled).toBe(true);
  });
});
