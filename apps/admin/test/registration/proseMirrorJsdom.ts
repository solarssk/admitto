/**
 * ProseMirror asks the browser where a range is on the page (to scroll the caret into view), which jsdom has no layout to
 * answer. These stand-ins say "nowhere", which is all a test of what the editor writes needs. Call it once, before an
 * editor is made.
 */
export function stubProseMirrorLayout(): void {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) } as DOMRect;
  const rects = Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => rects;
  Element.prototype.getClientRects = () => rects;
  document.elementFromPoint = () => null;
  // `view.pasteHTML` builds a paste event; jsdom has no ClipboardEvent.
  if (typeof globalThis.ClipboardEvent === "undefined") {
    class ClipboardEventStub extends Event {
      readonly clipboardData = null;
    }
    (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = ClipboardEventStub;
  }
}
