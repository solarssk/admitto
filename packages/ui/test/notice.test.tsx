import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Notice } from "../src/components/Notice.js";

describe("Notice", () => {
  it.each([
    ["info", "info-circle"],
    ["highlight", "info-circle"],
    ["success", "circle-check"],
    ["warning", "alert-triangle"],
    ["error", "circle-x"],
  ] as const)("renders the %s variant class and %s icon", (variant, icon) => {
    render(<Notice variant={variant}>Message</Notice>);
    const notice = screen.getByText("Message").closest("p");
    expect(notice?.className).toContain(`at-notice--${variant}`);
    expect(notice?.querySelector(`i.ti-${icon}`)).toBeTruthy();
  });

  it("overrides the variant's default icon when icon is given", () => {
    render(
      <Notice variant="highlight" icon="qrcode-off">
        Message
      </Notice>,
    );
    const notice = screen.getByText("Message").closest("p");
    expect(notice?.querySelector("i.ti-qrcode-off")).toBeTruthy();
    expect(notice?.querySelector("i.ti-info-circle")).toBeNull();
  });

  it("renders children", () => {
    render(<Notice variant="info">Hello there</Notice>);
    expect(screen.getByText("Hello there")).toBeTruthy();
  });

  it("does not set a role by default", () => {
    render(<Notice variant="warning">Message</Notice>);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("passes role through to the caller (e.g. role=alert for a warning)", () => {
    render(
      <Notice variant="warning" role="alert">
        Message
      </Notice>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Message");
  });

  it("merges a caller-supplied className", () => {
    render(
      <Notice variant="info" className="custom-class">
        Message
      </Notice>,
    );
    const notice = screen.getByText("Message").closest("p");
    expect(notice?.className).toContain("at-notice");
    expect(notice?.className).toContain("custom-class");
  });

  it("hides the icon from assistive tech", () => {
    render(<Notice variant="info">Message</Notice>);
    const icon = screen.getByText("Message").closest("p")?.querySelector("i");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders as a <p> by default", () => {
    render(<Notice variant="success">Message</Notice>);
    expect(screen.getByText("Message").closest("p")).not.toBeNull();
  });

  it("renders as an <output> when as=\"output\" is given, e.g. a derived success state", () => {
    render(
      <Notice variant="success" as="output">
        Message
      </Notice>,
    );
    const notice = screen.getByText("Message").closest("output");
    expect(notice).not.toBeNull();
    expect(notice?.className).toContain("at-notice--success");
  });

  it("does not render an action slot or its modifier class by default", () => {
    render(<Notice variant="error">Message</Notice>);
    const notice = screen.getByText("Message").closest("p");
    expect(notice?.querySelector(".at-notice__action")).toBeNull();
    expect(notice?.className).not.toContain("at-notice--has-action");
  });

  it("renders action content as a separate flex item, distinct from the body text", () => {
    render(
      <Notice variant="error" action={<button type="button">Retry</button>}>
        Something failed.
      </Notice>,
    );
    const notice = screen.getByText("Something failed.").closest("p");
    expect(notice?.className).toContain("at-notice--has-action");
    const action = notice?.querySelector(".at-notice__action");
    expect(action?.querySelector("button")?.textContent).toBe("Retry");
    expect(notice?.querySelector(".at-notice__body")?.textContent).toBe("Something failed.");
  });

  describe("actionBusy", () => {
    const MESSAGE = "Could not load ticket types.";

    function retryNotice(busy: boolean) {
      return (
        <Notice variant="error" role="alert" actionBusy={busy} action={<button type="button">Retry</button>}>
          {MESSAGE}
        </Notice>
      );
    }

    it("mounts the message afresh when the action stops being busy, so the same text is a new addition to the alert", () => {
      const { rerender } = render(retryNotice(false));
      const alert = screen.getByRole("alert");
      const before = screen.getByText(MESSAGE);
      // What a screen reader hears is what a live region gains, so watch the alert itself.
      const observer = new MutationObserver(() => {});
      observer.observe(alert, { childList: true, subtree: true });

      rerender(retryNotice(true));
      expect(screen.getByText(MESSAGE)).toBe(before);

      rerender(retryNotice(false));
      expect(screen.getByText(MESSAGE)).not.toBe(before);
      const added = observer
        .takeRecords()
        .flatMap((record) => Array.from(record.addedNodes, (node) => node.textContent));
      expect(added).toContain(MESSAGE);
      observer.disconnect();
    });

    it("leaves the alert and the action button themselves in place, so a focused Retry keeps its focus", () => {
      const { rerender } = render(retryNotice(false));
      const alert = screen.getByRole("alert");
      const button = screen.getByRole("button", { name: "Retry" });
      button.focus();

      rerender(retryNotice(true));
      rerender(retryNotice(false));

      expect(screen.getByRole("alert")).toBe(alert);
      expect(screen.getByRole("button", { name: "Retry" })).toBe(button);
      expect(document.activeElement).toBe(button);
    });

    it("announces every further failure again, not only the first", () => {
      const { rerender } = render(retryNotice(false));
      const first = screen.getByText(MESSAGE);
      rerender(retryNotice(true));
      rerender(retryNotice(false));
      const second = screen.getByText(MESSAGE);
      rerender(retryNotice(true));
      rerender(retryNotice(false));
      const third = screen.getByText(MESSAGE);
      expect(new Set([first, second, third]).size).toBe(3);
    });

    it("keeps the message mounted when the action never was busy", () => {
      const { rerender } = render(retryNotice(false));
      const before = screen.getByText(MESSAGE);
      rerender(retryNotice(false));
      expect(screen.getByText(MESSAGE)).toBe(before);
    });
  });
});
