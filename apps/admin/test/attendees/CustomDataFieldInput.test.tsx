// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomDataFieldInput } from "../../src/attendees/CustomDataFieldInput.js";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { setPreferredLocale, setPreferredTimeFormat } from "../../src/utils/locale-store.js";
import { bitwardenTreatsAsSearchField } from "../checkin/bitwardenSearchField.js";

const baseField = {
  id: "field-1",
  source_field: "diet",
  label: "Diet",
  required: false,
  options: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("CustomDataFieldInput", () => {
  afterEach(cleanup);

  it.each(["select", "boolean"] as const)("uses a plain dash for an optional %s field", (type) => {
    const onChange = vi.fn();
    render(
      <CustomDataFieldInput
        field={{ ...baseField, type, options: type === "select" ? ["Vegan"] : null }}
        value=""
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Diet,/ }));
    expect(screen.getByRole("button", { name: "-" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: type === "select" ? "Vegan" : "Yes" }));
    expect(onChange).toHaveBeenCalledWith(type === "select" ? "Vegan" : "true");
  });

  it("shows just the placeholder for a select field with no options catalog", () => {
    render(
      <CustomDataFieldInput
        field={{ ...baseField, type: "select", options: null }}
        value=""
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Diet,/ }));
    expect(screen.getByRole("button", { name: "-" })).toBeTruthy();
    expect(screen.getAllByRole("button").filter((b) => b.closest(".searchable-select__list"))).toHaveLength(1);
  });

  it.each(["select", "boolean"] as const)("prompts before selecting a required %s field", (type) => {
    render(
      <CustomDataFieldInput
        field={{ ...baseField, type, required: true, options: type === "select" ? ["Vegan"] : null }}
        value=""
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Diet \*,/ }));
    expect(screen.getByRole("button", { name: "Choose…" })).toBeTruthy();
  });
});

afterEach(cleanup);

/** The input as a form holds it: the value is state that the input changes, and `onChange` is spied on. */
function renderInput(field: Partial<EventCustomFieldDto>, initial = "", props: { disabled?: boolean; eventTimeZone?: string } = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <CustomDataFieldInput
        field={{ ...baseField, type: "text", ...field } as EventCustomFieldDto}
        value={value}
        disabled={props.disabled}
        eventTimeZone={props.eventTimeZone}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  return onChange;
}

const EMOJI = String.fromCodePoint(0x1f600);

