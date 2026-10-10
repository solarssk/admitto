import { useEffect, useRef, type RefObject } from "react";

/**
 * The error of a failed first load of a whole page is replaced by the page when a Retry works (or by another state, such as
 * "Event not found"), so the tab panel that `PanelLoadError` would hand the focus to is gone with it. Once the page is
 * there, the focus that was on the Retry (a browser drops it on `<body>`) goes to the first of `targets` (selectors, looked up
 * inside `rootRef`) that exists, so a screen reader hears where it is and the next Tab goes on from there. Focus that was never
 * in the error (`errorHadFocusRef`, set by `PageRetryPanel`: a mouse click does not focus a button in every browser, and the
 * viewer may have moved to a tab), or is anywhere else by then, is left alone. An element that is not focusable by itself (a
 * tab panel) is given `tabindex="-1"`.
 */
export function useFocusAfterPageRetry(
  failed: boolean,
  settled: boolean,
  rootRef: RefObject<HTMLElement | null>,
  errorHadFocusRef: RefObject<boolean>,
  targets: readonly string[],
): void {
  const wasFailed = useRef(false);
  useEffect(() => {
    if (failed) {
      wasFailed.current = true;
      return;
    }
    if (!settled || !wasFailed.current) return;
    wasFailed.current = false;
    const hadFocus = errorHadFocusRef.current;
    errorHadFocusRef.current = false;
    // Only focus that went with the error and is on nothing now (a browser drops it on <body>) is handed on.
    const onNothing = !document.activeElement || document.activeElement === document.body;
    if (!hadFocus || !onNothing) return;
    const target = targets.map((selector) => rootRef.current?.querySelector<HTMLElement>(selector)).find(Boolean);
    if (target && !target.hasAttribute("tabindex") && target.getAttribute("role") === "tabpanel") target.tabIndex = -1;
    target?.focus();
  }, [failed, settled, rootRef, errorHadFocusRef, targets]);
}
