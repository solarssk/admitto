// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconPicker, ITEM_ICONS } from "../../src/requirements/IconPicker.js";
import { GUEST_FORM_ICON_OPTIONS } from "../../src/requirements/guestFormIcons.js";

afterEach(cleanup);

describe("IconPicker", () => {
  it("is a group of buttons, named 'Choose icon' unless a label names it, with the default icon first and pressed when there is no value", () => {
    render(<IconPicker value={null} onChange={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Choose icon" });
    expect(group.tagName).toBe("FIELDSET");
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(ITEM_ICONS.length + 1);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Default icon (package)");
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(buttons.slice(1).every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("is named by the label whose id it is given, instead of the default name", () => {
    render(
      <>
        <span id="icon-label">Icon</span>
        <IconPicker value={null} onChange={vi.fn()} labelledBy="icon-label" />
      </>,
    );
    expect(screen.getByRole("group", { name: "Icon" }).tagName).toBe("FIELDSET");
    expect(screen.queryByRole("group", { name: "Choose icon" })).toBeNull();
  });

  it("presses the button of the value, and hands the name back when a button is clicked, or null for the first", () => {
    const onChange = vi.fn();
    render(<IconPicker value="crown" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Crown (VIP)" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Default icon (package)" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(onChange).toHaveBeenLastCalledWith("star");
    fireEvent.click(screen.getByRole("button", { name: "Default icon (package)" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("draws the glyph of an item that is named differently in the webfont, and the stored name when it is the same", () => {
    render(<IconPicker value={null} onChange={vi.fn()} icons={GUEST_FORM_ICON_OPTIONS} defaultIcon="ban" noneLabel="No icon" />);
    const glyph = (name: string) => screen.getByRole("button", { name }).querySelector("i")?.className;
    expect(glyph("Food")).toBe("ti ti-tools-kitchen-2");
    expect(glyph("Location")).toBe("ti ti-map-pin");
    expect(glyph("Car")).toBe("ti ti-car");
    expect(glyph("No icon")).toBe("ti ti-ban");
  });

  it("names the empty choice as the caller says, and keeps the default name otherwise", () => {
    render(<IconPicker value={null} onChange={vi.fn()} icons={GUEST_FORM_ICON_OPTIONS} defaultIcon="ban" noneLabel="No icon" />);
    const none = screen.getByRole("button", { name: "No icon" });
    expect(none.getAttribute("title")).toBe("No icon");
    expect(none.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /Default icon/ })).toBeNull();
  });

  it("offers the 16 icons of the registration form and the empty choice, and presses the one that is the value", () => {
    render(<IconPicker value="parking" onChange={vi.fn()} icons={GUEST_FORM_ICON_OPTIONS} defaultIcon="ban" noneLabel="No icon" />);
    expect(screen.getAllByRole("button")).toHaveLength(17);
    expect(screen.getByRole("button", { name: "Parking" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "No icon" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("takes no click while it is disabled, and every button is off, so a save under way is not changed", () => {
    const onChange = vi.fn();
    render(<IconPicker value={null} onChange={onChange} disabled />);
    for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("never submits a form it is in: its buttons are plain buttons", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <IconPicker value={null} onChange={vi.fn()} />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Star" }).getAttribute("type")).toBe("button");
  });
});
