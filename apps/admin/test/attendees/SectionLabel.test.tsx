// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionLabel } from "../../src/attendees/SectionLabel.js";

afterEach(cleanup);

describe("SectionLabel", () => {
  it("is a paragraph with the label in it, which takes the class of the place it is put in", () => {
    render(<SectionLabel className="grid-cell">Custom fields</SectionLabel>);
    const label = screen.getByText("Custom fields");
    expect(label.tagName).toBe("P");
    expect(label.className).toBe("attendees-section-label grid-cell");
  });

  it("has only its own class when it is put in no place", () => {
    render(<SectionLabel>Custom fields</SectionLabel>);
    expect(screen.getByText("Custom fields").className).toBe("attendees-section-label");
  });
});
