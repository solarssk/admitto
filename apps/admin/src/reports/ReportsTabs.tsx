import { memo } from "react";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import { fetchEventCustomFieldReports, fetchEventMailReports, fetchEventWalletReports } from "../api/client.js";
import { useReportFetch } from "../hooks/useReportFetch.js";
import { ReportTab } from "./ReportTab.js";
import { CustomFieldsReportsSkeleton, MailReportsSkeleton, WalletsReportsSkeleton } from "./tabSkeletons.js";

// The Wallets, Custom fields and Mail tabs of Reports. Each report itself (pages/WalletsReportsTab.tsx and its two siblings)
// pulls in Recharts, so it is code-split: Event day (the default tab, with its own hand-rolled CSS bars) does not pay for that
// weight until an operator switches tabs. The code travels together with the report's data, in one read: one wait, with one
// placeholder (the report's own shape, invisible for the first 200ms), one "taking longer than usual" note, one 30 second
// limit and one Retry, instead of a spinner for the code and a placeholder for the data after it. A chunk that fails to
// load is a failed read like any other (the error says what could not be loaded, with a Retry).
//
// Each tab is memoized and kept mounted once visited: ReportsPage re-renders on every live check-in (Event Day's SSE feed),
// and a tab stays mounted underneath even while Event Day is the visible one - without memo, each of those unrelated
// re-renders reconstructed fresh chart data/config objects and made every chart replay its entrance animation for no reason
// (a periodic "jump" with no data actually changing). `eventId` is stable for a tab's whole mounted lifetime (the page is
// keyed by it); `walletPlatforms` must stay reference-stable across those same re-renders too (ReportsPage memoizes it), or
// every SSE-driven re-render would defeat the memo exactly the way an unmemoized `eventId` would. `isActive` (whether this is
// the visible tab) changes on a tab switch and re-renders the tab: each chart only mounts its ResponsiveContainer while it is
// true, so its ResizeObserver stops watching a box that collapsed to 0x0 under display:none (see ReportsDonutChart in
// pages/reports-charts.tsx).

function readWalletReport(eventId: string, signal?: AbortSignal) {
  return Promise.all([fetchEventWalletReports(eventId, signal), import("../pages/WalletsReportsTab.js")]);
}

function readCustomFieldReport(eventId: string, signal?: AbortSignal) {
  return Promise.all([fetchEventCustomFieldReports(eventId, signal), import("../pages/CustomFieldsReportsTab.js")]);
}

function readMailReport(eventId: string, signal?: AbortSignal) {
  return Promise.all([fetchEventMailReports(eventId, signal), import("../pages/MailReportsTab.js")]);
}

export const WalletsReportsTab = memo(function WalletsReportsTab({
  eventId,
  walletPlatforms,
  isActive,
}: Readonly<{ eventId: string; walletPlatforms: EnabledWalletPlatforms; isActive: boolean }>) {
  const load = useReportFetch(readWalletReport, eventId, "Could not load wallet report.");
  return (
    <ReportTab label="Wallet report" errorTitle="Could not load wallet report" load={load} placeholder={WalletsReportsSkeleton}>
      {([report, { WalletsReport }]) => <WalletsReport data={report} walletPlatforms={walletPlatforms} isActive={isActive} />}
    </ReportTab>
  );
});

export const CustomFieldsReportsTab = memo(function CustomFieldsReportsTab({
  eventId,
  isActive,
}: Readonly<{ eventId: string; isActive: boolean }>) {
  const load = useReportFetch(readCustomFieldReport, eventId, "Could not load custom field report.");
  return (
    <ReportTab
      label="Custom field report"
      errorTitle="Could not load custom field report"
      load={load}
      placeholder={CustomFieldsReportsSkeleton}
    >
      {([report, { CustomFieldsReport }]) => <CustomFieldsReport data={report} isActive={isActive} />}
    </ReportTab>
  );
});

export const MailReportsTab = memo(function MailReportsTab({
  eventId,
  isActive,
}: Readonly<{ eventId: string; isActive: boolean }>) {
  const load = useReportFetch(readMailReport, eventId, "Could not load mail report.");
  return (
    <ReportTab label="Mail report" errorTitle="Could not load mail report" load={load} placeholder={MailReportsSkeleton}>
      {([report, { MailReport }]) => <MailReport data={report} isActive={isActive} />}
    </ReportTab>
  );
});
