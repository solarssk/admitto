import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Input } from "../src/components/Input.js";

describe("Input", () => {
  it("renders an optional hint and wires it to the input", () => {
    render(<Input label="Instance URL" hint="Use the public HTTPS URL." />);

    const input = screen.getByLabelText("Instance URL");
    const hint = screen.getByText("Use the public HTTPS URL.");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("shows an error instead of a hint, announced as a live region", () => {
    render(<Input label="Instance URL" hint="Use the public HTTPS URL." error="A URL is required." />);

    const error = screen.getByText("A URL is required.");
    expect(error).toBeTruthy();
    expect(error.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("Use the public HTTPS URL.")).toBeNull();
  });

  it("does not render a hint node when no hint is provided", () => {
    const { container } = render(<Input label="Instance URL" />);

    expect(container.querySelector(".at-hint")).toBeNull();
  });

  it("renders a decorative, non-interactive icon when onIconClick is not set", () => {
    const { container } = render(<Input label="Redirect URI" icon={<i />} />);

    expect(container.querySelector("button.at-inputgroup__icon")).toBeNull();
    const icon = container.querySelector("span.at-inputgroup__icon");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the icon as a labeled button and calls onIconClick when clicked", () => {
    const onIconClick = vi.fn();
    render(<Input label="Redirect URI" icon={<i />} onIconClick={onIconClick} iconLabel="Copy" />);

    const button = screen.getByRole("button", { name: "Copy" });
    button.click();
    expect(onIconClick).toHaveBeenCalledOnce();
  });
});
