import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Notice } from "../src/components/Notice.js";

describe("Notice", () => {
  it.each([
    ["info", "info-circle"],
    ["success", "circle-check"],
    ["warning", "alert-triangle"],
    ["error", "circle-x"],
  ] as const)("renders the %s variant class and %s icon", (variant, icon) => {
    render(<Notice variant={variant}>Message</Notice>);
    const notice = screen.getByText("Message").closest("p");
    expect(notice?.className).toContain(`at-notice--${variant}`);
    expect(notice?.querySelector(`i.ti-${icon}`)).toBeTruthy();
  });

  it("renders children", () => {
    render(<Notice variant="info">Hello there</Notice>);
    expect(screen.getByText("Hello there")).toBeTruthy();
  });

  it("does not set a role by default", () => {
    render(<Notice variant="warning">Message</Notice>);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("passes role through to the caller (e.g. role=alert for a warning)", () => {
    render(
      <Notice variant="warning" role="alert">
        Message
      </Notice>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Message");
  });

  it("merges a caller-supplied className", () => {
    render(
      <Notice variant="info" className="custom-class">
        Message
      </Notice>,
    );
    const notice = screen.getByText("Message").closest("p");
    expect(notice?.className).toContain("at-notice");
    expect(notice?.className).toContain("custom-class");
  });

  it("hides the icon from assistive tech", () => {
    render(<Notice variant="info">Message</Notice>);
    const icon = screen.getByText("Message").closest("p")?.querySelector("i");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });
});
