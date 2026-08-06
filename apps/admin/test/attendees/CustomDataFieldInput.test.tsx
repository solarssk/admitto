// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomDataFieldInput } from "../../src/attendees/CustomDataFieldInput.js";

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
