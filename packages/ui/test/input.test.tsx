import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "../src/components/Input.js";

describe("Input", () => {
  it("renders an optional hint and wires it to the input", () => {
    render(<Input label="Instance URL" hint="Use the public HTTPS URL." />);

    const input = screen.getByLabelText("Instance URL");
    const hint = screen.getByText("Use the public HTTPS URL.");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("shows an error instead of a hint", () => {
    render(<Input label="Instance URL" hint="Use the public HTTPS URL." error="A URL is required." />);

    expect(screen.getByText("A URL is required.")).toBeTruthy();
    expect(screen.queryByText("Use the public HTTPS URL.")).toBeNull();
  });

  it("does not render a hint node when no hint is provided", () => {
    const { container } = render(<Input label="Instance URL" />);

    expect(container.querySelector(".at-hint")).toBeNull();
  });
});
