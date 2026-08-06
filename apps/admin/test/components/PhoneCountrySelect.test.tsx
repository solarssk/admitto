// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneCountrySelect } from "../../src/components/PhoneCountrySelect.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PhoneCountrySelect", () => {
  it("shows a placeholder when no code is selected", () => {
    render(<PhoneCountrySelect id="test-code" label="Phone country code" value="" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Phone country code, no code selected" })).toBeTruthy();
    expect(screen.getByText("No code")).toBeTruthy();
  });

  it("shows the flag and dial code for an already-selected country", () => {
    render(<PhoneCountrySelect id="test-code" label="Phone country code" value="+48" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Phone country code, Poland +48" })).toBeTruthy();
  });

  it("opens a search panel listing countries, filters as you type, and reports the pick", () => {
    const onChange = vi.fn();
    render(<PhoneCountrySelect id="test-code" label="Phone country code" value="" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Phone country code/ }));
    const search = screen.getByLabelText("Search country or dial code");
    expect(search).toBeTruthy();
    // Unfiltered panel lists the full set, not a hand-picked handful.
    expect(screen.getAllByRole("button", { name: /Poland \+48/ }).length).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: "Poland" } });
    expect(screen.queryByRole("button", { name: /Germany/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Poland \+48/ }));
    expect(onChange).toHaveBeenCalledWith("+48");
    // Selecting closes the panel.
    expect(screen.queryByLabelText("Search country or dial code")).toBeNull();
  });

  it("filters by dial code digits too", () => {
    render(<PhoneCountrySelect id="test-code" label="Phone country code" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Phone country code/ }));
    fireEvent.change(screen.getByLabelText("Search country or dial code"), { target: { value: "+48" } });
    expect(screen.getByRole("button", { name: /Poland \+48/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /United States/ })).toBeNull();
  });

  it("shows an empty state for a query matching nobody", () => {
    render(<PhoneCountrySelect id="test-code" label="Phone country code" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Phone country code/ }));
    fireEvent.change(screen.getByLabelText("Search country or dial code"), {
      target: { value: "nowhere-matches-this" },
    });
    expect(screen.getByText("No countries match.")).toBeTruthy();
  });

  it("selects the first filtered country on Enter", () => {
    const onChange = vi.fn();
    render(<PhoneCountrySelect id="test-code" label="Phone country code" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Phone country code/ }));
    const search = screen.getByLabelText("Search country or dial code");
    fireEvent.change(search, { target: { value: "Poland" } });

    fireEvent.keyDown(search, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("+48");
    expect(screen.queryByLabelText("Search country or dial code")).toBeNull();
  });

  it("does nothing on Enter when the search matches no country", () => {
    const onChange = vi.fn();
    render(<PhoneCountrySelect id="test-code" label="Phone country code" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Phone country code/ }));
    const search = screen.getByLabelText("Search country or dial code");
    fireEvent.change(search, { target: { value: "nowhere-matches-this" } });

    fireEvent.keyDown(search, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables the trigger when disabled", () => {
    render(
      <PhoneCountrySelect id="test-code" label="Phone country code" value="" disabled onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Phone country code/ })).toHaveProperty("disabled", true);
  });
});
