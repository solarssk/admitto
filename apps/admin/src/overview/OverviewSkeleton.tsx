import { Card, Skeleton } from "@admitto/ui";
import { SettingsSkeletonRegion } from "../settings/SettingsPanelSkeleton.js";
import { OverviewKpiTile } from "./OverviewKpiTile.js";

/** The value of a KPI tile that depends on the first read. */
function KpiValue() {
  return <Skeleton variant="rect" width={56} height={22} />;
}

/** The four KPI tiles: their icons and labels are known, and so is the countdown (it comes from the event, not from the
 * read); the three counts are grey bars. */
function KpiRowSkeleton({ countdown }: Readonly<{ countdown: { value: string; label: string } }>) {
  return (
    <div className="overview-stats">
      <OverviewKpiTile tone="primary" icon={<i className="ti ti-users" aria-hidden="true" />} label="Attendees" value={<KpiValue />} />
      <OverviewKpiTile tone="info" icon={<i className="ti ti-mail-check" aria-hidden="true" />} label="Tickets sent" value={<KpiValue />} />
      <OverviewKpiTile
        tone="ok"
        icon={<i className="ti ti-calendar-event" aria-hidden="true" />}
        label={countdown.label}
        value={countdown.value}
      />
      <OverviewKpiTile
        tone="error"
        icon={<i className="ti ti-alert-triangle" aria-hidden="true" />}
        label="Failed delivery"
        value={<KpiValue />}
      />
    </div>
  );
}

function GlanceTileSkeleton() {
  return (
    <div className="overview-glance__tile">
      <Skeleton variant="rect" width={36} height={36} />
      <span className="overview-glance__text">
        <Skeleton variant="rect" width={72} height={12} />
        <Skeleton variant="rect" width={88} height={14} />
      </span>
    </div>
  );
}

/** The ring, the checked-in figure and the two facts under them. */
function CheckInSkeleton() {
  return (
    <Card title="Check-in progress" className="overview-card--header-fixed">
      <div className="overview-checkin">
        <div className="overview-checkin__hero">
          <Skeleton variant="circle" width={136} height={136} />
          <div className="overview-checkin__figure overview-skeleton__lines">
            <Skeleton variant="rect" width={72} height={32} />
            <Skeleton variant="rect" width={88} height={14} />
            <Skeleton variant="rect" width={120} height={14} />
          </div>
        </div>
        <div className="overview-glance">
          <GlanceTileSkeleton />
          <GlanceTileSkeleton />
        </div>
      </div>
    </Card>
  );
}

const ACTIVITY_ROWS = 4;

/** The timeline: a day heading and a few rows of an icon, a line of text and a time. The list scrolls inside a card whose
 * height is the neighbour's, so how many rows there are does not change the card. */
function ActivitySkeleton() {
  return (
    <Card
      title="Recent activity"
      className="overview-card--header-fixed overview-card--timeline"
      actions={<Skeleton variant="rect" width={96} height={28} />}
    >
      <div className="overview-timeline at-scroll">
        <div className="overview-timeline__group">
          <div className="overview-timeline__day">
            <Skeleton variant="rect" width={48} height={12} />
          </div>
          <ul className="overview-activity">
            {Array.from({ length: ACTIVITY_ROWS }, (_, row) => (
              <li key={row} className="overview-activity__item">
                <Skeleton variant="circle" width={28} height={28} />
                <div className="overview-activity__info">
                  <Skeleton variant="rect" width={140} height={14} />
                </div>
                <span className="overview-activity__time">
                  <Skeleton variant="rect" width={48} height={12} />
                  <Skeleton variant="rect" width={110} height={11} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

/** The five checks the checklist always has, by their real names; their state and detail are what the read says. */
const CHECKLIST_LABELS = ["Attendees imported", "Tickets sent", "Email delivery", "Check-in staff", "Event items"] as const;

function ChecklistSkeleton() {
  return (
    <Card title="Setup checklist" actions={<Skeleton variant="rect" width={72} height={12} />}>
      <div className="overview-setup">
        <Skeleton variant="rect" height={8} />
        <div className="overview-checklist">
          {CHECKLIST_LABELS.map((label) => (
            <div key={label} className="overview-check">
              <Skeleton variant="rect" width={34} height={34} />
              <span className="overview-check__body">
                <strong>{label}</strong>
                <Skeleton variant="rect" width={160} height={12} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function NotesSectionSkeleton({ icon, label }: Readonly<{ icon: string; label: string }>) {
  return (
    <div className="overview-notes-section">
      <div className="overview-notes-section__header">
        <span className="overline">
          <i className={`ti ti-${icon} overview-notes-section__icon`} aria-hidden="true" /> {label}
        </span>
      </div>
      <Skeleton variant="rect" height={41} />
    </div>
  );
}

function NotesSkeleton() {
  return (
    <Card title="Notes & contacts">
      <NotesSectionSkeleton icon="pin" label="Pinned note" />
      <NotesSectionSkeleton icon="address-book" label="Key contacts" />
      <NotesSectionSkeleton icon="paperclip" label="Links & files" />
    </Card>
  );
}

/**
 * The Overview below its header while its first read is on its way: the KPI tiles, the four cards with their real titles and
 * the shapes of what is in them, in a status region named after what is loading (invisible for the first 200ms, with the 8
 * second note). Decoration, so hidden from assistive tech, and not clickable.
 */
export function OverviewSkeleton({
  held,
  slow,
  countdown,
}: Readonly<{ held: boolean; slow: boolean; countdown: { value: string; label: string } }>) {
  return (
    <SettingsSkeletonRegion label="Loading the overview" held={held} slow={slow}>
      <div className="overview-stack overview-skeleton" aria-hidden="true">
        <KpiRowSkeleton countdown={countdown} />
        <div className="overview-body">
          <div className="overview-row overview-row--stretch">
            <CheckInSkeleton />
            <ActivitySkeleton />
          </div>
          <div className="overview-row overview-row--stretch">
            <ChecklistSkeleton />
            <NotesSkeleton />
          </div>
        </div>
      </div>
    </SettingsSkeletonRegion>
  );
}
