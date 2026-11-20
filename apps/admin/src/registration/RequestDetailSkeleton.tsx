import { Skeleton } from "@admitto/ui";
import { DeliveryModalSkeletonRegion, KeyValueSection } from "../communication/DeliveryModalSkeleton.js";
import "../communication/delivery-modals.css";
import "./request-detail.css";

/** The pairs the real "Request" section has for a request with a company and a department: its state, when it was sent, the company, the department, the address check, the terms and the decision. */
export const REQUEST_PAIRS = 7;
/** The height of one email of the history, measured in Chrome against the real one (the window of a request that waits for a decision has one email). */
export const REQUEST_MAIL_HEIGHT = 70.5;

/**
 * The body of a request's window while the request loads: the sections it will have, with their real titles, over grey shapes as tall as
 * what they stand in for, in a status region named after what is loading. `held` is the first 200ms, when the room is reserved and
 * nothing is drawn; after 8 seconds (`slow`) the region says it is taking longer than usual. The window's own header, with the guest
 * and the decisions that need nothing from the record, is on screen from the first frame.
 */
export function RequestDetailSkeleton({ held, slow }: Readonly<{ held: boolean; slow: boolean }>) {
  return (
    <DeliveryModalSkeletonRegion label="Loading request" held={held} slow={slow}>
      <KeyValueSection title="Request" pairs={REQUEST_PAIRS} gridClassName="request-detail__grid" />
      <div aria-hidden="true">
        <h3 className="delivery-modal__section-title">Emails</h3>
        <div className="request-detail__mails">
          <Skeleton variant="rect" height={REQUEST_MAIL_HEIGHT} />
        </div>
      </div>
    </DeliveryModalSkeletonRegion>
  );
}
