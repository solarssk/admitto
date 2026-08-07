// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModalFocusTrap } from "../../src/components/useModalFocusTrap.js";
import { useDropdownMenu } from "../../src/components/useDropdownMenu.js";
import { useRef, useState } from "react";

function makePanel(): HTMLDivElement {
  const panel = document.createElement("div");
  panel.innerHTML = `
    <button id="first">First</button>
    <button id="middle">Middle</button>
    <button id="last">Last</button>
  `;
  document.body.appendChild(panel);
  return panel;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useModalFocusTrap", () => {
  it("calls onCancel on Escape", () => {
    const panel = makePanel();
    const onCancel = vi.fn();
    renderHook(() => useModalFocusTrap({ current: panel }, true, onCancel));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last focusable back to the first", () => {
    const panel = makePanel();
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));

    panel.querySelector<HTMLElement>("#last")!.focus();
    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(panel.querySelector("#first"));
  });

  it("wraps Shift+Tab from the first focusable back to the last", () => {
    const panel = makePanel();
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));

    panel.querySelector<HTMLElement>("#first")!.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(panel.querySelector("#last"));
  });

  it("excludes buttons disabled only via an ancestor <fieldset disabled> from the Tab-trap cycle", () => {
    // Fieldset-inherited disabling never sets the `disabled` attribute on the descendant button
    // itself (only on the fieldset) - a modal with a disabled fieldset section (e.g. an
    // archived-event form) must still skip those buttons when cycling Tab, not just ones with
    // their own `disabled` attribute.
    const panel = document.createElement("div");
    panel.innerHTML = `
      <button id="first">First</button>
      <fieldset disabled>
        <button id="hidden1">Hidden 1</button>
        <button id="hidden2">Hidden 2</button>
      </fieldset>
      <button id="last">Last</button>
    `;
    document.body.appendChild(panel);
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));

    panel.querySelector<HTMLElement>("#last")!.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(panel.querySelector("#first"));

    panel.querySelector<HTMLElement>("#first")!.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(panel.querySelector("#last"));
  });

  it("does nothing when not open", () => {
    const panel = makePanel();
    const onCancel = vi.fn();
    renderHook(() => useModalFocusTrap({ current: panel }, false, onCancel));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("defers Escape to a nested SearchableSelect-style picker instead of closing the modal (bot review finding, #755)", () => {
    // This hook's own Escape handler runs on the capture phase (see below); a picker built on
    // useDropdownMenu handles its Escape on the bubble phase, which always fires after capture -
    // without the isAnyDropdownMenuOpen() guard this hook would always win that race and close
    // the whole modal (or open its discard-confirmation) while the picker stayed open on top of
    // it. Real nesting: a modal panel containing a SearchableSelect-shaped trigger+panel, both
    // wired through the same document-level listeners the real components use.
    function ModalWithNestedPicker({ onCancel }: { onCancel: () => void }) {
      const panelRef = useRef<HTMLDivElement>(null);
      useModalFocusTrap(panelRef, true, onCancel);
      const {
        open,
        setOpen,
        close,
        rootRef,
        triggerRef,
        panelRef: pickerPanelRef,
      } = useDropdownMenu<HTMLButtonElement>();
      return (
        <div ref={panelRef}>
          <div ref={rootRef}>
            <button ref={triggerRef} onClick={() => setOpen((o) => !o)}>
              Open picker
            </button>
            {open && (
              <div ref={pickerPanelRef} data-testid="picker-panel">
                <button onClick={() => close()}>Option</button>
              </div>
            )}
          </div>
        </div>
      );
    }

    const onCancel = vi.fn();
    render(<ModalWithNestedPicker onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Open picker" }));
    expect(screen.getByTestId("picker-panel")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    // The picker closed itself; the modal never saw a "cancel".
    expect(screen.queryByTestId("picker-panel")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();

    // With no picker open, Escape reaches the modal trap normally again.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("useModalFocusTrap focusWhenReady", () => {
  it("re-attempts initial focus once async content becomes ready, instead of only trying once at mount when nothing was focusable yet", () => {
    // Regression test: a panel that mounts before its real content has loaded (e.g. an
    // always-routed editor showing a spinner first) found nothing focusable at mount and
    // never tried again — passing the value that flips once content exists as `focusWhenReady`
    // must make the hook re-attempt focus then.
    let triggerReady: (() => void) | null = null;

    function AsyncPanel() {
      const panelRef = useRef<HTMLDivElement>(null);
      const [ready, setReady] = useState(false);
      useModalFocusTrap(panelRef, true, vi.fn(), ready);
      triggerReady = () => setReady(true);
      return (
        <div ref={panelRef}>
          {ready ? <button id="real">Real content</button> : <span>Loading…</span>}
        </div>
      );
    }

    render(<AsyncPanel />);
    expect(document.activeElement).not.toBe(document.querySelector("#real"));

    act(() => {
      triggerReady?.();
    });

    expect(document.activeElement).toBe(document.querySelector("#real"));
  });

  it("still only focuses once at mount when focusWhenReady is omitted (existing callers unaffected)", () => {
    const panel = makePanel();
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));

    expect(document.activeElement).toBe(panel.querySelector("#first"));
  });
});
