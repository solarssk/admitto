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

  it("renders exactly as before when it is not busy-aware (no `loading` passed)", () => {
    const { container } = render(<MoreActionsMenuItem icon="send" label="Send" hint="Email" onClick={() => {}} />);
    expect(container.querySelector(".at-spinner")).toBeNull();
    expect(container.querySelector(".more-actions-menu__icon")).toBeNull();
    expect(screen.getByRole("menuitem").getAttribute("aria-busy")).toBeNull();
  });

  it("keeps the icon and label while idle, with a spinner reserved in the same slot", () => {
    const { container } = render(
      <MoreActionsMenuItem icon="send" label="Send tickets" loadingLabel="Sending…" loading={false} hint="Email" onClick={() => {}} />,
    );
    const item = screen.getByRole("menuitem", { name: /Send tickets/ });
    expect(item.getAttribute("aria-busy")).toBeNull();
    expect((item as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelector(".more-actions-menu__icon > i.ti-send")).not.toBeNull();
    expect(container.querySelector(".more-actions-menu__icon > .at-spinner")).not.toBeNull();
  });

  it("is busy, disabled and shows the busy label while loading, and ignores a click", () => {
    const onClick = vi.fn();
    render(
      <MoreActionsMenuItem icon="send" label="Send tickets" loadingLabel="Sending…" loading hint="Email" onClick={onClick} />,
    );
    const item = screen.getByRole("menuitem", { name: /Sending…/ }) as HTMLButtonElement;
    expect(item.getAttribute("aria-busy")).toBe("true");
    expect(item.disabled).toBe(true);
    expect(screen.queryByText("Send tickets")).toBeNull();
    fireEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps its label while loading when no loadingLabel is given", () => {
    render(<MoreActionsMenuItem icon="send" label="Send tickets" loading hint="Email" onClick={() => {}} />);
    expect(screen.getByRole("menuitem", { name: /Send tickets/ }).getAttribute("aria-busy")).toBe("true");
  });

  it("stays disabled for its own reason when it is not loading", () => {
    render(<MoreActionsMenuItem icon="send" label="Send" loading={false} disabled hint="Email" onClick={() => {}} />);
    expect((screen.getByRole("menuitem") as HTMLButtonElement).disabled).toBe(true);
  });
});
