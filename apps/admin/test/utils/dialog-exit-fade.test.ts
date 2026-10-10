// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDialogExitFade } from "../../src/utils/dialog-exit-fade.js";

type Anim = { addEventListener: (type: string, fn: () => void) => void; finish: () => void };

/** jsdom has no Web Animations: a stand-in whose `finish` runs the listeners. */
function fakeAnimate() {
  const animations: Anim[] = [];
  const animate = vi.fn(function animate() {
    const listeners: Record<string, Array<() => void>> = {};
    const anim: Anim = {
      addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
      finish: () => listeners.finish?.forEach((fn) => fn()),
    };
    animations.push(anim);
    return anim;
  });
  return { animate, animations };
}

function addDialog(parent: HTMLElement) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  dialog.id = "d1";
  dialog.innerHTML = '<div class="at-modal-backdrop"></div><div class="panel" id="p1"><button>Cancel</button></div>';
  parent.append(dialog);
  return dialog;
}

describe("installDialogExitFade", () => {
  let stop: () => void;
  let fake: ReturnType<typeof fakeAnimate>;

  beforeEach(() => {
    fake = fakeAnimate();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = fake.animate;
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    stop = installDialogExitFade();
  });

  afterEach(() => {
    stop();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("leaves an unreachable copy behind while a dialog that has closed fades out, and removes it when the fade ends", async () => {
    const dialog = addDialog(document.body);
    dialog.remove();
    await Promise.resolve();

    const copy = document.querySelector<HTMLDialogElement>("dialog");
    expect(copy).not.toBeNull();
    expect(copy?.inert).toBe(true);
    expect(copy?.getAttribute("aria-hidden")).toBe("true");
    expect(copy?.style.pointerEvents).toBe("none");
    expect(copy?.querySelectorAll("[id]")).toHaveLength(0);
    expect(fake.animate).toHaveBeenCalledTimes(2);

    for (const anim of fake.animations) anim.finish();
    await Promise.resolve();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("does not copy the copy when it is removed", async () => {
    addDialog(document.body).remove();
    await Promise.resolve();
    for (const anim of fake.animations) anim.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("dialog")).toBeNull();
    expect(fake.animate).toHaveBeenCalledTimes(2);
  });

  it("does nothing for reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    addDialog(document.body).remove();
    await Promise.resolve();
    expect(document.querySelector("dialog")).toBeNull();
    expect(fake.animate).not.toHaveBeenCalled();
  });

  it("does nothing where the browser cannot animate", async () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    addDialog(document.body).remove();
    await Promise.resolve();
    expect(document.querySelector("dialog")).toBeNull();
  });
});
