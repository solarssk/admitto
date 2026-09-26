// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AttendeeCardDto } from "../../src/api/types.js";
import { AttendeeCard } from "../../src/checkin/AttendeeCard.js";

afterEach(() => {
  cleanup();
});

function baseCard(overrides: Partial<AttendeeCardDto> = {}): AttendeeCardDto {
  return {
    id: "att-1",
    name: "Anna Alpha",
    company: null,
    department: null,
    ticket_type: "vip",
    check_in_status: "admitted",
    admitted_at: "2026-09-01T09:44:00.000Z",
    items: [],
    notes: [],
    blocked: false,
    ...overrides,
  };
}

describe("AttendeeCard — company/department separator", () => {
  it.each(["IKEA", "Nestlé", "H&M", "KLM Royal Dutch Airlines", "The Coca-Cola Company"])(
    "keeps the separator attached to company, not a standalone flex item, when both are set (%s)",
    (company) => {
      render(<AttendeeCard card={baseCard({ company, department: "Events" })} eventTimezone="UTC" canAct={true} />);

      const companyLabel = screen.getByText(company).closest("span");
      expect(companyLabel?.textContent).toBe(`${company} ·`);
      expect(screen.getByText("Events")).toBeTruthy();
    },
  );

  it("shows company alone with no separator when department is missing", () => {
    render(
      <AttendeeCard card={baseCard({ company: "Zara", department: null })} eventTimezone="UTC" canAct={true} />,
    );

    expect(screen.getByText("Zara").textContent).toBe("Zara");
    expect(screen.queryByText("·")).toBeNull();
  });

  it("shows department alone with no separator when company is missing", () => {
    render(
      <AttendeeCard card={baseCard({ company: null, department: "Ops" })} eventTimezone="UTC" canAct={true} />,
    );

    expect(screen.getByText("Ops")).toBeTruthy();
    expect(screen.queryByText("·")).toBeNull();
  });
});
