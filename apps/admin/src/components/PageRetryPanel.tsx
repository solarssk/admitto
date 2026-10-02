import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * The tab panel that holds the error of a failed first load of a whole page. It notes, into `errorHadFocusRef`, whether the
 * focus was inside it when it goes (React runs this cleanup before it takes the panel out of the page, so a focused Retry is
 * still focused here): `useFocusAfterPageRetry` hands the focus on only when it was.
 */
export function PageRetryPanel({
  label,
  errorHadFocusRef,
  className,
  children,
}: Readonly<{ label: string; errorHadFocusRef: RefObject<boolean>; className?: string; children: ReactNode }>) {
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    return () => {
      errorHadFocusRef.current = Boolean(panel?.contains(document.activeElement));
    };
  }, [errorHadFocusRef]);
  return (
    <div ref={panelRef} role="tabpanel" aria-label={label} className={className}>
      {children}
    </div>
  );
}
