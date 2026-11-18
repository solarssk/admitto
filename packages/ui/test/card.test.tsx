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

describe("Card collapsible", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/components.css"), "utf8");
  const renderCard = (props: { defaultOpen?: boolean } = {}) =>
    render(
      <Card title={<>Done <span>7</span></>} collapsible {...props} footer="Foot">
        Body text
      </Card>,
    );

  it("is closed by default: a header that is one button, with the count, and no body, no footer", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: /Done/ });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.classList.contains("at-card__header")).toBe(true);
    expect(toggle.classList.contains("at-card__header--closed")).toBe(true);
    expect(toggle.textContent).toContain("7");
    expect(toggle.querySelector(".at-card__title")).not.toBeNull();
    expect(toggle.querySelector(".at-card__chevron")).not.toBeNull();
    expect(screen.queryByText("Body text")).toBeNull();
    expect(screen.queryByText("Foot")).toBeNull();
  });

  it("opens and closes on a click, and says so with aria-expanded, aria-controls and the body it controls", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: /Done/ });

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.classList.contains("at-card__header--closed")).toBe(false);
    const body = document.getElementById(toggle.getAttribute("aria-controls") as string);
    expect(body?.textContent).toBe("Body text");
    expect(screen.getByText("Foot")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Body text")).toBeNull();
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

  it("starts open with defaultOpen", () => {
    renderCard({ defaultOpen: true });

    expect(screen.getByRole("button", { name: /Done/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Body text")).toBeTruthy();
  });

  it("leaves a card that is not collapsible as it was: a div header, the body always there, no button", () => {
    render(<Card title="Plain">Body</Card>);

    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector(".at-card__header")?.tagName).toBe("DIV");
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("has the focus ring inside the header, with the app's focus colour, and a chevron that turns", () => {
    expect(css).toMatch(/\.at-card__header--toggle:focus-visible \{ outline: none; box-shadow: inset 0 0 0 var\(--ring-width\) var\(--focus-ring\)/);
    expect(css).toMatch(/\.at-card__header--toggle\[aria-expanded="true"\] \.at-card__chevron \{ transform: rotate\(180deg\)/);
    expect(css).toMatch(/\.at-card__header--closed \{ border-bottom-color: transparent/);
  });
});
