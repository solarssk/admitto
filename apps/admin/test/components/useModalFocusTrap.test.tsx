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

describe("useModalFocusTrap when the control that holds focus is removed", () => {
  /** A form with a notice above it, like a dialog whose Retry notice goes away once the retry worked. */
  function makePanelWithNotice(): HTMLDivElement {
    const panel = document.createElement("div");
    panel.innerHTML = `
      <div id="notice"><button id="retry">Retry</button></div>
      <input id="field" />
      <button id="save">Save</button>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  /** The browser drops focus on <body> when the focused element is removed, and so does jsdom. A
   * MutationObserver callback is a microtask, so let it run. */
  const settle = () => act(async () => {});

  it("moves focus to the first control instead of leaving it on <body>", async () => {
    const panel = makePanelWithNotice();
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));
    const retry = panel.querySelector<HTMLElement>("#retry")!;
    retry.focus();
    expect(document.activeElement).toBe(retry);

    panel.querySelector("#notice")!.remove();
    expect(document.activeElement).toBe(document.body);
    await settle();

    expect(document.activeElement).toBe(panel.querySelector("#field"));
  });

  it("keeps Tab inside the dialog afterwards, wrapping from the last control", async () => {
    const panel = makePanelWithNotice();
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));
    panel.querySelector<HTMLElement>("#retry")!.focus();
    panel.querySelector("#notice")!.remove();
    await settle();

    panel.querySelector<HTMLElement>("#save")!.focus();
    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(panel.querySelector("#field"));
  });

  it("follows focus: it is the control focused last that counts, not the one focused when the dialog opened", async () => {
    const panel = document.createElement("div");
    panel.innerHTML = `<input id="field" /><div id="later-wrap"><button id="later">Later</button></div>`;
    document.body.appendChild(panel);
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));
    expect(document.activeElement).toBe(panel.querySelector("#field"));
    panel.querySelector<HTMLElement>("#later")!.focus();

    panel.querySelector("#later-wrap")!.remove();
    await settle();

    expect(document.activeElement).toBe(panel.querySelector("#field"));
  });

  it("falls back to the panel itself when nothing left in it can take focus", async () => {
    const panel = document.createElement("div");
    panel.innerHTML = `<div id="notice"><button id="retry">Retry</button></div><p>Nothing to press here.</p>`;
    document.body.appendChild(panel);
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));
    panel.querySelector<HTMLElement>("#retry")!.focus();

    panel.querySelector("#notice")!.remove();
    await settle();

    expect(document.activeElement).toBe(panel);
    expect(panel.getAttribute("tabindex")).toBe("-1");
  });

  it("leaves focus alone when it already moved to another element, such as a nested dialog", async () => {
    const panel = makePanelWithNotice();
    const nested = document.createElement("button");
    document.body.appendChild(nested);
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));
    panel.querySelector<HTMLElement>("#retry")!.focus();
    nested.focus();

    panel.querySelector("#notice")!.remove();
    await settle();

    expect(document.activeElement).toBe(nested);
  });

  it("leaves a control alone that is only disabled while it works, instead of pulling focus away from it", async () => {
    const panel = makePanelWithNotice();
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));
    const retry = panel.querySelector<HTMLButtonElement>("#retry")!;
    retry.focus();
    // What Chrome does to a focused button that becomes disabled: focus falls to <body>, the button stays.
    // (jsdom cannot blur a disabled element, so drop the focus first.)
    retry.blur();
    retry.disabled = true;

    panel.appendChild(document.createElement("span"));
    await settle();

    expect(document.activeElement).toBe(document.body);
    expect(retry.isConnected).toBe(true);
  });

  it("does not take focus when nothing in the panel ever held it", async () => {
    // A panel with nothing to focus yet, e.g. one still showing its loader.
    const panel = document.createElement("div");
    panel.innerHTML = `<p>Loading</p>`;
    document.body.appendChild(panel);
    renderHook(() => useModalFocusTrap({ current: panel }, true, vi.fn()));
    const late = document.createElement("button");
    panel.appendChild(late);
    await settle();

    late.remove();
    await settle();

    expect(document.activeElement).toBe(document.body);
  });

  it("does nothing while the trap is not open", async () => {
    const panel = makePanelWithNotice();
    renderHook(() => useModalFocusTrap({ current: panel }, false, vi.fn()));
    panel.querySelector<HTMLElement>("#retry")!.focus();

    panel.querySelector("#notice")!.remove();
    await settle();

    expect(document.activeElement).toBe(document.body);
  });

  it("stops watching once the dialog is closed", async () => {
    const panel = makePanelWithNotice();
    const { rerender } = renderHook(({ open }) => useModalFocusTrap({ current: panel }, open, vi.fn()), {
      initialProps: { open: true },
    });
    panel.querySelector<HTMLElement>("#retry")!.focus();
    rerender({ open: false });

    panel.querySelector("#notice")!.remove();
    await settle();

    expect(document.activeElement).toBe(document.body);
  });
});
