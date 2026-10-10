import type { ComponentType, ReactNode } from "react";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import type { ReportFetch } from "../hooks/useReportFetch.js";
import { assertPresent } from "../utils/assert-present.js";
import type { TabSkeletonProps } from "./tabSkeletons.js";

/** The region a report tab sits in, whatever its read is doing: where the focus goes when a Retry that held it works. */
const REPORT_TAB_REGION = ".reports-tab";

/**
 * A lazily loaded Reports tab (Wallets, Mail, Custom fields): a `<section aria-label>` that stays, holding one of the
 * placeholder (`placeholder`, invisible for the first 200ms), the error with a Retry that is busy while it works, or the report
 * (`children`, given what the read answered). The tab stays mounted underneath the other tabs once it has been visited, so
 * its read runs once and its answer is kept.
 */
export function ReportTab<T>({
  label,
  errorTitle,
  load,
  placeholder: Placeholder,
  children,
}: Readonly<{
  label: string;
  errorTitle: string;
  load: ReportFetch<T>;
  placeholder: ComponentType<TabSkeletonProps>;
  children: (data: T) => ReactNode;
}>) {
  const { data, view, panel, accessDenied } = load;
  let body: ReactNode;
  if (view === "loading") {
    body = <Placeholder held={!panel.gate.showIndicator} slow={panel.slow} />;
  } else if (view === "error") {
    assertPresent(panel.error);
    body = (
      <RetryEmptyState
        title={errorTitle}
        message={accessDenied ? "You do not have access to this event." : panel.error}
        retrying={panel.retrying}
        onRetry={panel.retry}
        landmark={REPORT_TAB_REGION}
      />
    );
  } else {
    assertPresent(data);
    // What replaces the placeholder fades in; the wrapper is a column of its own with the section's rhythm.
    body = <div className="reports-tab__report at-fade-in">{children(data)}</div>;
  }
  return (
    <section className="reports-tab" aria-label={label}>
      {body}
    </section>
  );
}
