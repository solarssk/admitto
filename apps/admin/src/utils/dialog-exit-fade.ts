/** How long a dialog that has just closed takes to fade away. A little shorter than it takes to come in (150ms): a
 * person who has decided is waiting for the page, not for the dialog. */
const EXIT_MS = 120;

/** Set on the copy, so that removing the copy is not taken for a dialog closing (which would copy it again, for ever). */
const COPY_MARK = "data-dialog-exit-copy";

/**
 * Every dialog here is taken out of the page the moment it closes, so CSS has nothing left to animate. This watches for
 * a `<dialog>` that has just been removed and leaves a still copy of it behind for `EXIT_MS`, fading out: the dimmed
 * backdrop and the panel, which also sinks a few pixels. The copy cannot be reached (inert, no ids, no pointer events),
 * so it never takes focus or a click from the page underneath, and it is not announced twice.
 *
 * Skipped where there is nothing to play it with (jsdom has no Web Animations) and under `prefers-reduced-motion`.
 */
export function installDialogExitFade(): () => void {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (node instanceof HTMLDialogElement && node.hasAttribute("open") && !node.hasAttribute(COPY_MARK)) {
          fadeOutCopy(node, record.target);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function fadeOutCopy(dialog: HTMLDialogElement, parent: Node): void {
  if (!(parent instanceof Element) || !parent.isConnected) return;
  if (typeof dialog.animate !== "function") return;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const copy = dialog.cloneNode(true) as HTMLDialogElement;
  copy.setAttribute(COPY_MARK, "");
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  copy.removeAttribute("id");
  for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
  copy.style.pointerEvents = "none";
  // The entrance animations in loader.css would play again on a node that is newly in the page.
  copy.style.animation = "none";
  for (const el of copy.querySelectorAll<HTMLElement>("*")) el.style.animation = "none";
  parent.append(copy);

  const panel = [...copy.children].find((el) => !/backdrop/.test(el.className));
  panel?.animate(
    [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: "translateY(6px)" },
    ],
    { duration: EXIT_MS, easing: "ease-in", fill: "forwards" },
  );
  const fade = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: EXIT_MS, easing: "ease-in", fill: "forwards" });
  const done = () => copy.remove();
  fade.addEventListener("finish", done);
  fade.addEventListener("cancel", done);
}
