// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModalFocusTrap } from "../../src/components/useModalFocusTrap.js";

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

  it("does nothing when not open", () => {
    const panel = makePanel();
    const onCancel = vi.fn();
    renderHook(() => useModalFocusTrap({ current: panel }, false, onCancel));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).not.toHaveBeenCalled();
  });
});
