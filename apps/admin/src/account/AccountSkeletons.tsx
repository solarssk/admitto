import type { ReactNode } from "react";
import { Card, Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import type { AccountTab } from "./accountTabs.js";
import "./account-page.css";

/** The notifications card's own explanation: not data, so it is shown while the preferences load. */
export const NOTIFICATIONS_INTRO =
  "Choose which of your enabled security alert types you receive by email or see in-app. The shared team webhook (if configured) is managed separately in Organisation Settings.";

interface SkeletonRegionProps {
  /** What is loading ("Loading sessions"): the region's accessible name. The shapes are decoration. */
  label: string;
  /** After 8 seconds the region says it is taking longer than usual. */
  slow: boolean;
  /** Not painted yet (the 200ms before a placeholder shows): the space is in the page, nothing is drawn. */
  held?: boolean;
  className?: string;
  children: ReactNode;
}

/** A status region around placeholder shapes, with the 8 second message as its last line. */
function SkeletonRegion({ label, slow, held = false, className, children }: Readonly<SkeletonRegionProps>) {
  const cls = [className, held ? "at-loading-hold" : undefined].filter(Boolean).join(" ");
  return (
    <output aria-label={label} className={cls || undefined}>
      {children}
      {/* gridColumn: a full row when the region is a grid (the profile form, the two cards of Password), ignored in a stack. --text-secondary: on the Password tab the line sits on the page background, where muted grey is under 4.5:1. */}
      {slow ? (
        <span className="at-hint" style={{ gridColumn: "1 / -1", color: "var(--text-secondary)" }}>
          {SLOW_NOTICE_TEXT}
        </span>
      ) : null}
    </output>
  );
}

/** A label, a control and a hint: the real 36px control, so the field that replaces it is about as tall. */
function FieldSkeleton() {
  return (
    <div className="at-field">
      <Skeleton variant="rect" width="28%" height={14} />
      <Skeleton variant="rect" height={36} />
      <Skeleton variant="rect" width="45%" height={12} />
    </div>
  );
}

/** A card's list or table while it loads: one bar per row. */
export function RowsSkeleton({
  label,
  slow,
  held,
  rows,
  rowHeight,
}: Readonly<{ label: string; slow: boolean; held: boolean; rows: number; rowHeight: number }>) {
  return (
    <SkeletonRegion label={label} slow={slow} held={held} className="at-skeleton-stack">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} variant="rect" height={rowHeight} />
      ))}
    </SkeletonRegion>
  );
}

function SaveButtonSkeleton({ width }: Readonly<{ width: number }>) {
  return (
    <div className="mail-transport-footer">
      <Skeleton variant="rect" width={width} height={36} />
    </div>
  );
}

/**
 * The Account page while the account itself loads: the cards of the tab that was opened (the page can be
 * opened straight on any of them), drawn by the shape of what will replace them, so nothing below them
 * jumps when they arrive. The profile form is laid out by its own grid (`account-profile-editable`) and field
 * gap, so it needs no CSS of its own; the controls are the real 36px.
 *
 * Until the 200ms before a placeholder is shown have passed (`held`), the outermost box carries the hold
 * class, so not even an empty card is painted for a fast answer.
 */
export function AccountLoadingSkeleton({
  tab,
  held,
  slow,
}: Readonly<{ tab: AccountTab; held: boolean; slow: boolean }>) {
  const hold = held ? "at-loading-hold" : undefined;
  if (tab === "password") {
    return (
      <SkeletonRegion label="Loading account" slow={slow} held={held} className="account-security-grid">
        <Card title="Password">
          <div className="settings-card-stack">
            <Skeleton variant="text" lines={2} />
            <FieldSkeleton />
            <FieldSkeleton />
            <FieldSkeleton />
            {/* In the form itself, as the real button is, not in the card's own footer bar. */}
            <SaveButtonSkeleton width={140} />
          </div>
        </Card>
        <Card title="Two-factor authentication">
          <div className="at-skeleton-stack">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} variant="rect" height={56} />
            ))}
          </div>
        </Card>
      </SkeletonRegion>
    );
  }
  if (tab === "sessions") {
    return (
      <Card title="Active sessions" className={hold}>
        <RowsSkeleton label="Loading account" slow={slow} held={false} rows={3} rowHeight={44} />
      </Card>
    );
  }
  if (tab === "notifications") {
    return (
      <Card title="Notifications" className={hold}>
        <div className="settings-card-stack">
          <p className="settings-card-intro">{NOTIFICATIONS_INTRO}</p>
          <RowsSkeleton label="Loading account" slow={slow} held={false} rows={4} rowHeight={56} />
        </div>
      </Card>
    );
  }
  return (
    <Card title="Profile" className={hold} footer={<SaveButtonSkeleton width={64} />}>
      <SkeletonRegion label="Loading account" slow={slow} className="account-profile-editable">
        {Array.from({ length: 8 }, (_, i) => (
          <FieldSkeleton key={i} />
        ))}
      </SkeletonRegion>
    </Card>
  );
}
