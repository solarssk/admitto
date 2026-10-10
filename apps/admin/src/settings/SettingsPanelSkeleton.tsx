import type { ReactNode } from "react";
import { Card, Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";

export interface SettingsSkeletonCard {
  id: string;
  /** The card's real title: it is known before the data is. */
  title: ReactNode;
  /** The card opens with intro text: `true` is one line, a number is that many (a long intro wraps). */
  intro?: boolean | number;
  /** How many labelled fields the card holds (a label and a control each). */
  fields?: number;
  /** Fields side by side (2, as `.mail-transport-section` does on a wide screen) or one under the other (1, the default). */
  columns?: 1 | 2;
  /** The height of a field's control, to match fields with a hint or a text area under the label (38 by default). */
  controlHeight?: number;
  /** Full-width rows of the given height (switches, numeric settings with a description), after the fields. */
  rows?: number;
  rowHeight?: number;
}

interface SettingsPanelSkeletonProps {
  /** What is loading ("Loading organisation settings"): the region's accessible name. The shapes are decoration. */
  label: string;
  /** Not painted yet (the first 200ms): the space is in the page, nothing is drawn. */
  held: boolean;
  /** After 8 seconds the region says it is taking longer than usual. */
  slow: boolean;
  cards: ReadonlyArray<SettingsSkeletonCard>;
  /** The Reset and Save footer of a form panel (on by default). */
  footer?: boolean;
}

/** The intro text of a card: a line of text is about 21px, so lines of 16px with 5px between them keep that pitch. */
function SkeletonIntro({ lines }: Readonly<{ lines: number }>) {
  if (lines <= 1) return <Skeleton variant="rect" width="62%" height={16} />;
  return (
    <div className="settings-skeleton__intro">
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton key={line} variant="rect" width={line === lines - 1 ? "62%" : "100%"} height={16} />
      ))}
    </div>
  );
}

/** One of a panel's cards as grey shapes. Decoration (the region around it is named by its label): hidden from assistive tech,
 * so that the region does not read the titles out again when the 8 second note joins it, or when another tab's cards take
 * their place. */
export function SettingsSkeletonCardView({ card }: Readonly<{ card: SettingsSkeletonCard }>) {
  const fields = card.fields ?? 0;
  return (
    <Card title={card.title} aria-hidden="true">
      <div className="settings-card-stack" aria-hidden="true">
        {card.intro && <SkeletonIntro lines={card.intro === true ? 1 : card.intro} />}
        {fields > 0 && (
          <div className={card.columns === 2 ? "settings-skeleton__fields mail-transport-section" : "settings-skeleton__fields"}>
            {Array.from({ length: fields }, (_, fieldIndex) => (
              <div key={fieldIndex} className="settings-skeleton__field">
                <Skeleton variant="rect" width="28%" height={17} />
                <Skeleton variant="rect" height={card.controlHeight ?? 38} />
              </div>
            ))}
          </div>
        )}
        {Array.from({ length: card.rows ?? 0 }, (_, rowIndex) => (
          <Skeleton key={rowIndex} variant="rect" height={card.rowHeight ?? 60} />
        ))}
      </div>
    </Card>
  );
}

/** The status region that a panel's placeholder is in, named after what is loading, with the 8 second note at its end. A
 * layout that is not a plain stack of cards (cards side by side) puts its own children in it. */
export function SettingsSkeletonRegion({
  label,
  held,
  slow,
  children,
}: Readonly<{ label: string; held: boolean; slow: boolean; children: ReactNode }>) {
  return (
    <output aria-label={label} className={held ? "settings-skeleton at-loading-hold" : "settings-skeleton"}>
      {children}
      {slow ? (
        <span className="at-hint" style={{ display: "block", textAlign: "center", color: "var(--text-secondary)" }}>
          {SLOW_NOTICE_TEXT}
        </span>
      ) : null}
    </output>
  );
}

/**
 * A settings panel while it loads: its cards with their real titles, a label and a control per field, and the footer
 * of buttons, in a status region named after what is loading. Cards stack with the same gap as the real panel, so the
 * form that replaces it does not move what is below it by much.
 */
export function SettingsPanelSkeleton({ label, held, slow, cards, footer = true }: Readonly<SettingsPanelSkeletonProps>) {
  return (
    <SettingsSkeletonRegion label={label} held={held} slow={slow}>
      {cards.map((card) => (
        <SettingsSkeletonCardView key={card.id} card={card} />
      ))}
      {footer && (
        <div className="settings-footer settings-skeleton__footer" aria-hidden="true">
          <div className="settings-footer__buttons">
            <Skeleton variant="rect" width={72} height={38} />
            <Skeleton variant="rect" width={72} height={38} />
          </div>
        </div>
      )}
    </SettingsSkeletonRegion>
  );
}
