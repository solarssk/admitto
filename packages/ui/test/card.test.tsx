// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
