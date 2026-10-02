import { useLayoutEffect, type RefObject } from "react";

/**
 * When the Retry of a failed load works, the error that holds it goes and the content takes its place: focus that was
 * on the Retry then moves to the tab panel the error sat in (a browser would drop it on `<body>`), so a screen reader
 * hears where it is and the next Tab goes into the content. Focus that is somewhere else by then, or that was never on
 * the Retry, is left alone. Pass the ref of the Retry button.
 */
export function useRetryFocusHandover(retryRef: RefObject<HTMLButtonElement | null>): void {
  useLayoutEffect(() => {
    const retry = retryRef.current;
    // React runs this cleanup before it takes the error out of the page, so the Retry still holds focus (and has its
    // tab panel above it) here; by the time the microtask runs the content is in and the Retry is gone.
    return () => {
      if (!retry || document.activeElement !== retry) return;
      const tabPanel = retry.closest<HTMLElement>('[role="tabpanel"]');
      if (!tabPanel) return;
      queueMicrotask(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        if (!tabPanel.hasAttribute("tabindex")) tabPanel.tabIndex = -1;
        tabPanel.focus();
      });
    };
  }, [retryRef]);
}
