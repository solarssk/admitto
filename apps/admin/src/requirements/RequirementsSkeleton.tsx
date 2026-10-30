import { Card, Skeleton } from "@admitto/ui";
import { SettingsSkeletonRegion } from "../settings/SettingsPanelSkeleton.js";
import "./requirements.css";

/** How many rows each table draws: the first read does not know how many items or fields the event has. */
const ITEM_ROWS = 3;
const FIELD_ROWS = 2;

/** One row of a Requirements table as grey shapes, in the real row's cells (the row's height is the stylesheet's, not the
 * shapes'): an icon and a name, the description, the Active switch or the Required answer, and the row's buttons. */
function PlaceholderRow({ buttons, status, formColumn }: Readonly<{ buttons: number; status: "switch" | "text"; formColumn: boolean }>) {
  return (
    <tr>
      <td>
        <div className="requirements-item-cell">
          <Skeleton variant="circle" width={20} height={20} />
          <Skeleton variant="rect" width={120} height={16} />
        </div>
      </td>
      <td className="requirements-item-desc-col">
        <Skeleton variant="rect" width="70%" height={14} />
      </td>
      <td className="requirements-item-status-col">
        <div className="requirements-status-cell">
          {status === "switch" ? <Skeleton variant="rect" width={64} height={22} /> : <Skeleton variant="rect" width={28} height={14} />}
        </div>
      </td>
      {formColumn ? (
        <td className="requirements-item-form-col">
          <div className="requirements-status-cell">
            <Skeleton variant="rect" width={36} height={20} />
          </div>
        </td>
      ) : null}
      <td className="requirements-item-actions">
        <div className="requirements-item-actions__wrap">
          {Array.from({ length: buttons }, (_, button) => (
            <Skeleton key={button} variant="rect" width={28} height={28} />
          ))}
        </div>
      </td>
    </tr>
  );
}

/** A table card of the page, by its real title and column headings: the card's own button is a grey shape, since there is
 * nothing to add to before the read has answered. */
function PlaceholderCard({
  title,
  action,
  headings,
  formHeading,
  rows,
  buttons,
  status,
}: Readonly<{
  title: string;
  action: number;
  headings: readonly [string, string, string];
  /** The heading of the "On the form" column that the Registration page's card has after the others. */
  formHeading?: string;
  rows: number;
  buttons: number;
  status: "switch" | "text";
}>) {
  return (
    <section className={formHeading ? "requirements-section requirements-section--registration" : "requirements-section"}>
      <Card padded={false} title={title} actions={<Skeleton variant="rect" width={action} height={32} />}>
        <div className="attendees-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{headings[0]}</th>
                <th className="requirements-item-desc-col">{headings[1]}</th>
                <th className="requirements-item-status-col">{headings[2]}</th>
                {formHeading ? <th className="requirements-item-form-col">{formHeading}</th> : null}
                <th className="requirements-item-actions" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, row) => (
                <PlaceholderRow key={row} buttons={buttons} status={status} formColumn={Boolean(formHeading)} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

/**
 * The Requirements page below its header while its first read is on its way: the Event items card with its real title and
 * column headings over a few rows of grey shapes, in a status region named after what is loading (invisible for the first
 * 200ms, with the 8 second note). Decoration, so hidden from assistive tech.
 */
export function RequirementsSkeleton({ held, slow }: Readonly<{ held: boolean; slow: boolean }>) {
  return (
    <SettingsSkeletonRegion label="Loading requirements" held={held} slow={slow}>
      <div aria-hidden="true">
        <PlaceholderCard title="Event items" action={64} headings={["Item", "Description", "Active"]} rows={ITEM_ROWS} buttons={1} status="switch" />
      </div>
    </SettingsSkeletonRegion>
  );
}

/**
 * The Registration page's Fields tab while its first read is on its way: the Attendee fields card with its real title and
 * column headings, the "On the form" one included, over a few rows of grey shapes (invisible for the first 200ms, with the
 * 8 second note). The rows have the four buttons that the real ones have, the two arrows and Edit and Delete.
 */
export function RegistrationFieldsSkeleton({ held, slow }: Readonly<{ held: boolean; slow: boolean }>) {
  return (
    <SettingsSkeletonRegion label="Loading attendee fields" held={held} slow={slow}>
      <div aria-hidden="true">
        <PlaceholderCard
          title="Attendee fields"
          action={104}
          headings={["Field", "Description", "Required"]}
          formHeading="On the form"
          rows={FIELD_ROWS}
          buttons={4}
          status="text"
        />
      </div>
    </SettingsSkeletonRegion>
  );
}
