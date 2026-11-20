// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "../src/components/Card.js";

afterEach(() => {
  cleanup();
});

describe("Card", () => {
  it("renders actions in the at-card__actions slot", () => {
    render(
      <Card title="Overview" actions={<button type="button">Run</button>}>
        Body
      </Card>,
    );
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(document.querySelector(".at-card__actions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  });
});

describe("Card without the collapsible part", () => {
  it("has no header at all when it has neither a title nor actions", () => {
    render(<Card>Only a body</Card>);

    expect(document.querySelector(".at-card__header")).toBeNull();
    expect(screen.getByText("Only a body")).toBeTruthy();
  });

  it("has a header with only its actions when it has no title", () => {
    render(<Card actions={<span>Act</span>}>Body</Card>);

    expect(document.querySelector(".at-card__title")).toBeNull();
    expect(document.querySelector(".at-card__actions")?.textContent).toBe("Act");
  });

  it("gives what it is given with no padding wrapper when it is not padded, and shows its footer", () => {
    render(<Card padded={false} footer="Foot"><table data-testid="t" /></Card>);

    expect(document.querySelector(".at-card__body")).toBeNull();
    expect(screen.getByTestId("t").parentElement?.classList.contains("at-card")).toBe(true);
    expect(document.querySelector(".at-card__footer")?.textContent).toBe("Foot");
  });

  it("has no footer element when it is given none", () => {
    render(<Card title="T">Body</Card>);

    expect(document.querySelector(".at-card__footer")).toBeNull();
  });
});

describe("Card collapsible", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/components.css"), "utf8");
  const renderCard = (props: { defaultOpen?: boolean } = {}) =>
    render(
      <Card title={<>Done <span>7</span></>} collapsible {...props} footer={<button type="button">Foot</button>}>
        <a href="#x">Body link</a>
      </Card>,
    );
  const collapse = () => document.querySelector(".at-card__collapse") as HTMLElement;

  it("is closed by default: a header that is one button, with the count, and a body that is not mounted yet", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: /Done/ });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.classList.contains("at-card__header")).toBe(true);
    expect(toggle.classList.contains("at-card__header--closed")).toBe(true);
    expect(toggle.textContent).toContain("7");
    expect(toggle.querySelector(".at-card__title")).not.toBeNull();
    expect(toggle.querySelector(".at-card__chevron")).not.toBeNull();
    // Mounted from the first render, so that opening does not mount it inside the first frames of the transition.
    expect(collapse().contains(screen.getByText("Body link"))).toBe(true);
    expect(collapse().contains(screen.getByText("Foot"))).toBe(true);
    // The element the button controls is always there, closed and inert.
    expect(toggle.getAttribute("aria-controls")).toBe(collapse().id);
    expect(collapse().getAttribute("data-open")).toBe("false");
    expect(collapse().hasAttribute("inert")).toBe(true);
  });

  it("opens on a click, with the same body, and is reachable: aria-expanded, data-open and no inert", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: /Done/ });

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.classList.contains("at-card__header--closed")).toBe(false);
    expect(collapse().getAttribute("data-open")).toBe("true");
    expect(collapse().hasAttribute("inert")).toBe(false);
    expect(collapse().contains(screen.getByText("Body link"))).toBe(true);
    expect(screen.getByText("Foot")).toBeTruthy();
  });

  it("closes on a second click: the body stays mounted for the closing, and nothing in it can be reached", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: /Done/ });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(collapse().getAttribute("data-open")).toBe("false");
    expect(collapse().hasAttribute("inert")).toBe(true);
    expect(screen.getByText("Body link")).toBeTruthy();
    // jsdom has no inert; what an inert subtree holds is never focusable in a browser, so the card must mark the one wrapper that holds all of it.
    expect(collapse().querySelectorAll("a, button")).toHaveLength(2);
    expect(Array.from(document.querySelectorAll("a, button")).filter((el) => !collapse().contains(el)).map((el) => el.textContent)).toEqual(["Done 7"]);
  });

  it("is a native button of type button that is in the tab order, so Enter and Space work, and keeps the focus", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: /Done/ }) as HTMLButtonElement;

    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.type).toBe("button");
    expect(toggle.tabIndex).toBe(0);
    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(toggle);
  });

  it("keeps what is in the body when the card closes and opens again: the same elements", () => {
    renderCard();
    const link = screen.getByText("Body link");
    const toggle = screen.getByRole("button", { name: /Done/ });

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.getByText("Body link")).toBe(link);
  });

  it("shows what it is given as meta at the right of the title, just before the chevron", () => {
    render(<Card title="Done" meta={<span>7</span>} collapsible>Body</Card>);
    const meta = document.querySelector(".at-card__meta") as HTMLElement;

    expect(meta.textContent).toBe("7");
    expect(meta.previousElementSibling?.className).toBe("at-card__title");
    expect(meta.nextElementSibling?.className).toContain("at-card__chevron");
    expect(css).toMatch(/\.at-card__meta \{ margin-left: auto;/);
    expect(css).toMatch(/\.at-card__meta \+ \.at-card__chevron \{ margin-left: 0;/);
  });

  it("leaves out the actions it is given, because its header is one button", () => {
    render(<Card title="Done" collapsible actions={<span>Act</span>}>Body</Card>);

    expect(screen.queryByText("Act")).toBeNull();
    expect(document.querySelector(".at-card__meta")).toBeNull();
  });

  it("has no footer element while it is given none, open or closed", () => {
    render(<Card title="Done" collapsible defaultOpen>Body</Card>);

    expect(document.querySelector(".at-card__footer")).toBeNull();
  });

  it("gives an unpadded body to the element it controls, as it is", () => {
    render(<Card title="Done" collapsible padded={false}><i data-testid="raw" /></Card>);

    expect(document.querySelector(".at-card__body")).toBeNull();
    expect(screen.getByTestId("raw").parentElement?.classList.contains("at-card__collapse-inner")).toBe(true);
  });

  it("starts open with defaultOpen, with the body mounted", () => {
    renderCard({ defaultOpen: true });

    expect(screen.getByRole("button", { name: /Done/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Body link")).toBeTruthy();
    expect(collapse().hasAttribute("inert")).toBe(false);
  });

  it("leaves a card that is not collapsible as it was: a div header, the body always there, no button, no wrapper", () => {
    render(<Card title="Plain">Body</Card>);

    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector(".at-card__header")?.tagName).toBe("DIV");
    expect(document.querySelector(".at-card__collapse")).toBeNull();
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("has the focus ring inside the header, with the app's focus colour, and a chevron that turns", () => {
    expect(css).toMatch(/\.at-card__header--toggle:focus-visible \{ outline: none; box-shadow: inset 0 0 0 var\(--ring-width\) var\(--focus-ring\)/);
    expect(css).toMatch(/\.at-card__header--toggle\[aria-expanded="true"\] \.at-card__chevron \{ transform: rotate\(180deg\)/);
    expect(css).toMatch(/\.at-card__header--closed \{ border-bottom-color: transparent/);
  });

  it("opens by growing a grid row from 0fr to 1fr with the kit's duration and the easing that moves it over the whole time, and hides what is closed once the closing has finished", () => {
    expect(css).toMatch(/\.at-card__collapse \{ display: grid; grid-template-rows: 0fr; opacity: 0; visibility: hidden; transition: grid-template-rows var\(--dur-slow\) var\(--ease-in-out\), opacity var\(--dur-slow\) var\(--ease-in-out\), visibility 0s linear var\(--dur-slow\)/);
    expect(css).toMatch(/\.at-card__collapse\[data-open="true"\] \{ grid-template-rows: 1fr; opacity: 1; visibility: visible; transition: [^}]*visibility 0s;/);
    expect(css).toMatch(/\.at-card__collapse-inner \{ min-height: 0; overflow: hidden;/);
    // The border of the header changes with the body, and the chevron turns for as long.
    expect(css).toMatch(/\.at-card__header--toggle \{[^}]*transition: border-color var\(--dur-slow\)/);
    expect(css).toMatch(/\.at-card__chevron \{[^}]*transition: transform var\(--dur-slow\) var\(--ease-in-out\)/);
  });

  it("does not animate for a person who asked for less motion", () => {
    const rule = /@media \(prefers-reduced-motion: reduce\) \{ \.at-card__chevron, \.at-card__header--toggle, \.at-card__collapse, \.at-card__collapse\[data-open="true"\] \{ transition: none; \} \}/;

    expect(css).toMatch(rule);
  });
});
