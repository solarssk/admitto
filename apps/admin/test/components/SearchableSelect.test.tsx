// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect, type SearchableSelectOption } from "../../src/components/SearchableSelect.js";

afterEach(cleanup);

const OPTIONS: SearchableSelectOption[] = [
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
});
