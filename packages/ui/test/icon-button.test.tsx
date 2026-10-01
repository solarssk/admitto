import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "../src/components/IconButton.js";

const icon = <i data-testid="icon" className="ti ti-checks" />;

describe("IconButton", () => {
  it("renders the icon, names the button by its label and is a plain button", () => {
    render(<IconButton icon={icon} label="Mark all as read" />);
    const btn = screen.getByRole("button", { name: "Mark all as read" }) as HTMLButtonElement;
    expect(btn.type).toBe("button");
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(btn.className).toBe("at-iconbtn");
  });

  it("adds the size and caller classes, and passes other props on", () => {
    render(<IconButton icon={icon} label="Clear all" size="sm" className="extra" data-testid="b" />);
    const btn = screen.getByTestId("b");
    expect(btn.className).toBe("at-iconbtn at-iconbtn--sm extra");
  });

  it("is not busy by default, and a click reaches the caller's handler with its event", () => {
    const onClick = vi.fn();
    render(<IconButton icon={icon} label="Go" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn.hasAttribute("aria-busy")).toBe(false);
    expect(btn.hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ type: "click" }));
  });

  it("stays really disabled when only `disabled` is set", () => {
    render(<IconButton icon={icon} label="Go" disabled />);
    expect((screen.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(true);
  });

  describe("loading", () => {
    it("is aria-busy and aria-disabled, shows a spinner in place of the icon and keeps its name", () => {
      render(<IconButton icon={icon} label="Mark all as read" loading />);
      const btn = screen.getByRole("button", { name: "Mark all as read" });
      expect(btn.getAttribute("aria-busy")).toBe("true");
      expect(btn.getAttribute("aria-disabled")).toBe("true");
      expect(screen.queryByTestId("icon")).toBeNull();
      expect(btn.querySelector(".at-iconbtn__spinner")?.getAttribute("aria-hidden")).toBe("true");
    });

    it("ignores clicks: no handler, no bubbling to a clickable parent", () => {
      const onClick = vi.fn();
      const onParentClick = vi.fn();
      render(
        <div role="presentation" onClick={onParentClick}>
          <IconButton icon={icon} label="Go" loading onClick={onClick} />
        </div>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Go" }));
      expect(onClick).not.toHaveBeenCalled();
      expect(onParentClick).not.toHaveBeenCalled();
    });

    it("is not `disabled`, so a browser does not take its focus away when it turns busy", () => {
      const { rerender } = render(<IconButton icon={icon} label="Go" loading={false} />);
      const btn = screen.getByRole("button", { name: "Go" }) as HTMLButtonElement;
      btn.focus();

      rerender(<IconButton icon={icon} label="Go" loading />);

      expect(btn.disabled).toBe(false);
      expect(document.activeElement).toBe(btn);
      rerender(<IconButton icon={icon} label="Go" loading={false} />);
      expect(document.activeElement).toBe(btn);
      expect(btn.hasAttribute("aria-disabled")).toBe(false);
      expect(screen.getByTestId("icon")).toBeTruthy();
    });

    it("is not `disabled` while busy even when `disabled` is set too, and is again afterwards", () => {
      const onClick = vi.fn();
      const { rerender } = render(<IconButton icon={icon} label="Go" loading disabled onClick={onClick} />);
      const btn = screen.getByRole("button", { name: "Go" }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      expect(onClick).not.toHaveBeenCalled();

      rerender(<IconButton icon={icon} label="Go" loading={false} disabled onClick={onClick} />);
      expect(btn.disabled).toBe(true);
    });
  });
});
