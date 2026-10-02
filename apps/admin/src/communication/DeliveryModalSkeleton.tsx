import type { ReactNode } from "react";
import { Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import "./delivery-modals.css";

/**
 * The body of a delivery modal while the record it shows loads: shapes in a status region named after what is loading
 * ("Loading delivery details"). `held` is the first 200ms, when the room is reserved and nothing is drawn, and after 8
 * seconds (`slow`) the region says it is taking longer than usual. The modal's own header, with its title and the
 * recipient, is on screen from the first frame.
 */
function DeliveryModalSkeletonRegion({
  label,
  held,
  slow,
  children,
}: Readonly<{ label: string; held: boolean; slow: boolean; children: ReactNode }>) {
  return (
    <output aria-label={label} className={held ? "delivery-modal-skeleton-group at-loading-hold" : "delivery-modal-skeleton-group"}>
      {children}
      {slow ? <span className="at-hint delivery-modal-skeleton-note">{SLOW_NOTICE_TEXT}</span> : null}
    </output>
  );
}

/** How many label and value pairs the real details modal has in each of its sections (a test holds the modal to these). */
export const OVERVIEW_PAIRS = 12;
export const RAW_FIELD_PAIRS = 6;

/** One section of the details modal: its real title, and a grid of label and value pairs as tall as the real ones. */
function KeyValueSection({ title, pairs, notice = false }: Readonly<{ title: string; pairs: number; notice?: boolean }>) {
  return (
    <div aria-hidden="true">
      <h3 className="delivery-modal__section-title">{title}</h3>
      <div className="delivery-modal-kv delivery-modal-kv--skeleton">
        {Array.from({ length: pairs }, (_, pair) => (
          <div key={pair} className="delivery-modal-skeleton-pair">
            <span className="delivery-modal-skeleton-line delivery-modal-skeleton-line--label">
              <Skeleton variant="rect" width="38%" height={10} />
            </span>
            <span className="delivery-modal-skeleton-line">
              <Skeleton variant="rect" width={pair % 2 === 0 ? "72%" : "54%"} height={13} />
            </span>
          </div>
        ))}
      </div>
      {notice ? <Skeleton variant="rect" height={37.5} className="delivery-modal-skeleton-notice" /> : null}
    </div>
  );
}

/** The Overview and Raw fields sections of `DeliveryDetailsModal`: twelve pairs and the outcome line, then six pairs. */
export function DeliveryDetailsSkeleton({ held, slow }: Readonly<{ held: boolean; slow: boolean }>) {
  return (
    <DeliveryModalSkeletonRegion label="Loading delivery details" held={held} slow={slow}>
      <KeyValueSection title="Overview" pairs={OVERVIEW_PAIRS} notice />
      <KeyValueSection title="Raw fields" pairs={RAW_FIELD_PAIRS} />
    </DeliveryModalSkeletonRegion>
  );
}

/** The subject line and the message frame of `SentMessagePreviewModal`. */
export function SentMessageSkeleton({ held, slow }: Readonly<{ held: boolean; slow: boolean }>) {
  return (
    <DeliveryModalSkeletonRegion label="Loading sent message" held={held} slow={slow}>
      <div className="delivery-modal-preview-subject">
        <span className="delivery-modal-skeleton-line delivery-modal-skeleton-subject-label">
          <Skeleton variant="rect" width="14%" height={13} />
        </span>
        <span className="delivery-modal-skeleton-line">
          <Skeleton variant="rect" width="52%" height={13} />
        </span>
      </div>
      <Skeleton variant="rect" height={320} className="delivery-modal-skeleton-frame" />
    </DeliveryModalSkeletonRegion>
  );
}
