import { Card, Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";

export interface IdentitySkeletonCard {
  id: string;
  /** The card's real title: it is known before the data is. */
  title: string;
  /** The fields of the card, in reading order: `full` ones take a whole row of the two-column grid, and `hint` is the
   * number of lines of the hint under the control (one by default), which is what sets the field's height. */
  fields: ReadonlyArray<{ full?: boolean; hint?: number }>;
  /** Lines of intro text that open the card (a long one wraps). */
  intro?: number;
  /** Full-width rows after the fields (a list of mappings). */
  rows?: number;
}

interface IdentityEditorSkeletonProps {
  /** What is loading ("Loading Cloudflare Access"): the region's accessible name. The shapes are decoration. */
  label: string;
  /** Not painted yet (the first 200ms): the space is in the modal, nothing is drawn. */
  held: boolean;
  /** After 8 seconds the region says it is taking longer than usual. */
  slow: boolean;
  /** The height of a notice that opens the form (the Cloudflare Access explanation), if it has one. */
  lead?: number;
  cards: ReadonlyArray<IdentitySkeletonCard>;
}

/** The lines of a hint or an intro under or above a control: a line of text is about 18px, so lines of 16px with 2px between. */
function SkeletonLines({ lines }: Readonly<{ lines: number }>) {
  return (
    <div className="identity-skeleton__lines">
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton key={line} variant="rect" width={line === lines - 1 ? "62%" : "100%"} height={16} />
      ))}
    </div>
  );
}

/**
 * An Identity editor (the provider or the Cloudflare Access form) while the record it edits loads: the form's own
 * cards with their real titles, a label, a control and a hint per field, and the row of Cancel, Test and Save
 * buttons, in a status region named after what is loading. The grid and the gaps are the form's, so the form that
 * replaces it does not move the page much.
 */
export function IdentityEditorSkeleton({ label, held, slow, lead, cards }: Readonly<IdentityEditorSkeletonProps>) {
  return (
    <output aria-label={label} className={held ? "identity-editor at-loading-hold" : "identity-editor"}>
      {lead ? (
        <div aria-hidden="true">
          <Skeleton variant="rect" height={lead} />
        </div>
      ) : null}
      {cards.map((card) => (
        <Card key={card.id} title={card.title}>
          <div className="identity-editor__grid" aria-hidden="true">
            {card.intro ? (
              <div style={{ gridColumn: "1 / -1" }}>
                <SkeletonLines lines={card.intro} />
              </div>
            ) : null}
            {card.fields.map((field, index) => (
              <div key={index} className="settings-skeleton__field" style={field.full ? { gridColumn: "1 / -1" } : undefined}>
                <Skeleton variant="rect" width="28%" height={17} />
                <Skeleton variant="rect" height={38} />
                <div className="identity-skeleton__hint">
                  <SkeletonLines lines={field.hint ?? 1} />
                </div>
              </div>
            ))}
            {Array.from({ length: card.rows ?? 0 }, (_, row) => (
              <div key={`row-${row}`} style={{ gridColumn: "1 / -1" }}>
                <Skeleton variant="rect" height={60} />
              </div>
            ))}
          </div>
        </Card>
      ))}
      <div className="identity-editor__actions" aria-hidden="true">
        <Skeleton variant="rect" width={72} height={36} />
        <Skeleton variant="rect" width={140} height={36} />
        <Skeleton variant="rect" width={72} height={36} />
      </div>
      {slow ? (
        <span className="at-hint" style={{ display: "block", textAlign: "center", color: "var(--text-secondary)" }}>
          {SLOW_NOTICE_TEXT}
        </span>
      ) : null}
    </output>
  );
}
