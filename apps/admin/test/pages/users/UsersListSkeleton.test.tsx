// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UsersListSkeleton, UsersStatsSkeleton } from "../../../src/pages/users/UsersListSkeleton.js";
import { SLOW_NOTICE_TEXT } from "../../../src/utils/loading-timing.js";

afterEach(cleanup);

const COLUMNS = [{ label: "User" }, { label: "Device", className: "sessions-col-tablet-hide" }, { label: <span className="sr-only">Action</span> }];

describe("UsersListSkeleton", () => {
  const draw = (props: Partial<Parameters<typeof UsersListSkeleton>[0]> = {}) =>
    render(<UsersListSkeleton label="Loading users" held={false} slow={false} columns={COLUMNS} rows={5} rowHeight={40} cards={3} cardHeight={230} {...props} />);

  it("is a status region named after what is loading, whose shapes are hidden from assistive tech", () => {
    const { container } = draw();
    const region = screen.getByRole("status", { name: "Loading users" });
    expect(region.className).not.toContain("at-loading-hold");
    expect(container.querySelector(".users-page__table-wrap")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".users-page__cards")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("holds its room without painting until the 200ms have passed", () => {
    draw({ held: true });
    expect(screen.getByLabelText("Loading users").className).toContain("at-loading-hold");
  });

  it("keeps the real column headings, with their own classes, one bar per row at the given height, and the cards of the mobile list", () => {
    const { container } = draw();
    expect([...container.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["User", "Device", "Action"]);
    expect(container.querySelector("th.sessions-col-tablet-hide")?.textContent).toBe("Device");
    const rows = [...container.querySelectorAll<HTMLElement>("tbody td .at-skeleton")];
    expect(rows).toHaveLength(5);
    expect(rows.every((bar) => bar.style.height === "40px")).toBe(true);
    expect(container.querySelector("tbody td")?.getAttribute("colspan")).toBe("3");
    const cards = [...container.querySelectorAll<HTMLElement>(".users-page__cards--mobile .at-skeleton")];
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.style.height === "230px")).toBe(true);
  });

  it("says it is taking longer than usual after 8 seconds", () => {
    draw({ slow: true });
    expect(screen.getByLabelText("Loading users").textContent).toContain(SLOW_NOTICE_TEXT);
  });
});

describe("UsersStatsSkeleton", () => {
  it("is four tiles in the KPI grid, hidden from assistive tech, and held for 200ms like the list", () => {
    const { container, rerender } = render(<UsersStatsSkeleton held />);
    const grid = container.querySelector(".users-page__stats") as HTMLElement;
    expect(grid.getAttribute("aria-hidden")).toBe("true");
    expect(grid.className).toContain("at-loading-hold");
    expect(grid.querySelectorAll(".users-page__stat-card")).toHaveLength(4);
    // The icon square is the real 44px, so the tile is as tall as a real one.
    expect((grid.querySelector(".users-page__stat > .at-skeleton") as HTMLElement).style.height).toBe("44px");
    rerender(<UsersStatsSkeleton held={false} />);
    expect(container.querySelector(".users-page__stats")?.className).not.toContain("at-loading-hold");
  });
});
