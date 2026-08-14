// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecipientCountNotice, RecipientOptionCards } from "../../src/communication/RecipientOptionCards.js";

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: "all", label: "All attendees", description: "Everyone.", icon: "ti-users" },
  { value: "ticket_type", label: "By ticket type", description: "By type.", icon: "ti-ticket" },
] as const;

describe("RecipientOptionCards", () => {
  it("renders every option and marks the current value checked", () => {
    render(
      <RecipientOptionCards options={OPTIONS} value="all" idPrefix="test" disabled={false} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("radio", { name: "All attendees" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "By ticket type" }).getAttribute("aria-checked")).toBe("false");
  });

  it("calls onChange with the clicked option's value", () => {
    const onChange = vi.fn();
    render(
      <RecipientOptionCards options={OPTIONS} value="all" idPrefix="test" disabled={false} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "By ticket type" }));
    expect(onChange).toHaveBeenCalledWith("ticket_type");
  });

  it("disables every option when disabled is true", () => {
    render(
      <RecipientOptionCards options={OPTIONS} value="all" idPrefix="test" disabled onChange={vi.fn()} />,
    );

    expect((screen.getByRole("radio", { name: "All attendees" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("namespaces the description id with idPrefix so two instances never collide", () => {
    render(
      <RecipientOptionCards options={OPTIONS} value="all" idPrefix="wallets-recipient" disabled={false} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("radio", { name: "All attendees" }).getAttribute("aria-describedby")).toBe(
      "wallets-recipient-all-desc",
    );
  });
});

describe("RecipientCountNotice", () => {
  it("renders nothing when count is null", () => {
    const { container } = render(<RecipientCountNotice count={null} />);
    expect(container.textContent).toBe("");
  });

  it("shows a warning when count is 0", () => {
    render(<RecipientCountNotice count={0} />);
    expect(screen.getByText("No recipients match this filter.")).toBeTruthy();
  });

  it("pluralizes correctly for exactly 1 recipient", () => {
    render(<RecipientCountNotice count={1} />);
    expect(screen.getByText(/1/)).toBeTruthy();
    expect(screen.getByText(/recipient matched/)).toBeTruthy();
  });

  it("pluralizes correctly for multiple recipients", () => {
    render(<RecipientCountNotice count={3} />);
    expect(screen.getByText(/recipients matched/)).toBeTruthy();
  });
});
