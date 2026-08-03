// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoreActionsMenuItem } from "../../src/components/MoreActionsMenuItem.js";

afterEach(() => {
  cleanup();
});

describe("MoreActionsMenuItem", () => {
  it("applies a danger variant class when variant is set", () => {
    const onClick = vi.fn();
    render(
      <MoreActionsMenuItem
        icon="trash"
        label="Delete"
        hint="Remove forever"
        variant="danger"
        onClick={onClick}
      />,
    );
    const item = screen.getByRole("menuitem", { name: /Delete/ });
    expect(item.className).toContain("more-actions-menu__item--danger");
    fireEvent.click(item);
    expect(onClick).toHaveBeenCalled();
  });

  it("renders without a variant class when variant is omitted", () => {
    render(
      <MoreActionsMenuItem icon="download" label="Export" hint="Save file" onClick={() => {}} />,
    );
    const item = screen.getByRole("menuitem", { name: /Export/ });
    expect(item.className).not.toMatch(/more-actions-menu__item--/);
  });
});
