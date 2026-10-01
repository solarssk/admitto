import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../src/components/Button.js";

describe("Button", () => {
  it("renders its label and is not busy by default", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.hasAttribute("aria-busy")).toBe(false);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("stays disabled without being busy when only `disabled` is set", () => {
    render(<Button disabled>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.hasAttribute("aria-busy")).toBe(false);
  });

  describe("loading", () => {
    it("is aria-busy and aria-disabled, and ignores clicks (no double fire)", () => {
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Save
        </Button>,
      );
      const btn = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
      expect(btn.getAttribute("aria-busy")).toBe("true");
      expect(btn.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(btn);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("is not `disabled`, so a browser does not take its focus away when it turns busy", () => {
      const { rerender } = render(<Button loading={false}>Retry</Button>);
      const btn = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
      btn.focus();
      expect(document.activeElement).toBe(btn);

      rerender(<Button loading>Retry</Button>);

      expect(btn.disabled).toBe(false);
      expect(document.activeElement).toBe(btn);
      rerender(<Button loading={false}>Retry</Button>);
      expect(document.activeElement).toBe(btn);
      expect(btn.hasAttribute("aria-disabled")).toBe(false);
    });

    it("swallows the click whole: it does not submit its form or reach a clickable parent", () => {
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      const onParentClick = vi.fn();
      render(
        <form onSubmit={onSubmit}>
          <div onClick={onParentClick} role="presentation">
            <Button type="submit" loading>
              Save
            </Button>
          </div>
        </form>,
      );
      const btn = screen.getByRole("button", { name: "Save" });

      fireEvent.click(btn);

      expect(onSubmit).not.toHaveBeenCalled();
      expect(onParentClick).not.toHaveBeenCalled();
    });

    it("runs its handler, submits and bubbles as usual once it is no longer busy", () => {
      const onClick = vi.fn();
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      const onParentClick = vi.fn();
      render(
        <form onSubmit={onSubmit}>
          <div onClick={onParentClick} role="presentation">
            <Button type="submit" loading={false} onClick={onClick}>
              Save
            </Button>
          </div>
        </form>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onParentClick).toHaveBeenCalledTimes(1);
    });

    it("hands its click event to the caller's handler", () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick}>Save</Button>);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ type: "click" }));
    });

    it("is not `disabled` while busy even when `disabled` is set too (callers pass the same flag to both), and is again afterwards", () => {
      const onClick = vi.fn();
      const { rerender } = render(
        <Button loading disabled onClick={onClick}>
          Save
        </Button>,
      );
      const btn = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      expect(btn.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(btn);
      expect(onClick).not.toHaveBeenCalled();

      rerender(
        <Button loading={false} disabled onClick={onClick}>
          Save
        </Button>,
      );
      expect(btn.disabled).toBe(true);
    });

    it("keeps the label and overlays a spinner when there is no icon and no loadingLabel", () => {
      const { container } = render(<Button loading>Save</Button>);
      const btn = screen.getByRole("button", { name: "Save" });
      expect(btn.className).toContain("at-btn--loading-solo");
      expect(container.querySelector(".at-btn__spinner--overlay")).not.toBeNull();
    });

    it("shows the spinner in the icon's own slot and keeps the icon in the layout (same width)", () => {
      const { container, rerender } = render(
        <Button icon={<i data-testid="ico" />} loading>
          Send
        </Button>,
      );
      const slot = container.querySelector(".at-btn__icon");
      expect(slot?.className).toContain("at-btn__icon--swap");
      // Both live in the one slot: hiding one and showing the other is pure CSS on `.at-btn--loading`.
      expect(slot?.querySelector(".at-btn__icon-face [data-testid=ico]")).not.toBeNull();
      expect(slot?.querySelectorAll(".at-btn__spinner")).toHaveLength(1);
      expect(container.querySelector(".at-btn__spinner--overlay")).toBeNull();
      expect(screen.getByRole("button", { name: "Send" }).className).toContain("at-btn--loading");

      rerender(
        <Button icon={<i data-testid="ico" />} loading={false}>
          Send
        </Button>,
      );
      expect(screen.getByRole("button", { name: "Send" }).className).not.toContain("at-btn--loading");
      expect(container.querySelector(".at-btn__icon")?.className).toContain("at-btn__icon--swap");
    });

    it("leaves buttons that never pass `loading` exactly as they were (no swap slot)", () => {
      const { container } = render(<Button icon={<i data-testid="ico" />}>Send</Button>);
      const slot = container.querySelector(".at-btn__icon");
      expect(slot?.className).toBe("at-btn__icon");
      expect(container.querySelector(".at-btn__spinner")).toBeNull();
    });

    it("exposes only the active label when loadingLabel is set, and keeps both in the layout", () => {
      const { container, rerender } = render(<Button loadingLabel="Saving…">Save</Button>);
      expect(screen.getByRole("button", { name: "Save" })).not.toBeNull();
      // Both labels stay rendered (stacked in one grid cell) so the width is the longer one.
      expect(container.querySelector(".at-btn__label-idle")?.textContent).toBe("Save");
      expect(container.querySelector(".at-btn__label-busy")?.textContent).toBe("Saving…");

      rerender(
        <Button loading loadingLabel="Saving…">
          Save
        </Button>,
      );
      expect(screen.getByRole("button", { name: "Saving…" })).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });

    it("puts the spinner inside the busy label when there is no icon slot to swap", () => {
      const { container } = render(
        <Button loading loadingLabel="Saving…">
          Save
        </Button>,
      );
      expect(container.querySelector(".at-btn__label-busy .at-btn__spinner")).not.toBeNull();
      expect(container.querySelector(".at-btn__spinner--overlay")).toBeNull();
    });

    it("does not add a second spinner to the busy label when the icon slot already shows one", () => {
      const { container } = render(
        <Button icon={<i />} loading loadingLabel="Sending…">
          Send
        </Button>,
      );
      expect(container.querySelectorAll(".at-btn__spinner")).toHaveLength(1);
      expect(container.querySelector(".at-btn__label-busy .at-btn__spinner")).toBeNull();
    });

    it("lets a caller's explicit aria-busy win (existing call sites set their own)", () => {
      render(
        <Button aria-busy={false} loading>
          Run
        </Button>,
      );
      expect(screen.getByRole("button", { name: "Run" }).getAttribute("aria-busy")).toBe("false");
    });
  });
});
