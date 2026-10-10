import { Card, Skeleton } from "@admitto/ui";
import { SettingsSkeletonRegion } from "../settings/SettingsPanelSkeleton.js";
import { BreakdownSkeleton } from "./skeletonParts.js";

type ReportCardKind = "donut" | "list" | "chart" | "compare" | "funnel";

interface CardSpecBase {
  /** Names the card among its tab's cards. */
  readonly id: string;
  /** The card's real title, or `null` when it is not known before the read (a custom field's name). */
  readonly title: string | null;
  /** How many lines the card's description takes (text that is the same for every event, which wraps in this many). */
  readonly lines: number;
}

/** A card of a report tab: what it holds is a donut with its breakdown beside or under it, or a list of bars (both with the rows
 * of their breakdown), a chart, the two rings of a comparison, or a stepper of stages. */
export type ReportCardSpec =
  | (CardSpecBase & { readonly kind: "donut" | "list"; readonly rows: number })
  | (CardSpecBase & { readonly kind: "chart" | "compare" | "funnel" });

/** The lines of a card's description, each a bar the height of a line of its text (the bars have margins, as that line has leading). */
function DescriptionSkeleton({ lines }: Readonly<{ lines: number }>) {
  return (
    <p className="wallets-description">
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton key={line} variant="rect" width={line === lines - 1 && lines > 1 ? "62%" : "100%"} height={12} />
      ))}
    </p>
  );
}

/** The ring of a comparison, its label and its figure. */
function CompareGroupSkeleton() {
  return (
    <div className="wallets-compare-group">
      <div className="wallets-compare-ring">
        <div className="wallets-admission-gauge">
          <Skeleton variant="circle" width={180} height={180} />
        </div>
      </div>
      <Skeleton variant="rect" width={96} height={14} />
      <Skeleton variant="rect" width={72} height={12} />
    </div>
  );
}

const FUNNEL_STAGES = 4;

function FunnelSkeleton() {
  return (
    <div className="mail-funnel">
      {Array.from({ length: FUNNEL_STAGES }, (_, stage) => (
        <div key={stage} className="mail-funnel__row">
          <div className="mail-funnel__rail">
            <span className="mail-funnel__dot" aria-hidden="true" />
            <span className="mail-funnel__line" aria-hidden="true" />
          </div>
          <div className="mail-funnel__body">
            <div className="mail-funnel__head">
              <Skeleton variant="rect" width={104} height={14} />
              <Skeleton variant="rect" width={28} height={18} />
            </div>
            <Skeleton variant="rect" width={96} height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CardBody({ spec }: Readonly<{ spec: ReportCardSpec }>) {
  switch (spec.kind) {
    case "donut":
      return (
        <div className="wallets-adoption">
          <div className="wallets-gauge-overlay">
            <Skeleton variant="circle" width="100%" height="100%" />
          </div>
          <div className="wallets-adoption__breakdown">
            <BreakdownSkeleton rows={spec.rows} />
          </div>
        </div>
      );
    case "list":
      return <BreakdownSkeleton rows={spec.rows} />;
    case "chart":
      return (
        <div className="wallets-chart-card__chart">
          <Skeleton variant="rect" width="100%" height="100%" />
        </div>
      );
    case "compare":
      return (
        <div className="wallets-compare">
          <CompareGroupSkeleton />
          <div className="wallets-compare-delta">
            <Skeleton variant="rect" width={72} height={24} />
          </div>
          <CompareGroupSkeleton />
        </div>
      );
    case "funnel":
      return <FunnelSkeleton />;
  }
}

/** The card classes that make a card grow into its row's height, as the real card of that kind does. */
const CARD_CLASS: Record<ReportCardKind, string | undefined> = {
  donut: undefined,
  list: "wallets-list-card",
  chart: "wallets-chart-card",
  compare: "wallets-card--centered",
  funnel: "wallets-card--centered",
};

function ReportCardSkeleton({ spec }: Readonly<{ spec: ReportCardSpec }>) {
  return (
    <Card
      title={spec.title ?? <Skeleton variant="rect" width={140} height={16} />}
      className={CARD_CLASS[spec.kind]}
    >
      <DescriptionSkeleton lines={spec.lines} />
      <CardBody spec={spec} />
    </Card>
  );
}

/**
 * A report tab (Wallets, Mail, Custom fields) while its read is on its way: its cards in the rows of the real tab, with their
 * real titles and the shape of what is in each, in a status region named after what is loading (invisible for the first
 * 200ms, with the 8 second note). Decoration, so hidden from assistive tech, and not clickable.
 */
export function ReportTabSkeleton({
  label,
  held,
  slow,
  rows,
  rowClassName,
}: Readonly<{
  label: string;
  held: boolean;
  slow: boolean;
  rows: ReadonlyArray<ReadonlyArray<ReportCardSpec>>;
  rowClassName: string;
}>) {
  return (
    <SettingsSkeletonRegion label={label} held={held} slow={slow}>
      <div className="reports-tab reports-skeleton" aria-hidden="true">
        {rows.map((cards) => (
          <div key={cards.map((spec) => spec.id).join("+")} className={rowClassName}>
            {cards.map((spec) => (
              <ReportCardSkeleton key={spec.id} spec={spec} />
            ))}
          </div>
        ))}
      </div>
    </SettingsSkeletonRegion>
  );
}
