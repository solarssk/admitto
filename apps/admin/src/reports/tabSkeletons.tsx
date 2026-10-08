import { ReportTabSkeleton, type ReportCardSpec } from "./ReportTabSkeleton.js";

/** What a tab's placeholder is told: whether it is still invisible, and whether the read is taking longer than usual. */
export interface TabSkeletonProps {
  readonly held: boolean;
  readonly slow: boolean;
}

/** The Wallets tab, in the rows of the real one: the cards' titles and the number of lines of their descriptions are the
 * same for every event, the rows of a breakdown are what a typical event has. */
const WALLETS_ROWS: ReadonlyArray<ReadonlyArray<ReportCardSpec>> = [
  [
    { id: "adoption", title: "Wallet adoption", lines: 3, kind: "donut", rows: 2 },
    { id: "platform", title: "Wallet platform", lines: 2, kind: "donut", rows: 3 },
  ],
  [
    { id: "devices", title: "Devices per attendee", lines: 2, kind: "donut", rows: 4 },
    { id: "by-ticket-type", title: "Adoption by ticket type", lines: 1, kind: "list", rows: 3 },
  ],
  [
    { id: "time-to-install", title: "Time to wallet install", lines: 2, kind: "chart" },
    { id: "after-reminder", title: "Time to install after reminder", lines: 2, kind: "chart" },
  ],
  [
    { id: "validity", title: "Pass validity", lines: 2, kind: "donut", rows: 3 },
    { id: "provider-state", title: "Provider state", lines: 2, kind: "donut", rows: 2 },
  ],
  [
    { id: "registration-state", title: "Registration state (last known)", lines: 2, kind: "donut", rows: 3 },
    { id: "cumulative", title: "Cumulative passes issued", lines: 1, kind: "chart" },
  ],
  [{ id: "admission-rate", title: "Admission rate by wallet status", lines: 2, kind: "compare" }],
];

const MAIL_ROWS: ReadonlyArray<ReadonlyArray<ReportCardSpec>> = [
  [
    { id: "delivery", title: "Email delivery", lines: 2, kind: "donut", rows: 6 },
    { id: "reach", title: "Attendee reach", lines: 2, kind: "donut", rows: 3 },
  ],
  [
    { id: "purpose", title: "Initial vs resend", lines: 1, kind: "list", rows: 2 },
    { id: "template", title: "Delivery by template", lines: 1, kind: "list", rows: 2 },
  ],
  [
    { id: "over-time", title: "Emails sent over time", lines: 1, kind: "chart" },
    { id: "ticket-page", title: "Ticket page opened", lines: 2, kind: "donut", rows: 2 },
  ],
  [
    { id: "admission-rate", title: "Admission rate by email status", lines: 2, kind: "compare" },
    { id: "journey", title: "Event journey", lines: 3, kind: "funnel" },
  ],
];

/** A custom field's name is not known before the read, so its cards show a bar for it; two cards stand for the grid. */
const CUSTOM_FIELD_ROWS: ReadonlyArray<ReadonlyArray<ReportCardSpec>> = [
  [
    { id: "field-1", title: null, lines: 1, kind: "donut", rows: 3 },
    { id: "field-2", title: null, lines: 1, kind: "donut", rows: 3 },
  ],
];

export function WalletsReportsSkeleton({ held, slow }: Readonly<TabSkeletonProps>) {
  return <ReportTabSkeleton label="Loading the wallet report" held={held} slow={slow} rows={WALLETS_ROWS} rowClassName="wallets-panels" />;
}

export function MailReportsSkeleton({ held, slow }: Readonly<TabSkeletonProps>) {
  return <ReportTabSkeleton label="Loading the mail report" held={held} slow={slow} rows={MAIL_ROWS} rowClassName="wallets-panels" />;
}

export function CustomFieldsReportsSkeleton({ held, slow }: Readonly<TabSkeletonProps>) {
  return (
    <ReportTabSkeleton
      label="Loading the custom field report"
      held={held}
      slow={slow}
      rows={CUSTOM_FIELD_ROWS}
      rowClassName="custom-fields-grid"
    />
  );
}
