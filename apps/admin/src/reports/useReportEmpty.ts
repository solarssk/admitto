import { useEffect } from "react";

/** Tells the Reports page whether the tab that holds this report has anything to export, so the page can switch its
 * Export report button off with a reason. The page never sees a lazy tab's data, only this answer. */
export function useReportEmpty(onEmptyChange: ((empty: boolean) => void) | undefined, empty: boolean): void {
  useEffect(() => {
    onEmptyChange?.(empty);
  }, [onEmptyChange, empty]);
}
