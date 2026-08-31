import type { ReactNode } from "react";
import { Button, HintLabel, Notice } from "@admitto/ui";
import type { EventSettingsDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { pluralSuffix } from "../utils/pluralize.js";

const DANGER_ZONE_HINT = "Actions that change event data or availability.";

/** Tooltip shared by the Danger Zone's superadmin-gated actions: superadmin restriction wins
 * over the action-specific reason. */
function computeSuperadminTooltip(
  isSa: boolean,
  restrictedWhenTrue: boolean,
  restrictedMessage: string,
): string | undefined {
  if (!isSa) return "Superadmin only";
  if (restrictedWhenTrue) return restrictedMessage;
  return undefined;
}

function describeRevokeCheckins(admittedCount: number): string {
  return admittedCount > 0
    ? `Reverses check-in for all ${admittedCount} currently checked-in attendee${pluralSuffix(admittedCount)}. They can check in again afterwards.`
    : "No attendees are currently checked in.";
}

function describeRevokeItems(issuedItemsCount: number): string {
  return issuedItemsCount > 0
    ? `Resets all ${issuedItemsCount} issued item${pluralSuffix(issuedItemsCount)} back to pending, for every attendee. They can be handed out again afterwards.`
    : "No items have been issued yet.";
}

const DELETION_BLOCKER_LABELS: Record<string, string> = {
  attendees: "attendees",
  custom_items: "custom items",
  custom_ticket_types: "custom ticket types",
  contacts: "contacts",
  resources: "resources",
  pinned_note: "pinned note",
  event_mail_template: "event-specific mail template",
};

function formatDeletionBlockers(blockers: readonly string[]): string {
  return blockers
    .map((key) => DELETION_BLOCKER_LABELS[key] ?? key.replaceAll("_", " "))
    .join(", ");
}

function describeDeleteEvent(
  isDeletable: boolean,
  deletionBlockers: readonly string[] | undefined,
): string {
  if (isDeletable) {
    return "Permanently deletes this event and everything in it. This can't be undone. Saved in the history log.";
  }
  const blockers = deletionBlockers ?? [];
  if (blockers.length > 0) {
    return `Still blocking delete: ${formatDeletionBlockers(blockers)}.`;
  }
  return "This event still has content that must be cleared before it can be permanently deleted.";
}

/** Danger zone tab: export PII, revoke check-ins/items, archive/unarchive, and delete. The
 * ConfirmDialogs these actions open are rendered by the parent (shared with the router's
 * unsaved-changes blocker dialog), so this panel only owns the trigger buttons/tooltips/status
 * text - every open/loading state stays parent-owned and is passed down as props. */
export function EventDangerZonePanel({
  event,
  isSa,
  exporting,
  onExportPii,
  revokingCheckins,
  onOpenRevokeCheckins,
  revokingItems,
  onOpenRevokeItems,
  archiveToggleButton,
  deleting,
  onOpenDelete,
}: Readonly<{
  event: EventSettingsDto;
  isSa: boolean;
  exporting: boolean;
  onExportPii: () => void;
  revokingCheckins: boolean;
  onOpenRevokeCheckins: () => void;
  revokingItems: boolean;
  onOpenRevokeItems: () => void;
  archiveToggleButton: ReactNode;
  deleting: boolean;
  onOpenDelete: () => void;
}>) {
  const revokeCheckinsTooltip = computeSuperadminTooltip(
    isSa,
    event.admitted_count === 0,
    "No check-ins to revoke",
  );
  const revokeItemsTooltip = computeSuperadminTooltip(
    isSa,
    event.issued_items_count === 0,
    "No items to revoke",
  );
  const deleteEventDescription = describeDeleteEvent(event.is_deletable, event.deletion_blockers);
  const deleteEventTooltip = computeSuperadminTooltip(
    isSa,
    !event.is_deletable,
    deleteEventDescription,
  );

  return (
    <>
      <div className="at-card danger-zone-panel">
        <div className="at-card__header danger-zone-panel__header">
          <div className="at-card__title">
            <HintLabel hint={DANGER_ZONE_HINT}>Danger zone</HintLabel>
          </div>
        </div>

        <div className="danger-zone__item">
          <div className="danger-zone__info">
            <div className="danger-zone__title">Export personal data</div>
            <p className="danger-zone__desc">
              Downloads every attendee&apos;s personal data as a CSV file (a simple spreadsheet).
              Saved in the history log.
            </p>
          </div>
          <ArchivedGuard
            event={null}
            reasonId="export-pii-reason"
            disabled={!isSa || exporting}
            tooltip={isSa ? undefined : "Superadmin only"}
          >
            {(guard) => (
              <Button
                variant="secondary"
                icon={<i className="ti ti-file-text" aria-hidden="true" />}
                {...guard}
                onClick={onExportPii}
              >
                {exporting ? "Exporting…" : "Export personal data"}
              </Button>
            )}
          </ArchivedGuard>
        </div>

        <div className="danger-zone__item">
          <div className="danger-zone__info">
            <div className="danger-zone__title">Revoke all check-ins</div>
            <p className="danger-zone__desc">{describeRevokeCheckins(event.admitted_count)}</p>
          </div>
          <ArchivedGuard
            event={event}
            reasonId="revoke-checkins-reason"
            disabled={!isSa || event.admitted_count === 0 || revokingCheckins}
            tooltip={revokeCheckinsTooltip}
          >
            {(guard) => (
              <Button
                variant="danger"
                icon={<i className="ti ti-arrow-back-up" aria-hidden="true" />}
                {...guard}
                onClick={onOpenRevokeCheckins}
              >
                Revoke all check-ins
              </Button>
            )}
          </ArchivedGuard>
        </div>

        <div className="danger-zone__item">
          <div className="danger-zone__info">
            <div className="danger-zone__title">Revoke all items issued</div>
            <p className="danger-zone__desc">{describeRevokeItems(event.issued_items_count)}</p>
          </div>
          <ArchivedGuard
            event={event}
            reasonId="revoke-items-reason"
            disabled={!isSa || event.issued_items_count === 0 || revokingItems}
            tooltip={revokeItemsTooltip}
          >
            {(guard) => (
              <Button
                variant="danger"
                icon={<i className="ti ti-package-off" aria-hidden="true" />}
                {...guard}
                onClick={onOpenRevokeItems}
              >
                Revoke all items issued
              </Button>
            )}
          </ArchivedGuard>
        </div>

        <div className="danger-zone__item">
          <div className="danger-zone__info">
            <div className="danger-zone__title">Revoke all Wallet passes</div>
            <p className="danger-zone__desc">
              Bulk revoke isn&apos;t built yet - planned for a future release. Attendees can still
              add their ticket to Apple or Google Wallet from the ticket page.
            </p>
          </div>
          <ArchivedGuard event={null} reasonId="wallet-revoke-reason" disabled tooltip="Not built yet">
            {(guard) => (
              <Button
                variant="secondary"
                icon={<i className="ti ti-wallet-off" aria-hidden="true" />}
                {...guard}
              >
                Revoke all Wallet passes
              </Button>
            )}
          </ArchivedGuard>
        </div>

        <div className="danger-zone__item">
          <div className="danger-zone__info">
            <div className="danger-zone__title">Archive event</div>
            <p className="danger-zone__desc">
              An archived event becomes fully read-only, including check-in. Only a superadmin can
              undo this.
            </p>
          </div>
          {isSa ? (
            archiveToggleButton
          ) : (
            <ArchivedGuard event={null} reasonId="archive-event-reason" disabled tooltip="Superadmin only">
              {(guard) => (
                <Button variant="danger" icon={<i className="ti ti-archive" aria-hidden="true" />} {...guard}>
                  Archive event
                </Button>
              )}
            </ArchivedGuard>
          )}
        </div>

        <div className="danger-zone__item">
          <div className="danger-zone__info">
            <div className="danger-zone__title">Delete event</div>
            <p className="danger-zone__desc">{deleteEventDescription}</p>
          </div>
          <ArchivedGuard
            event={null}
            reasonId="delete-event-reason"
            disabled={!isSa || !event.is_deletable || deleting}
            tooltip={deleteEventTooltip}
          >
            {(guard) => (
              <Button
                variant="danger"
                icon={<i className="ti ti-trash" aria-hidden="true" />}
                {...guard}
                onClick={onOpenDelete}
              >
                Delete event
              </Button>
            )}
          </ArchivedGuard>
        </div>
      </div>

      <Notice variant="error" className="danger-zone-notice">
        These actions can affect this event&apos;s data or availability. Some are limited to
        superadmins and saved in the history log.
      </Notice>
    </>
  );
}
