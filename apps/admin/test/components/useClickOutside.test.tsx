// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolvesInsideContainer,
  useClickOutside,
  type OutsideInteraction,
} from "../../src/components/useClickOutside.js";

function Harness({ open, onOutside }: { open: boolean; onOutside: (reason: OutsideInteraction) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, onOutside);
  return (
    <dialog data-testid="ancestor-dialog" open>
      <div ref={ref} data-testid="inside">
        <button type="button" id="inside-button" data-testid="inside-button">
          inside
        </button>
      </div>
      <button type="button" data-testid="outside">
        outside
      </button>
      {/* A DOM sibling of the container - the showLabel={false} pattern (AuditLogPanel's own
       * "Action" caption), whose `for` points at a button that lives INSIDE the container. */}
      <label htmlFor="inside-button" data-testid="label-for-inside">
        caption for the inside button
      </label>
      {/* A label for some other, genuinely unrelated control - should behave like any other
       * outside element. */}
      <label htmlFor="does-not-exist" data-testid="label-for-nothing">
        unrelated caption
      </label>
    </dialog>
  );
}

afterEach(() => cleanup());

describe("useClickOutside", () => {
  it("calls onOutside with reason 'pointer' on a pointerdown outside the container while open", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onOutside).toHaveBeenCalledWith("pointer");
  });

  it("does not call onOutside on a pointerdown inside the container", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("inside"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("does nothing while closed", () => {
    const onOutside = vi.fn();
    render(<Harness open={false} onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("calls onOutside with reason 'focus' when focus moves outside the container (e.g. Tab to another control, with no pointerdown)", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.focusIn(screen.getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onOutside).toHaveBeenCalledWith("focus");
  });

  it("does not call onOutside when focus moves within the container", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.focusIn(screen.getByTestId("inside-button"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("does not react to focus changes while closed", () => {
    const onOutside = vi.fn();
    render(<Harness open={false} onOutside={onOutside} />);
    fireEvent.focusIn(screen.getByTestId("outside"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("does not call onOutside on a pointerdown on a <label for> whose control lives inside the container", () => {
    // Regression coverage: a DOM sibling <label for="inside-button"> (a showLabel={false}
    // caller's own external caption) natively re-dispatches a click at its labelled control a
    // moment after this pointerdown - if this listener treated the label itself as "outside" and
    // closed, that native forwarded click would then toggle the (now-closed) trigger open again,
    // flickering closed-then-open on every click near the label (PO report, AuditLogPanel's
    // "Action" filter).
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("label-for-inside"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("still calls onOutside on a pointerdown on a <label for> whose control is not inside the container", () => {
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("label-for-nothing"));
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onOutside).toHaveBeenCalledWith("pointer");
  });

  it("does not call onOutside when focus moves to an ancestor of the container", () => {
    // Regression coverage: mousedown on non-focusable content inside the container (e.g. this
    // field's own <label>) makes the browser fall back to focusing the nearest focusable
    // ancestor - inside a real page, often the surrounding <dialog>/modal - firing a focusin
    // whose target contains the container rather than a sibling control the user actually chose.
    // A genuinely different control can never contain this one, so treating that fallback focus
    // as "outside" closed the panel mid-press, and the label's own forwarded click then reopened
    // it on release, flickering closed-then-open on every held click near the label inside a
    // <dialog> (PO report, Attendee/Event edit modals).
    const onOutside = vi.fn();
    render(<Harness open onOutside={onOutside} />);
    fireEvent.focusIn(screen.getByTestId("ancestor-dialog"));
    expect(onOutside).not.toHaveBeenCalled();
  });
});

describe("resolvesInsideContainer", () => {
  it("is false when there is no container", () => {
    expect(resolvesInsideContainer(document.createElement("button"), null)).toBe(false);
  });

  it("is false when the target is not a DOM node (e.g. window)", () => {
    expect(resolvesInsideContainer(window, document.createElement("div"))).toBe(false);
  });

  it("is true when the target is inside the container", () => {
    const container = document.createElement("div");
    const child = document.createElement("button");
    container.appendChild(child);
    expect(resolvesInsideContainer(child, container)).toBe(true);
  });

  it("is false for a target that's a Node but not an Element (e.g. a text node), and not inside the container", () => {
    const container = document.createElement("div");
    const text = document.createTextNode("hello");
    expect(resolvesInsideContainer(text, container)).toBe(false);
  });

  it("is true for a <label for> whose labelled control lives inside the container", () => {
    const container = document.createElement("div");
    const button = document.createElement("button");
    button.id = "labelled-button";
    container.appendChild(button);
    document.body.appendChild(container);

    const label = document.createElement("label");
    label.htmlFor = "labelled-button";
    document.body.appendChild(label);

    expect(resolvesInsideContainer(label, container)).toBe(true);

    container.remove();
    label.remove();
  });

  it("is false for a <label for> whose labelled control doesn't exist", () => {
    const container = document.createElement("div");
    const label = document.createElement("label");
    label.htmlFor = "no-such-id";
    expect(resolvesInsideContainer(label, container)).toBe(false);
  });

  it("is false for a plain <label> with no for attribute", () => {
    const container = document.createElement("div");
    const label = document.createElement("label");
    expect(resolvesInsideContainer(label, container)).toBe(false);
  });

  it("is true when the target is an ancestor of the container (e.g. the enclosing <dialog>)", () => {
    const dialog = document.createElement("dialog");
    const container = document.createElement("div");
    dialog.appendChild(container);
    expect(resolvesInsideContainer(dialog, container)).toBe(true);
  });
});
