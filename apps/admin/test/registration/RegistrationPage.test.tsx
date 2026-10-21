// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import { RegistrationPage } from "../../src/pages/RegistrationPage.js";

const TABS = [
  ["requests", "Requests", "Registration requests from guests will be listed here."],
  ["fields", "Fields", "The questions guests answer on the registration form will be managed here."],
  ["access", "Access", "The registration mode and the ways guests can sign up will be set here."],
] as const;

/** Shows the query string of the address, so a test can read what a click wrote to it. */
function SearchProbe() {
  return <div data-testid="search">{useLocation().search}</div>;
}

function renderAt(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/admin/events/evt-1/registration${search}`]}>
      <RegistrationPage />
      <SearchProbe />
    </MemoryRouter>,
  );
}

function openTab(): HTMLElement {
  return screen.getByRole("tab", { selected: true });
}

afterEach(() => {
  cleanup();
});

describe("RegistrationPage", () => {
  it("has the page heading and the three tabs, with no number on Requests", () => {
    renderAt();

    expect(screen.getByRole("heading", { level: 1, name: "Registration" })).toBeTruthy();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Requests", "Fields", "Access"]);
  });

  it.each([
    ["", "Requests"],
    ["?tab=requests", "Requests"],
    ["?tab=fields", "Fields"],
    ["?tab=access", "Access"],
    ["?tab=nope", "Requests"],
    ["?tab=", "Requests"],
  ])("opens the tab for the address %j: %s", (search, label) => {
    renderAt(search);

    expect(openTab().textContent).toBe(label);
    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe(label);
  });

  it.each(TABS)("shows the %s tab as a plain empty state that says what will be there", (id, label, sentence) => {
    renderAt(`?tab=${id}`);

    const panel = screen.getByRole("tabpanel", { name: label });
    expect(within(panel).getByRole("status").textContent).toBe(sentence);
    // A tab that has nothing to show yet is an empty list, not a failed load.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("opens the tab that is clicked and writes it to the address", () => {
    renderAt();

    fireEvent.click(screen.getByRole("tab", { name: "Access" }));

    expect(openTab().textContent).toBe("Access");
    expect(screen.getByRole("tabpanel", { name: "Access" })).toBeTruthy();
    expect(screen.getByTestId("search").textContent).toBe("?tab=access");
  });

  it("keeps only the open tab in the tab order and moves with the arrow, Home and End keys", () => {
    renderAt();
    const tabIndexes = () => screen.getAllByRole("tab").map((tab) => tab.tabIndex);
    expect(tabIndexes()).toEqual([0, -1, -1]);

    fireEvent.keyDown(openTab(), { key: "ArrowRight" });
    expect(openTab().textContent).toBe("Fields");
    expect(document.activeElement).toBe(openTab());
    expect(tabIndexes()).toEqual([-1, 0, -1]);

    fireEvent.keyDown(openTab(), { key: "End" });
    expect(openTab().textContent).toBe("Access");

    fireEvent.keyDown(openTab(), { key: "ArrowRight" });
    expect(openTab().textContent).toBe("Requests");

    fireEvent.keyDown(openTab(), { key: "ArrowLeft" });
    expect(openTab().textContent).toBe("Access");

    fireEvent.keyDown(openTab(), { key: "Home" });
    expect(openTab().textContent).toBe("Requests");
    expect(screen.getByTestId("search").textContent).toBe("?tab=requests");
  });
});