describe("CustomDataFieldInput: long text", () => {
  const abstract = { type: "long_text" as const, label: "Abstract", source_field: "abstract" };
  const box = () => screen.getByLabelText("Abstract") as HTMLTextAreaElement;

  it("is a box of several lines, named by its label, with the count of characters against the limit under it", () => {
    renderInput(abstract);
    expect(box().tagName).toBe("TEXTAREA");
    expect(box().rows).toBe(4);
    expect(screen.getByText("0 / 1000")).toBeTruthy();
    expect(box().getAttribute("aria-invalid")).toBeNull();
  });

  it("passes what is typed on, line breaks included, and counts it", () => {
    const onChange = renderInput(abstract);
    fireEvent.change(box(), { target: { value: "one\ntwo" } });
    expect(onChange).toHaveBeenCalledWith("one\ntwo");
    expect(box().value).toBe("one\ntwo");
    expect(screen.getByText("7 / 1000")).toBeTruthy();
  });

  it("counts characters as a person does and as the server does: an emoji is one, and the ends are trimmed", () => {
    renderInput(abstract);
    fireEvent.change(box(), { target: { value: `  ${EMOJI.repeat(3)}  ` } });
    expect(screen.getByText("3 / 1000")).toBeTruthy();
    expect(EMOJI.repeat(3)).toHaveLength(6);
  });

  it("turns the count red, and says by how many characters it is over, when the text is too long to save", () => {
    renderInput(abstract);
    fireEvent.change(box(), { target: { value: "x".repeat(1000) } });
    expect(screen.getByText("1000 / 1000").className).not.toContain("at-hint--error");
    expect(box().getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(box(), { target: { value: "x".repeat(1003) } });
    const count = screen.getByText("1003 / 1000, 3 too many");
    expect(count.className).toContain("at-hint--error");
    expect(box().getAttribute("aria-invalid")).toBe("true");
    expect(box().className).toContain("at-textarea--invalid");
    expect(box().getAttribute("aria-describedby")).toContain(count.id);
  });

  it("does not treat a thousand emoji as too long, which .length (two each) would", () => {
    renderInput(abstract);
    fireEvent.change(box(), { target: { value: EMOJI.repeat(1000) } });
    expect(screen.getByText("1000 / 1000")).toBeTruthy();
    expect(box().getAttribute("aria-invalid")).toBeNull();
  });

  it("holds to the shorter maximum of its own rules, and says the rest of them in a hint", () => {
    renderInput({ ...abstract, rules: { min_length: 20, max_length: 40, example: "Three lessons from last year" } });
    expect(screen.getByText("0 / 40")).toBeTruthy();
    const hint = screen.getByText("At least 20 characters, for example Three lessons from last year.");
    expect(box().getAttribute("aria-describedby")).toContain(hint.id);
    fireEvent.change(box(), { target: { value: "x".repeat(41) } });
    expect(screen.getByText("41 / 40, 1 too many")).toBeTruthy();
  });

  it("marks a required field in its label, and takes no input when it is off", () => {
    renderInput({ ...abstract, required: true }, "", { disabled: true });
    const required = screen.getByLabelText("Abstract *") as HTMLTextAreaElement;
    expect(required.required).toBe(true);
    expect(required.disabled).toBe(true);
  });
});

describe("CustomDataFieldInput: date", () => {
  beforeEach(() => setPreferredLocale("en-GB"));
  afterEach(() => setPreferredLocale(null));
  const arrival = { type: "date" as const, label: "Arrival day", source_field: "arrival_day" };

  it("is the product's date picker, named by the label, with the date shown in the account's format", () => {
    renderInput(arrival, "2026-11-04");
    expect((screen.getByLabelText("Arrival day") as HTMLInputElement).value).toBe("04 Nov 2026");
    expect(screen.getByRole("button", { name: "Open calendar" })).toBeTruthy();
  });

  it("passes the day on as YYYY-MM-DD, however it was typed", () => {
    const onChange = renderInput(arrival);
    const input = screen.getByLabelText("Arrival day");
    fireEvent.change(input, { target: { value: "2026-11-04" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("2026-11-04");
  });

  it("clears the answer when what was typed is not a date, and says so beside the box", () => {
    const onChange = renderInput(arrival, "2026-11-04");
    const input = screen.getByLabelText("Arrival day");
    fireEvent.change(input, { target: { value: "not a date" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("alert").textContent).toMatch(/valid date/i);
  });

  it("marks a required field in its label and is off when the form is", () => {
    renderInput({ ...arrival, required: true }, "", { disabled: true });
    expect(screen.getByText("Arrival day").closest("label")!.textContent).toContain("*");
    expect((screen.getByLabelText(/Arrival day/) as HTMLInputElement).disabled).toBe(true);
  });
});

describe("CustomDataFieldInput: date and time", () => {
  beforeEach(() => {
    setPreferredLocale("en-GB");
    setPreferredTimeFormat("24h");
  });
  afterEach(() => {
    setPreferredLocale(null);
    setPreferredTimeFormat(undefined);
  });
  const arrival = { type: "datetime" as const, label: "Arrival", source_field: "arrival" };
  const dateBox = () => screen.getByLabelText("Arrival, date") as HTMLInputElement;
  const timeBox = () => screen.getByLabelText("Arrival, time") as HTMLInputElement;
  function typeInto(box: HTMLInputElement, text: string) {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.blur(box);
  }

  it("is a group named by the label, a date and a time side by side, with the event's zone said under them", () => {
    renderInput(arrival, "2026-11-04T10:30", { eventTimeZone: "Europe/Warsaw" });
    const group = screen.getByRole("group", { name: "Arrival" });
    expect(within(group).getByLabelText("Arrival, date")).toBe(dateBox());
    expect(within(group).getByLabelText("Arrival, time")).toBe(timeBox());
    expect(dateBox().value).toBe("04 Nov 2026");
    expect(timeBox().value).toBe("10:30");
    expect(within(group).getByText("Time at the event (Europe/Warsaw).")).toBeTruthy();
  });

  it("says that it is the time at the event when the zone is not known", () => {
    renderInput(arrival);
    expect(screen.getByText("Time at the event.")).toBeTruthy();
  });

  it("joins the two halves into one answer, YYYY-MM-DDTHH:mm, whichever is filled in first", () => {
    const onChange = renderInput(arrival);
    typeInto(dateBox(), "2026-11-04");
    expect(onChange).toHaveBeenLastCalledWith("2026-11-04T");
    typeInto(timeBox(), "10:30");
    expect(onChange).toHaveBeenLastCalledWith("2026-11-04T10:30");
  });

  it("holds the time alone as T and the time, which the form refuses to send, until the date is filled in", () => {
    const onChange = renderInput(arrival);
    typeInto(timeBox(), "10:30");
    expect(onChange).toHaveBeenLastCalledWith("T10:30");
    typeInto(dateBox(), "2026-11-04");
    expect(onChange).toHaveBeenLastCalledWith("2026-11-04T10:30");
  });

  it("empties the answer when both halves are cleared, and keeps the other half when one is", () => {
    const onChange = renderInput(arrival, "2026-11-04T10:30");
    typeInto(timeBox(), "");
    expect(onChange).toHaveBeenLastCalledWith("2026-11-04T");
    typeInto(dateBox(), "");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("counts a time that was typed and cannot be read as no time, so the one before it is not kept by mistake", () => {
    const onChange = renderInput(arrival, "2026-11-04T10:30");
    fireEvent.change(timeBox(), { target: { value: "99:99" } });
    fireEvent.blur(timeBox());
    expect(onChange).toHaveBeenLastCalledWith("2026-11-04T");
  });

  it("marks a required field in its label, and is off when the form is", () => {
    renderInput({ ...arrival, required: true }, "", { disabled: true });
    expect(screen.getByText("Arrival *")).toBeTruthy();
    expect(dateBox().disabled).toBe(true);
    expect(timeBox().disabled).toBe(true);
  });
});

describe("CustomDataFieldInput: phone", () => {
  const mobile = { type: "phone" as const, label: "Mobile", source_field: "mobile" };
  const box = () => screen.getByLabelText("Mobile") as HTMLInputElement;
  const picker = () => screen.getByRole("button", { name: /^Mobile country code/ }) as HTMLButtonElement;
  const pick = (country: string) => {
    fireEvent.click(picker());
    fireEvent.click(screen.getByRole("button", { name: country }));
  };

  it("is the picker of the staff phone fields and a telephone box beside it, with what a number is under it", () => {
    renderInput(mobile);
    expect(picker().getAttribute("aria-label")).toBe("Mobile country code, no code selected");
    expect(box().type).toBe("tel");
    expect(box().inputMode).toBe("tel");
    expect(box().autocomplete).toBe("off");
    expect(box().maxLength).toBe(40);
    expect(screen.getByText("A phone number with 3 to 15 digits.")).toBeTruthy();
    // The number of a person reads as a search box to Bitwarden, which would offer the staff member's own phone otherwise.
    expect(bitwardenTreatsAsSearchField(box())).toBe(true);
  });

  it("answers with the code and the digits of the number once a country is picked, and shows the number as it was typed", () => {
    const onChange = renderInput(mobile);
    pick("Poland +48");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(picker().getAttribute("aria-label")).toBe("Mobile country code, Poland +48");
    fireEvent.change(box(), { target: { value: "600 100-200" } });
    expect(onChange).toHaveBeenLastCalledWith("+48600100200");
    expect(box().value).toBe("600 100-200");
  });

  it("opens on a saved number split into its code and the rest", () => {
    renderInput(mobile, "+48600100200");
    expect(picker().getAttribute("aria-label")).toBe("Mobile country code, Poland +48");
    expect(box().value).toBe("600100200");
  });

  it("keeps a saved number that has no code whole in the number box", () => {
    renderInput(mobile, "600100200");
    expect(picker().getAttribute("aria-label")).toBe("Mobile country code, no code selected");
    expect(box().value).toBe("600100200");
  });

  it("takes only what a number is written with: letters are dropped, and a + only at the start", () => {
    const onChange = renderInput(mobile);
    fireEvent.change(box(), { target: { value: "ab12" } });
    expect(onChange).toHaveBeenLastCalledWith("12");
    fireEvent.change(box(), { target: { value: "48+600" } });
    expect(onChange).toHaveBeenLastCalledWith("48600");
    fireEvent.change(box(), { target: { value: "+48 (600) 100-200 ext" } });
    expect(onChange).toHaveBeenLastCalledWith("+48600100200");
    expect(box().value).toBe("(600) 100-200");
  });

  it("reads a number typed or pasted with its country code as the code and the number, not as a second code after the one picked", () => {
    const onChange = renderInput(mobile);
    pick("Germany +49");
    fireEvent.change(box(), { target: { value: "+48 601 200 300" } });
    expect(onChange).toHaveBeenLastCalledWith("+48601200300");
    expect(picker().getAttribute("aria-label")).toBe("Mobile country code, Poland +48");
    expect(box().value).toBe("601 200 300");
  });

  it("keeps a + that no country code follows in the number, with no code picked", () => {
    const onChange = renderInput(mobile);
    pick("Germany +49");
    fireEvent.change(box(), { target: { value: "+" } });
    expect(onChange).toHaveBeenLastCalledWith("+");
    expect(picker().getAttribute("aria-label")).toBe("Mobile country code, no code selected");
    expect(box().value).toBe("+");
  });

  it("takes an answer the form changed: a cleared form clears the picker too", () => {
    const field = { ...baseField, ...mobile } as EventCustomFieldDto;
    const { rerender } = render(<CustomDataFieldInput field={field} value="+48600100200" onChange={vi.fn()} />);
    expect(picker().getAttribute("aria-label")).toBe("Mobile country code, Poland +48");
    rerender(<CustomDataFieldInput field={field} value="" onChange={vi.fn()} />);
    expect(picker().getAttribute("aria-label")).toBe("Mobile country code, no code selected");
    expect(box().value).toBe("");
  });

  it("says the rules and the example of the field", () => {
    renderInput({ ...mobile, rules: { max_length: 12, example: "+48600100200" } });
    expect(screen.getByText("A phone number with 3 to 15 digits, at most 12 characters, for example +48600100200.")).toBeTruthy();
  });

  it("marks a required field in its label, and is off when the form is", () => {
    renderInput({ ...mobile, required: true }, "", { disabled: true });
    expect((screen.getByLabelText("Mobile *") as HTMLInputElement).disabled).toBe(true);
    expect(picker().disabled).toBe(true);
  });

  it("is a plain telephone line, with no picker, for a field that asks for digits only: its answer has no + for a code", () => {
    const onChange = renderInput({ ...mobile, rules: { digits_only: true, max_length: 9, example: "600100200" } });
    expect(screen.queryByRole("button", { name: /country code/ })).toBeNull();
    expect(box().type).toBe("tel");
    expect(bitwardenTreatsAsSearchField(box())).toBe(true);
    expect(screen.getByText("A phone number with 3 to 15 digits, digits only, at most 9 characters, for example 600100200.")).toBeTruthy();
    fireEvent.change(box(), { target: { value: "+48 600 100" } });
    expect(onChange).toHaveBeenLastCalledWith("+48 600 100");
  });
});

describe("CustomDataFieldInput: text with rules", () => {
  const postcode = { type: "text" as const, label: "Postcode", source_field: "postcode" };

  it("says what the rules ask for, and shows the keyboard of digits when only digits are allowed", () => {
    renderInput({ ...postcode, rules: { digits_only: true, min_length: 5, max_length: 5, example: "01234" } });
    const box = screen.getByLabelText("Postcode") as HTMLInputElement;
    expect(box.inputMode).toBe("numeric");
    expect(box.type).toBe("text");
    expect(box.maxLength).toBe(-1);
    expect(screen.getByText("Digits only, exactly 5 characters, for example 01234.")).toBeTruthy();
  });

  it("is a plain line, with no hint and no special keyboard, when the field has no rules", () => {
    renderInput(postcode);
    const box = screen.getByLabelText("Postcode") as HTMLInputElement;
    expect(box.inputMode).toBe("");
    expect(document.querySelector(".at-hint")).toBeNull();
  });

  it("takes whatever is typed in, since the form checks it when it is sent", () => {
    const onChange = renderInput({ ...postcode, rules: { digits_only: true } });
    fireEvent.change(screen.getByLabelText("Postcode"), { target: { value: "12ab" } });
    expect(onChange).toHaveBeenLastCalledWith("12ab");
  });

  it("treats a type this version does not know as a plain text line", () => {
    renderInput({ ...postcode, type: "mystery" as never });
    expect((screen.getByLabelText("Postcode") as HTMLInputElement).type).toBe("text");
  });
});
