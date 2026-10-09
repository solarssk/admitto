import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Button, Card, Checkbox, EmptyState, IconButton, Input, Skeleton, TopProgressBar } from "@admitto/ui";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import type {
  AttendeeMailStatusFilter,
  AttendeeRowDto,
  AttendeeSortBy,
  AttendeeSortDir,
  EventCustomFieldDto,
  RsvpStatus,
  TicketTypeDto,
} from "../api/types.js";
import {
  ARCHIVED_ACTION_TOOLTIP,
  ArchivedGuard,
  type ArchivedGuardEvent,
} from "../components/ArchivedGuard.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { RetryHint } from "../components/RetryHint.js";
import { useBusyEndCount } from "../hooks/useRetry.js";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { MultiSelect } from "../components/MultiSelect.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useDelayedLoading, useLoadingGate } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { ErasedBadge } from "./ErasedBadge.js";
import { ErasedEntriesBar } from "./ErasedEntriesBar.js";
import { rowIdentity, selectRowLabel } from "./erasedAttendee.js";
import { MailStatusBadge } from "./mailStatusBadge.js";
import { PassStatusBadge } from "./passStatusBadge.js";
import { RSVP_STATUS_OPTIONS, RsvpStatusBadge } from "./rsvpStatusBadge.js";
import { TicketTypeBadge } from "./ticketTypeBadge.js";
import { readRememberedRowCount, rememberRowCount } from "./rememberedRowCount.js";
import { WalletColumnCell } from "./walletColumnCell.js";
import { formatAdmissionDisplayParts } from "../utils/event-dates.js";
import { SLOW_NOTICE_MS, SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import "./attendees.css";

/** Rows a skeleton draws when it does not know how many the list will have. */
const DEFAULT_TABLE_SKELETON_ROWS = 6;
const DEFAULT_CARDS_SKELETON_ROWS = 4;

/** The status region of a first-load placeholder: it names what is loading for assistive tech, and after 8 seconds (`slow`)
 * says, in view and to the same region, that it is taking longer than usual. It has no height until then. */
function AttendeesSkeletonStatus({ slow }: Readonly<{ slow: boolean }>) {
  return (
    <output>
      <span className="sr-only">Loading attendees</span>
      {slow ? <span className="at-hint attendees-skeleton-note">{SLOW_NOTICE_TEXT}</span> : null}
    </output>
  );
}

/** First-load placeholder for the desktop table — same column layout, no data yet. */
function AttendeesTableSkeleton({
  walletColumnVisible,
  rows,
  slow,
}: Readonly<{ walletColumnVisible: boolean; rows: number; slow: boolean }>) {
  return (
    <div className="attendees-table-wrap attendees-list-table-wrap" aria-busy="true">
      <table className="table attendees-table-v2" aria-hidden="true">
        <thead>
          <tr>
            <th className="attendees-table-v2__checkbox-col" aria-label="Select" />
            <th>Attendee</th>
            <th>Company</th>
            <th>Ticket</th>
            <th>Pass status</th>
            <th>Attendance</th>
            <th>Mail</th>
            <th>Check-in</th>
            {walletColumnVisible && <th>Wallet</th>}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td colSpan={walletColumnVisible ? 9 : 8}>
                <Skeleton variant="rect" height={44} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AttendeesSkeletonStatus slow={slow} />
    </div>
  );
}

/** First-load placeholder for the mobile card list (< 768px — mirrors the table skeleton). */
function AttendeesCardsSkeleton({ rows, slow }: Readonly<{ rows: number; slow: boolean }>) {
  return (
    <div className="attendees-cards" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="attendees-card" key={i}>
          <Skeleton variant="rect" height={64} />
        </div>
      ))}
      <AttendeesSkeletonStatus slow={slow} />
    </div>
  );
}

/** Sortable columns, left to right, matching how operators scan a row (identity, affiliation,
 * the two independent status pairs, then attendance). Mail is deliberately absent — its value
 * is resolved per-row from a separate delivery lookup, not a plain column. */
const SORTABLE_COLUMNS: { column: AttendeeSortBy; label: string }[] = [
  { column: "name", label: "Attendee" },
  { column: "company", label: "Company" },
  { column: "ticket_type", label: "Ticket" },
  { column: "status", label: "Pass status" },
  { column: "rsvp_status", label: "Attendance" },
];

/** Same columns as the desktop header, plus Check-in (which sits after the unsortable Mail
 * column on desktop, so it isn't part of SORTABLE_COLUMNS) — the mobile "Sort by" select has
 * no column layout to split around, so it offers every sortable column together. */
const MOBILE_SORT_COLUMNS: { column: AttendeeSortBy; label: string }[] = [
  ...SORTABLE_COLUMNS,
  { column: "admitted_at", label: "Check-in" },
];

/** Column header that toggles the list's sort order on click — an unsorted column shows a
 * neutral two-way arrow, the active column shows a single arrow pointing in its current
 * direction. Clicking a new column always starts ascending (see AttendeesPage's onSortChange). */
function SortableHeader({
  column,
  label,
  sortBy,
  sortDir,
  onSortChange,
}: Readonly<{
  column: AttendeeSortBy;
  label: string;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
}>) {
  const active = sortBy === column;
  let ariaSortValue: "ascending" | "descending" | "none" = "none";
  let iconClass = "ti-arrows-sort";
  if (active) {
    ariaSortValue = sortDir === "asc" ? "ascending" : "descending";
    iconClass = sortDir === "asc" ? "ti-arrow-up" : "ti-arrow-down";
  }
  return (
    <th aria-sort={ariaSortValue}>
      <button
        type="button"
        className={`attendees-table-v2__sort-btn${active ? " attendees-table-v2__sort-btn--active" : ""}`}
        onClick={() => onSortChange(column)}
      >
        {label}
        <i className={`ti ${iconClass}`} aria-hidden="true" />
      </button>
    </th>
  );
}

/** Mobile equivalent of SortableHeader — a "Sort by" select (there's no column layout to attach
 * a per-column arrow to) plus a direction toggle. Reuses the same onSortChange contract: passing
 * the *current* column toggles its direction (AttendeesPage's onSortChange), passing a new one
 * switches to it ascending. */
function MobileSortControl({
  sortBy,
  sortDir,
  onSortChange,
}: Readonly<{
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
}>) {
  return (
    <div className="attendees-toolbar__filter attendees-toolbar__sort">
      <SearchableSelect
        id="attendees-sort-by"
        label="Sort by"
        placeholder="Sort by"
        searchPlaceholder="Search columns…"
        emptyLabel="No columns found"
        showLabel={false}
        value={sortBy}
        options={MOBILE_SORT_COLUMNS.map(({ column, label }) => ({ id: column, label }))}
        onChange={(id) => onSortChange(id as AttendeeSortBy)}
        panelMode="inline"
      />
      <IconButton
        label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
        icon={<i className={`ti ${sortDir === "asc" ? "ti-sort-ascending" : "ti-sort-descending"}`} aria-hidden="true" />}
        size="sm"
        onClick={() => onSortChange(sortBy)}
      />
    </div>
  );
}

/** Renders as two stacked lines ("Today" / "14:32"), mirroring the two-line
 * name/email cell next to it — null when the attendee hasn't checked in. */
function CheckInCell({
  admittedAt,
  eventTimezone,
}: Readonly<{
  admittedAt: string | null;
  eventTimezone: string;
}>) {
  if (!admittedAt) return <span className="attendee-readonly">-</span>;
  const parts = formatAdmissionDisplayParts(admittedAt, eventTimezone);
  return (
    <span className="attendees-table-v2__checkin">
      <i className="ti ti-circle-check" aria-hidden="true" />
      <span className="attendees-table-v2__checkin-lines">
        <span className="attendees-table-v2__checkin-day">{parts.day}</span>
        <span className="attendees-table-v2__checkin-time">{parts.time}</span>
      </span>
    </span>
  );
}

type AttendeeStatusFilter = "all" | "admitted" | "not_admitted";

export interface AttendeesTableProps {
  items: AttendeeRowDto[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  hasLoadedOnce: boolean;
  isUnfilteredEmpty: boolean;
  searchInput: string;
  statusFilter: AttendeeStatusFilter;
  ticketTypeFilter: string[];
  rsvpStatusFilter: RsvpStatus[];
  mailStatusFilter: AttendeeMailStatusFilter[];
  ticketTypes?: TicketTypeDto[];
  /** Set when the ticket-type filter's own catalog failed to load - the rest of the table (and
   * the other filters) still work, so this renders as a small inline notice next to the Type
   * filter, not a page-level error (CodeRabbit review, batch 04 / #351). */
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  /** The ticket-type Retry is working (its own flag, see useRetry). */
  ticketTypesRetrying?: boolean;
  /** One filter row per event-defined custom field (Requirements page), rendered after the four
   * fixed filters - `select`/`boolean` as a MultiSelect over that field's own options, `text` as
   * a contains-text input. Empty array renders no divider/rows at all. */
  customFields?: EventCustomFieldDto[];
  customFieldsError?: string | null;
  onRetryCustomFields?: () => void;
  customFieldsRetrying?: boolean;
  customFieldSelectValues: Readonly<Record<string, string[]>>;
  onCustomFieldSelectChange: (sourceField: string, values: string[]) => void;
  customFieldTextInputs: Readonly<Record<string, string>>;
  onCustomFieldTextInputChange: (sourceField: string, value: string) => void;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: AttendeeStatusFilter) => void;
  onTicketTypeFilterChange: (value: string[]) => void;
  onRsvpStatusFilterChange: (value: RsvpStatus[]) => void;
  onMailStatusFilterChange: (value: AttendeeMailStatusFilter[]) => void;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
  onViewAttendee: (id: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onBulkSendTickets: () => void;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
  onBulkCheckIn: () => void;
  bulkCheckInBusy: boolean;
  onBulkRevokeCheckIn: () => void;
  bulkRevokeCheckInBusy: boolean;
  onBulkExportSelected: () => void;
  bulkExportBusy: boolean;
  onBulkChangeTicketType: () => void;
  onBulkChangeRsvpStatus: () => void;
  onBulkSetCompany: () => void;
  onBulkSetDepartment: () => void;
  itemCount: number;
  itemsError?: string | null;
  onRetryItems?: () => void;
  /** The items Retry is working (its own flag, see useRetry). */
  itemsRetrying?: boolean;
  onBulkRevokeItems: () => void;
  bulkRevokeItemsBusy: boolean;
  onBulkRevokePass: () => void;
  bulkRevokePassBusy: boolean;
  onBulkVoidWallet: () => void;
  bulkVoidWalletBusy: boolean;
  onBulkReissueWallet: () => void;
  bulkReissueWalletBusy: boolean;
  onBulkRefreshWalletStatus: () => void;
  bulkRefreshWalletStatusBusy: boolean;
  onBulkDeleteWallet: () => void;
  bulkDeleteWalletBusy: boolean;
  onBulkRemoveWallet: () => void;
  bulkRemoveWalletBusy: boolean;
  onBulkDelete: () => void;
  /** Erase the personal data of the selection (a privacy request). */
  onBulkErase: () => void;
  /** Erased entries of the event (event-wide count): left out of the list unless `showErased`. */
  erasedCount: number;
  showErased: boolean;
  onShowErasedChange: (show: boolean) => void;
  eventTimezone: string;
  /** Keys what the list remembers about itself between visits (how many rows, for its skeleton). */
  eventId: string;
  event: ArchivedGuardEvent;
  walletPlatforms: EnabledWalletPlatforms;
  /** The event has a template and a working API key (EventDto.wallet_configured), whatever the
   * Wallet master switch says - all the read-only Refresh status action needs. */
  walletConfigured: boolean;
}

interface AttendeeCardProps {
  row: AttendeeRowDto;
  selected: boolean;
  onToggle: () => void;
  onView: () => void;
  ticketTypes: TicketTypeDto[];
  eventTimezone: string;
  walletPlatforms: EnabledWalletPlatforms;
}

/** Icon standing in for a card badge-row's field name (Pass/Attendance/Mail) - a word label at
 * that width pushed the row's total content past the card's available width often enough that
 * the last field wrapped to its own line (PO review, 2026-09-01: "Mail" dropping below
 * "Attendance" on an iPhone-width card). An icon is ~19% narrower than the words it replaces
 * (measured: 356px text-label total vs 289px icon total for the same three fields) and, as a
 * bonus, never reads as a continuation of the colored badge text next to it (the "Pass Active"
 * this replaces) the way same-weight label text could.
 *
 * Decorative icon (aria-hidden) + a visually-hidden text label, NOT the shared Tooltip component
 * WalletColumnCell's own PlatformIcon uses for the same idea (bot review, 2026-09-01): Tooltip
 * makes its own wrapper a real Tab stop whenever its child has no focusable descendant of its
 * own, which a plain `<i>` glyph never has - three of these per card, at the default 25-row page
 * size, would have added 75 non-actionable Tab stops a keyboard/switch-device user has to cross
 * just to get through the list. The field name still reaches assistive tech (as .sr-only text
 * right next to the icon in reading order), it just doesn't cost a stop of its own to get there. */
function FieldIcon({ iconClass, label }: Readonly<{ iconClass: string; label: string }>) {
  return (
    <>
      <i className={`ti ${iconClass} attendees-card__field-icon`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </>
  );
}

/** One attendee as a card — the < 768px equivalent of a table row: same data, same actions. */
function AttendeeCard({
  row,
  selected,
  onToggle,
  onView,
  ticketTypes,
  eventTimezone,
  walletPlatforms,
}: Readonly<AttendeeCardProps>) {
  const identity = rowIdentity(row, eventTimezone);
  return (
    <div
      className={`attendees-card${selected ? " attendees-card--selected" : ""}${
        identity.erased ? " attendees-card--erased" : ""
      }`}
    >
      <div className="attendees-card__top">
        <span className="attendees-card__cb">
          <Checkbox checked={selected} disabled={identity.erased} onChange={onToggle} aria-label={selectRowLabel(row)} />
        </span>
        <button type="button" className="attendees-row-btn attendees-card__identity" onClick={onView}>
          <span className="attendees-card__name">
            {identity.name}
            {identity.erased && <ErasedBadge />}
          </span>
          <span className={`attendees-card__email${identity.erased ? " attendees-card__email--note" : ""}`}>
            {identity.detail}
          </span>
        </button>
        <TicketTypeBadge ticketType={row.ticket_type} catalog={ticketTypes} />
      </div>
      {(row.company || row.department) && (
        <div className="attendees-card__meta">
          {row.company}
          {row.department ? ` · ${row.department}` : ""}
        </div>
      )}
      <div className="attendees-card__badges">
        <span className="attendees-card__badge-item">
          <FieldIcon iconClass="ti-ticket" label="Pass" />
          <PassStatusBadge status={row.status} />
        </span>
        <span className="attendees-card__badge-item">
          <FieldIcon iconClass="ti-calendar-event" label="Attendance" />
          <RsvpStatusBadge status={row.rsvp_status} />
        </span>
        <span className="attendees-card__badge-item">
          <FieldIcon iconClass="ti-mail" label="Mail" />
          <MailStatusBadge status={row.last_mail_status} />
        </span>
      </div>
      <div className="attendees-card__foot">
        {row.admitted_at ? (
          <CheckInCell admittedAt={row.admitted_at} eventTimezone={eventTimezone} />
        ) : (
          <span className="attendee-readonly">Not checked in</span>
        )}
        <WalletColumnCell status={row.wallet_status} enabledPlatforms={walletPlatforms} />
      </div>
    </div>
  );
}

/** "N attendee"/"N attendees" - factored out of BulkMoreActionsMenu's many menu-item hints (each
 * inline ternary counted toward that function's own cognitive complexity, Sonar S3776). */
function attendeeCount(n: number): string {
  return `${n} attendee${n === 1 ? "" : "s"}`;
}

/** Mobile "Send tickets" menu item's disabled-title (Sonar S3358: was a nested ternary). */
function bulkSendTicketsTooltip(archived: boolean, canBulkSend: boolean): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (!canBulkSend) return "No mail transport configured for this event. Set one up in Event Settings → Mailing.";
  return undefined;
}

function bulkRevokeCheckInTooltip(archived: boolean, canRevokeCheckIn: boolean): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (!canRevokeCheckIn) return "None of the selected attendees are checked in.";
  return undefined;
}

/** "Revoke pass" menu item's disabled-title — same "nothing to do" gate as "Revoke check-in"
 * (PO review follow-up): a selection where every attendee is already revoked/cancelled is a
 * guaranteed no-op, so it's disabled rather than left clickable into a confirm dialog that just
 * reports nothing changed. A mixed selection stays enabled — there's still real work for the
 * still-active ones. */
function bulkRevokePassTooltip(archived: boolean, canRevokePass: boolean): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (!canRevokePass) return "The selected attendees' passes are already revoked or cancelled.";
  return undefined;
}

/** "Void wallet pass"/"Reissue wallet pass" menu items' shared disabled-title - both are no-ops
 * once nothing in the selection has a WalletPass row at all. */
function bulkWalletTooltip(archived: boolean, canBulkWallet: boolean): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (!canBulkWallet) return "None of the selected attendees have added a wallet pass.";
  return undefined;
}

/** A catalog fetch's own "retry" menu item - shared by "Change ticket type" and "Revoke items"
 * below, which each hide their retry the same way (not archived, the catalog is empty, the fetch
 * itself errored, and a retry callback was actually given). */
function RetryMenuItem({
  show,
  onRetry,
  label,
}: Readonly<{ show: boolean; onRetry: (() => void) | undefined; label: string }>) {
  if (!show || !onRetry) return null;
  return (
    <button type="button" role="menuitem" className="more-actions-menu__retry link-btn" onClick={onRetry}>
      {label}
    </button>
  );
}

/** Mobile-only "Send tickets" menu item - desktop already has its own direct bulk-bar button for
 * this (attendees.css), so this only needs to render below 768px. */
function BulkSendTicketsMenuItem({
  isDesktop,
  archived,
  bulkSendBusy,
  canBulkSend,
  selectedCount,
  onClick,
}: Readonly<{
  isDesktop: boolean;
  archived: boolean;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
  selectedCount: number;
  onClick: () => void;
}>) {
  if (isDesktop) return null;
  return (
    <MoreActionsMenuItem
      icon="send"
      label="Send tickets"
      loading={bulkSendBusy}
      loadingLabel="Sending…"
      hint={`Email tickets to ${attendeeCount(selectedCount)}`}
      disabled={archived || bulkSendBusy || !canBulkSend}
      tooltip={bulkSendTicketsTooltip(archived, canBulkSend)}
      onClick={onClick}
    />
  );
}

/** Bulk "More actions" — Export selected, Change ticket type, and Delete, styled as a menu
 * (not bare buttons) so the destructive bulk action takes an extra click to even reach,
 * matching the design mockup's More actions panel and the same danger-item treatment already
 * used on the attendee detail page's own More actions menu. Room to grow: the mockup also
 * shows reminders and wallet-pass actions in this same menu — not built yet, out of scope. */
/** Bulk items/pass/wallet action props - identical between BulkMoreActionsMenu and its BulkBar
 * wrapper (which does nothing but forward these straight down), kept as one shared type instead
 * of two inline copies so they can't drift out of sync (Sonar duplication). */
interface BulkItemPassWalletActions {
  itemCount: number;
  revokableItemsCount: number;
  /** At least one selected attendee has something issued and an active pass - there's something
   * to revoke (CodeRabbit/PO review: was only gated on the event's catalog size, not the
   * selection). */
  canRevokeItems: boolean;
  itemsError?: string | null;
  onRetryItems?: () => void;
  onBulkRevokeItems: () => void;
  bulkRevokeItemsBusy: boolean;
  onBulkRevokePass: () => void;
  bulkRevokePassBusy: boolean;
  canRevokePass: boolean;
  revokablePassCount: number;
  onBulkVoidWallet: () => void;
  bulkVoidWalletBusy: boolean;
  onBulkReissueWallet: () => void;
  bulkReissueWalletBusy: boolean;
  onBulkRefreshWalletStatus: () => void;
  bulkRefreshWalletStatusBusy: boolean;
  onBulkDeleteWallet: () => void;
  bulkDeleteWalletBusy: boolean;
  onBulkRemoveWallet: () => void;
  bulkRemoveWalletBusy: boolean;
  /** At least one selected attendee has a WalletPass row - there's something for Void/Reissue to
   * act on (may still include an already-voided pass for Void, resolved server-side). */
  canBulkWallet: boolean;
  walletPassCount: number;
  walletPlatforms: EnabledWalletPlatforms;
  /** The event has a template and a working API key (EventDto.wallet_configured), whatever the
   * Wallet master switch says - all the read-only Refresh status action needs. */
  walletConfigured: boolean;
}

/** The wallet group of the bulk More actions menu, with its own divider - rendered only when the
 * event either still offers a wallet platform or has its provider credentials configured, so a
 * bare divider never appears. A selection can retain historical wallet_status rows from before an
 * admin turned the feature off.
 *
 * Void, Refresh status, Remove and Delete wind passes down: the API lets them through on an
 * archived event and with the Wallet switch off (only the event's credentials matter), so they are
 * gated on `walletConfigured` alone. Push updates changes what attendees' wallets show, so it keeps
 * the platform gate and the archived lock. Each item is disabled once nothing in the selection has
 * a WalletPass row - a mixed selection stays enabled, and the exact count can still include a pass
 * the action skips server-side (the result toast reports those; the row list does not carry the
 * finer status), which is why Remove's hint does not promise a number. */
function BulkWalletMenuItems({
  archived,
  walletPlatforms,
  walletConfigured,
  canBulkWallet,
  walletPassCount,
  onBulkVoidWallet,
  bulkVoidWalletBusy,
  onBulkReissueWallet,
  bulkReissueWalletBusy,
  onBulkRefreshWalletStatus,
  bulkRefreshWalletStatusBusy,
  onBulkRemoveWallet,
  bulkRemoveWalletBusy,
  onBulkDeleteWallet,
  bulkDeleteWalletBusy,
  close,
}: Readonly<
  Pick<
    BulkItemPassWalletActions,
    | "walletPlatforms"
    | "walletConfigured"
    | "canBulkWallet"
    | "walletPassCount"
    | "onBulkVoidWallet"
    | "bulkVoidWalletBusy"
    | "onBulkReissueWallet"
    | "bulkReissueWalletBusy"
    | "onBulkRefreshWalletStatus"
    | "bulkRefreshWalletStatusBusy"
    | "onBulkRemoveWallet"
    | "bulkRemoveWalletBusy"
    | "onBulkDeleteWallet"
    | "bulkDeleteWalletBusy"
  > & { archived: boolean; close: () => void }
>) {
  if (!walletPlatforms.any && !walletConfigured) return null;
  return (
    <>
      <hr className="more-actions-menu__divider" />
      {walletConfigured && (
        <MoreActionsMenuItem
          icon="wallet-off"
          variant="warning"
          label="Void wallet pass"
          loading={bulkVoidWalletBusy}
          hint={`Make the pass invalid for ${attendeeCount(walletPassCount)}`}
          disabled={bulkVoidWalletBusy || !canBulkWallet}
          tooltip={bulkWalletTooltip(false, canBulkWallet)}
          onClick={() => {
            close();
            onBulkVoidWallet();
          }}
        />
      )}
      {walletPlatforms.any && (
        <MoreActionsMenuItem
          icon="refresh-dot"
          label="Push updates"
          loading={bulkReissueWalletBusy}
          hint={`Send the latest details to ${attendeeCount(walletPassCount)}`}
          disabled={archived || bulkReissueWalletBusy || !canBulkWallet}
          tooltip={bulkWalletTooltip(archived, canBulkWallet)}
          onClick={() => {
            close();
            onBulkReissueWallet();
          }}
        />
      )}
      {walletConfigured && (
        <MoreActionsMenuItem
          icon="cloud-download"
          label="Refresh status"
          loading={bulkRefreshWalletStatusBusy}
          hint={`Get the latest status for ${attendeeCount(walletPassCount)}`}
          disabled={bulkRefreshWalletStatusBusy || !canBulkWallet}
          tooltip={bulkWalletTooltip(false, canBulkWallet)}
          onClick={() => {
            close();
            onBulkRefreshWalletStatus();
          }}
        />
      )}
      {walletConfigured && (
        <MoreActionsMenuItem
          icon="cloud-off"
          variant="danger"
          label="Remove from provider"
          loading={bulkRemoveWalletBusy}
          hint="Delete voided or expired passes, keep the history"
          disabled={bulkRemoveWalletBusy || !canBulkWallet}
          tooltip={bulkWalletTooltip(false, canBulkWallet)}
          onClick={() => {
            close();
            onBulkRemoveWallet();
          }}
        />
      )}
      {walletConfigured && (
        <MoreActionsMenuItem
          icon="trash"
          variant="danger"
          label="Delete wallet pass"
          loading={bulkDeleteWalletBusy}
          hint={`Delete the pass and its history for ${attendeeCount(walletPassCount)}`}
          disabled={bulkDeleteWalletBusy || !canBulkWallet}
          tooltip={bulkWalletTooltip(false, canBulkWallet)}
          onClick={() => {
            close();
            onBulkDeleteWallet();
          }}
        />
      )}
    </>
  );
}

function BulkMoreActionsMenu({
  selectedCount,
  archived,
  onBulkRevokeCheckIn,
  bulkRevokeCheckInBusy,
  canRevokeCheckIn,
  revokableCheckInCount,
  bulkSendBusy,
  canBulkSend,
  onBulkSendTickets,
  exportBusy,
  onExportSelected,
  ticketTypeCount,
  changeTicketTypeDisabled,
  changeTicketTypeDisabledReason,
  ticketTypesError,
  onRetryTicketTypes,
  onChangeTicketType,
  onChangeRsvpStatus,
  onSetCompany,
  onSetDepartment,
  itemCount,
  revokableItemsCount,
  canRevokeItems,
  itemsError,
  onRetryItems,
  onBulkRevokeItems,
  bulkRevokeItemsBusy,
  onBulkRevokePass,
  bulkRevokePassBusy,
  canRevokePass,
  revokablePassCount,
  onBulkVoidWallet,
  bulkVoidWalletBusy,
  onBulkReissueWallet,
  bulkReissueWalletBusy,
  onBulkRefreshWalletStatus,
  bulkRefreshWalletStatusBusy,
  onBulkDeleteWallet,
  bulkDeleteWalletBusy,
  onBulkRemoveWallet,
  bulkRemoveWalletBusy,
  canBulkWallet,
  walletPassCount,
  walletPlatforms,
  walletConfigured,
  onDelete,
  onErase,
}: Readonly<{
  selectedCount: number;
  archived: boolean;
  onBulkRevokeCheckIn: () => void;
  bulkRevokeCheckInBusy: boolean;
  /** At least one selected attendee is currently checked in - there's something to revoke. */
  canRevokeCheckIn: boolean;
  /** How many of the selection are actually checked in - the count this action would affect,
   * not the raw selection size (PO review: was showing the full selection count even when
   * only some of it was checked in). */
  revokableCheckInCount: number;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
  onBulkSendTickets: () => void;
  exportBusy: boolean;
  onExportSelected: () => void;
  ticketTypeCount: number;
  changeTicketTypeDisabled: boolean;
  changeTicketTypeDisabledReason?: string;
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  onChangeTicketType: () => void;
  onChangeRsvpStatus: () => void;
  onSetCompany: () => void;
  onSetDepartment: () => void;
  onDelete: () => void;
  onErase: () => void;
} & BulkItemPassWalletActions>) {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
  });
  const isDesktop = useIsDesktop();

  return (
    <div className="more-actions-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {/* Shortened below 768px — with its leading icon dropped too (attendees.css), "More
         * actions" is the one label of the three bulk-bar buttons long enough to still not
         * fit on one line otherwise (PO review: was wrapping onto a 3rd line). */}
        {isDesktop ? "More actions" : "More"}
      </Button>
      {open && (
        <div className="more-actions-menu__panel at-scroll" role="menu" ref={panelRef} style={panelStyle}>
          {/* Below 768px only — "Send tickets" doesn't fit as its own button next to the
           * count and "Check in" (attendees.css), so it lives here instead on mobile, first
           * in the list since it's still one of the two most common bulk actions. */}
          <BulkSendTicketsMenuItem
            isDesktop={isDesktop}
            archived={archived}
            bulkSendBusy={bulkSendBusy}
            canBulkSend={canBulkSend}
            selectedCount={selectedCount}
            onClick={() => {
              setOpen(false);
              onBulkSendTickets();
            }}
          />
          {/* Not ArchivedGuard'd — exporting a selection is read-only, so it stays legal
           * after an event is archived. */}
          <MoreActionsMenuItem
            icon="download"
            label="Export selected"
            hint={`CSV of ${attendeeCount(selectedCount)}`}
            disabled={exportBusy}
            onClick={() => {
              setOpen(false);
              onExportSelected();
            }}
          />
          {/* Disabled (not hidden) on archived events and when the catalog is empty — the
           * endpoint is guardArchivedEvent'd, and with no configured types there's nothing
           * to pick; the title explains why instead of the item silently vanishing. */}
          <MoreActionsMenuItem
            icon="ticket"
            label="Change ticket type"
            hint={`Choose from ${ticketTypeCount} configured type${ticketTypeCount === 1 ? "" : "s"}`}
            disabled={changeTicketTypeDisabled}
            tooltip={changeTicketTypeDisabled ? changeTicketTypeDisabledReason : undefined}
            onClick={() => {
              setOpen(false);
              onChangeTicketType();
            }}
          />
          {/* The catalog fetch's own retry lives behind the Type filter, which this bulk bar
           * replaces while rows are selected — without this, the only way to retry was to
           * clear the selection first, losing the batch the operator was about to act on
           * (Codex review). */}
          <RetryMenuItem
            show={!archived && changeTicketTypeDisabled && !!ticketTypesError}
            onRetry={onRetryTicketTypes}
            label="Retry loading ticket types"
          />
          {/* Fixed 5-value enum, unlike Change ticket type above - no per-event catalog to be
           * empty, so archived is the only disabled reason. */}
          <MoreActionsMenuItem
            icon="calendar-event"
            label="Change attendance status"
            hint={`Set for ${attendeeCount(selectedCount)}`}
            disabled={archived}
            tooltip={archived ? ARCHIVED_ACTION_TOOLTIP : undefined}
            onClick={() => {
              setOpen(false);
              onChangeRsvpStatus();
            }}
          />
          <MoreActionsMenuItem
            icon="building"
            label="Set company"
            hint={`Set for ${attendeeCount(selectedCount)}`}
            disabled={archived}
            tooltip={archived ? ARCHIVED_ACTION_TOOLTIP : undefined}
            onClick={() => {
              setOpen(false);
              onSetCompany();
            }}
          />
          <MoreActionsMenuItem
            icon="sitemap"
            label="Set department"
            hint={`Set for ${attendeeCount(selectedCount)}`}
            disabled={archived}
            tooltip={archived ? ARCHIVED_ACTION_TOOLTIP : undefined}
            onClick={() => {
              setOpen(false);
              onSetDepartment();
            }}
          />
          <hr className="more-actions-menu__divider" />
          {/* Desktop already has a direct "Check in" button in the bulk bar, but no direct
           * revoke button anywhere — this menu is the only place for the reverse action, at
           * every screen size, unlike Send tickets above which is mobile-only (PO review, #522
           * follow-up: "revoke czy tam undo check in" for a selection). Disabled (not hidden)
           * when nothing in the selection is currently checked in, same convention as Change
           * ticket type below. Styled as a caution item (not full danger) — it's reversible via
           * Check in again, unlike Delete below (PO review). */}
          <MoreActionsMenuItem
            icon="qrcode-off"
            variant="warning"
            label="Revoke check-in"
            loading={bulkRevokeCheckInBusy}
            hint={`Undo check-in for ${attendeeCount(revokableCheckInCount)}`}
            disabled={archived || bulkRevokeCheckInBusy || !canRevokeCheckIn}
            tooltip={bulkRevokeCheckInTooltip(archived, canRevokeCheckIn)}
            onClick={() => {
              setOpen(false);
              onBulkRevokeCheckIn();
            }}
          />
          {/* Disabled (not hidden) on archived events and when the event has no configured
           * items - same convention as Change ticket type above. Always resets every
           * configured item for the selection at once (no per-item picker, PO review, #551:
           * "od tego mamy check in widok" - for precise per-attendee/per-item
           * control, that already exists on the check-in screen). Independent of check-in
           * status, matching the Danger Zone's event-wide "Revoke all items issued". */}
          <MoreActionsMenuItem
            icon="package"
            variant="warning"
            label="Revoke items"
            loading={bulkRevokeItemsBusy}
            hint={`Reset all issued items for ${attendeeCount(revokableItemsCount)}`}
            disabled={archived || bulkRevokeItemsBusy || itemCount === 0 || !canRevokeItems}
            tooltip={bulkRevokeItemsTooltip(archived, itemCount, itemsError, canRevokeItems)}
            onClick={() => {
              setOpen(false);
              onBulkRevokeItems();
            }}
          />
          <RetryMenuItem
            show={!archived && itemCount === 0 && !!itemsError}
            onRetry={onRetryItems}
            label="Retry loading items"
          />
          {/* Disabled once every selected attendee is already revoked/cancelled — a guaranteed
           * no-op otherwise, same "nothing to do" gate as "Revoke check-in" (PO review
           * follow-up, #549). A mixed selection stays enabled: the server already leaves an
           * already-revoked/cancelled attendee untouched and reports it separately in the
           * result toast. */}
          <MoreActionsMenuItem
            icon="ban"
            variant="danger"
            label="Revoke pass"
            loading={bulkRevokePassBusy}
            hint={`Block check-in for ${attendeeCount(revokablePassCount)}`}
            disabled={archived || bulkRevokePassBusy || !canRevokePass}
            tooltip={bulkRevokePassTooltip(archived, canRevokePass)}
            onClick={() => {
              setOpen(false);
              onBulkRevokePass();
            }}
          />
          <BulkWalletMenuItems
            archived={archived}
            walletPlatforms={walletPlatforms}
            walletConfigured={walletConfigured}
            canBulkWallet={canBulkWallet}
            walletPassCount={walletPassCount}
            onBulkVoidWallet={onBulkVoidWallet}
            bulkVoidWalletBusy={bulkVoidWalletBusy}
            onBulkReissueWallet={onBulkReissueWallet}
            bulkReissueWalletBusy={bulkReissueWalletBusy}
            onBulkRefreshWalletStatus={onBulkRefreshWalletStatus}
            bulkRefreshWalletStatusBusy={bulkRefreshWalletStatusBusy}
            onBulkRemoveWallet={onBulkRemoveWallet}
            bulkRemoveWalletBusy={bulkRemoveWalletBusy}
            onBulkDeleteWallet={onBulkDeleteWallet}
            bulkDeleteWalletBusy={bulkDeleteWalletBusy}
            close={() => setOpen(false)}
          />
          <hr className="more-actions-menu__divider" />
          {/* Neither is ArchivedGuard'd — privacy requests can legally arrive after an event
           * ends, and neither endpoint blocks on archived_at. */}
          <MoreActionsMenuItem
            icon="eraser"
            variant="danger"
            label="Erase personal data"
            hint="For privacy requests. Reports keep their numbers."
            onClick={() => {
              setOpen(false);
              onErase();
            }}
          />
          <MoreActionsMenuItem
            icon="trash"
            variant="danger"
            label="Delete"
            hint={`Permanently remove ${attendeeCount(selectedCount)}`}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** "Change ticket type" menu item's disabled-title (Sonar S3358: was a nested ternary). */
function bulkChangeTicketTypeReason(archived: boolean, ticketTypesError?: string | null): string {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (ticketTypesError) return "Could not load ticket types. Try again from the Type filter above.";
  return "No ticket types configured for this event. Add some in Event Settings → Ticket types.";
}

/** "Revoke items" menu item's disabled-title — checks the event-level catalog (no items
 * configured / failed to load) same as before, plus the same "nothing to do" selection-level
 * gate "Revoke check-in"/"Revoke pass" already have (CodeRabbit/PO review: was only checking the
 * event's catalog size, so a selection with nothing issued still opened the confirm dialog). */
function bulkRevokeItemsTooltip(
  archived: boolean,
  itemCount: number,
  itemsError: string | null | undefined,
  canRevokeItems: boolean,
): string | undefined {
  if (archived) return ARCHIVED_ACTION_TOOLTIP;
  if (itemsError) return "Could not load items. Try again.";
  if (itemCount === 0) return "No items configured for this event. Add some in Requirements.";
  if (!canRevokeItems) return "None of the selected attendees have anything issued.";
  return undefined;
}

/** Selection count + "Send tickets" / "More actions" — replaces the search/filter toolbar in
 * place while rows are selected, so the card never grows taller just because something is
 * selected. */
function BulkBar({
  selectedIds,
  onClearSelection,
  event,
  bulkSendBusy,
  canBulkSend,
  onBulkSendTickets,
  bulkCheckInBusy,
  onBulkCheckIn,
  checkInDisabled,
  onBulkRevokeCheckIn,
  bulkRevokeCheckInBusy,
  canRevokeCheckIn,
  revokableCheckInCount,
  bulkExportBusy,
  onBulkExportSelected,
  ticketTypes,
  ticketTypesError,
  onRetryTicketTypes,
  onBulkChangeTicketType,
  onBulkChangeRsvpStatus,
  onBulkSetCompany,
  onBulkSetDepartment,
  itemCount,
  revokableItemsCount,
  canRevokeItems,
  itemsError,
  onRetryItems,
  onBulkRevokeItems,
  bulkRevokeItemsBusy,
  onBulkRevokePass,
  bulkRevokePassBusy,
  canRevokePass,
  revokablePassCount,
  onBulkVoidWallet,
  bulkVoidWalletBusy,
  onBulkReissueWallet,
  bulkReissueWalletBusy,
  onBulkRefreshWalletStatus,
  bulkRefreshWalletStatusBusy,
  onBulkDeleteWallet,
  bulkDeleteWalletBusy,
  onBulkRemoveWallet,
  bulkRemoveWalletBusy,
  canBulkWallet,
  walletPassCount,
  walletPlatforms,
  walletConfigured,
  onBulkDelete,
  onBulkErase,
}: Readonly<{
  selectedIds: ReadonlySet<string>;
  onClearSelection: () => void;
  event: ArchivedGuardEvent;
  bulkSendBusy: boolean;
  canBulkSend: boolean;
  onBulkSendTickets: () => void;
  bulkCheckInBusy: boolean;
  onBulkCheckIn: () => void;
  /** Every selected attendee is already checked in - nothing for this action to do. */
  checkInDisabled: boolean;
  onBulkRevokeCheckIn: () => void;
  bulkRevokeCheckInBusy: boolean;
  /** At least one selected attendee is currently checked in - there's something to revoke. */
  canRevokeCheckIn: boolean;
  /** How many of the selection are actually checked in - threaded down to the menu item's hint
   * text instead of the raw selection size (PO review). */
  revokableCheckInCount: number;
  bulkExportBusy: boolean;
  onBulkExportSelected: () => void;
  ticketTypes: TicketTypeDto[];
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  onBulkChangeTicketType: () => void;
  onBulkChangeRsvpStatus: () => void;
  onBulkSetCompany: () => void;
  onBulkSetDepartment: () => void;
  onBulkDelete: () => void;
  onBulkErase: () => void;
} & BulkItemPassWalletActions>) {
  const archived = event.archived_at != null;
  const isDesktop = useIsDesktop();
  return (
    <div className="attendees-bulkbar">
      <div className="attendees-bulkbar__info">
        <span className="attendees-bulkbar__count">
          <strong>{selectedIds.size}</strong> selected
        </span>
        <button
          type="button"
          className="attendees-bulkbar__clear"
          onClick={onClearSelection}
          aria-label="Clear selection"
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>
      {/* Own wrapping group (not just spacer + buttons loose in the row) so it can sit
       * flush against the row's right edge (margin-left: auto) without a dedicated spacer
       * element. */}
      <div className="attendees-bulkbar__actions">
        <span className="attendees-bulkbar__sep" aria-hidden="true" />
        {/* Desktop only below 768px, "Send tickets" moves into the "More" menu instead
         * (attendees.css) — with the count and "Check in" it doesn't fit as its own button
         * without the row growing taller than the toolbar it replaces (PO review: selecting
         * attendees was visibly expanding the bar). */}
        {isDesktop && (
          <ArchivedGuard
            event={event}
            reasonId="bulk-send-tickets-reason"
            disabled={bulkSendBusy || !canBulkSend}
            tooltip={
              !canBulkSend
                ? "No mail transport configured for this event. Set one up in Event Settings → Mailing."
                : undefined
            }
          >
            {(guard) => (
              <Button
                variant="ghost"
                icon={<i className="ti ti-send" aria-hidden="true" />}
                {...guard}
                loading={bulkSendBusy}
                loadingLabel="Sending…"
                onClick={onBulkSendTickets}
              >
                Send tickets
              </Button>
            )}
          </ArchivedGuard>
        )}
        <ArchivedGuard
          event={event}
          reasonId="bulk-checkin-reason"
          disabled={bulkCheckInBusy || checkInDisabled}
          tooltip={checkInDisabled ? "Every selected attendee is already checked in." : undefined}
        >
          {(guard) => (
            <Button
              variant="ghost"
              icon={<i className="ti ti-qrcode" aria-hidden="true" />}
              {...guard}
              loading={bulkCheckInBusy}
              onClick={onBulkCheckIn}
            >
              Check in
            </Button>
          )}
        </ArchivedGuard>
        <BulkMoreActionsMenu
          selectedCount={selectedIds.size}
          archived={archived}
          onBulkRevokeCheckIn={onBulkRevokeCheckIn}
          bulkRevokeCheckInBusy={bulkRevokeCheckInBusy}
          canRevokeCheckIn={canRevokeCheckIn}
          revokableCheckInCount={revokableCheckInCount}
          bulkSendBusy={bulkSendBusy}
          canBulkSend={canBulkSend}
          onBulkSendTickets={onBulkSendTickets}
          exportBusy={bulkExportBusy}
          onExportSelected={onBulkExportSelected}
          ticketTypeCount={ticketTypes.length}
          changeTicketTypeDisabled={archived || ticketTypes.length === 0}
          changeTicketTypeDisabledReason={bulkChangeTicketTypeReason(archived, ticketTypesError)}
          ticketTypesError={ticketTypesError}
          onRetryTicketTypes={onRetryTicketTypes}
          onChangeTicketType={onBulkChangeTicketType}
          onChangeRsvpStatus={onBulkChangeRsvpStatus}
          onSetCompany={onBulkSetCompany}
          onSetDepartment={onBulkSetDepartment}
          itemCount={itemCount}
          revokableItemsCount={revokableItemsCount}
          canRevokeItems={canRevokeItems}
          itemsError={itemsError}
          onRetryItems={onRetryItems}
          onBulkRevokeItems={onBulkRevokeItems}
          bulkRevokeItemsBusy={bulkRevokeItemsBusy}
          onBulkRevokePass={onBulkRevokePass}
          bulkRevokePassBusy={bulkRevokePassBusy}
          canRevokePass={canRevokePass}
          revokablePassCount={revokablePassCount}
          onBulkVoidWallet={onBulkVoidWallet}
          bulkVoidWalletBusy={bulkVoidWalletBusy}
          onBulkReissueWallet={onBulkReissueWallet}
          bulkReissueWalletBusy={bulkReissueWalletBusy}
          onBulkRefreshWalletStatus={onBulkRefreshWalletStatus}
          bulkRefreshWalletStatusBusy={bulkRefreshWalletStatusBusy}
          onBulkDeleteWallet={onBulkDeleteWallet}
          bulkDeleteWalletBusy={bulkDeleteWalletBusy}
          onBulkRemoveWallet={onBulkRemoveWallet}
          bulkRemoveWalletBusy={bulkRemoveWalletBusy}
          canBulkWallet={canBulkWallet}
          walletPassCount={walletPassCount}
          walletPlatforms={walletPlatforms}
          walletConfigured={walletConfigured}
          onDelete={onBulkDelete}
          onErase={onBulkErase}
        />
      </div>
    </div>
  );
}

const CUSTOM_FIELD_BOOLEAN_OPTIONS: ReadonlyArray<SegmentedOption<"any" | "true" | "false">> = [
  { value: "any", label: "Any" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

/** Derives the exclusive Any/Yes/No toggle state for a boolean custom field from its underlying
 * multi-value filter array - kept as string[] so every custom field (text/select/boolean) shares
 * the same `cf_<source_field>` query-param shape instead of boolean getting a one-off type. */
function customFieldBooleanValue(values: readonly string[]): "any" | "true" | "false" {
  if (values.includes("true")) return "true";
  if (values.includes("false")) return "false";
  return "any";
}

/** Search box + a single "Filters" trigger button. The four filter selects (and, on mobile,
 * the "Sort by" control) live in a floating dropdown panel opened from that button — not
 * inline in the row and not a horizontally-scrolling strip (both tried and rejected in PO
 * review: inline wrapping changed the row's height, and a scrollable row still meant
 * scrolling to reach a filter). A floating panel is `position: absolute`, so it overlays the
 * table below instead of pushing it down — the row itself (search + one button) never
 * changes size, at any viewport, whether the panel is open or closed. Same trigger+panel
 * mechanism as the Export and More actions menus elsewhere on this page. */
function FilterToolbar({
  searchInput,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  ticketTypeFilter,
  onTicketTypeFilterChange,
  ticketTypes,
  ticketTypesError,
  onRetryTicketTypes,
  ticketTypesRetrying = false,
  rsvpStatusFilter,
  onRsvpStatusFilterChange,
  mailStatusFilter,
  onMailStatusFilterChange,
  customFields,
  customFieldsError,
  onRetryCustomFields,
  customFieldsRetrying = false,
  customFieldSelectValues,
  onCustomFieldSelectChange,
  customFieldTextInputs,
  onCustomFieldTextInputChange,
  isDesktop,
  sortBy,
  sortDir,
  onSortChange,
}: Readonly<{
  searchInput: string;
  onSearchChange: (value: string) => void;
  statusFilter: AttendeeStatusFilter;
  onStatusFilterChange: (value: AttendeeStatusFilter) => void;
  ticketTypeFilter: string[];
  onTicketTypeFilterChange: (value: string[]) => void;
  ticketTypes: TicketTypeDto[];
  ticketTypesError?: string | null;
  onRetryTicketTypes?: () => void;
  ticketTypesRetrying?: boolean;
  rsvpStatusFilter: RsvpStatus[];
  onRsvpStatusFilterChange: (value: RsvpStatus[]) => void;
  mailStatusFilter: AttendeeMailStatusFilter[];
  onMailStatusFilterChange: (value: AttendeeMailStatusFilter[]) => void;
  customFields: EventCustomFieldDto[];
  customFieldsError?: string | null;
  onRetryCustomFields?: () => void;
  customFieldsRetrying?: boolean;
  customFieldSelectValues: Readonly<Record<string, string[]>>;
  onCustomFieldSelectChange: (sourceField: string, values: string[]) => void;
  customFieldTextInputs: Readonly<Record<string, string>>;
  onCustomFieldTextInputChange: (sourceField: string, value: string) => void;
  isDesktop: boolean;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
}>) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeCustomFieldCount = customFields.filter((field) =>
    field.type === "text"
      ? Boolean(customFieldTextInputs[field.source_field]?.trim())
      : (customFieldSelectValues[field.source_field]?.length ?? 0) > 0,
  ).length;
  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (rsvpStatusFilter.length > 0 ? 1 : 0) +
    (ticketTypeFilter.length > 0 ? 1 : 0) +
    (mailStatusFilter.length > 0 ? 1 : 0) +
    activeCustomFieldCount;

  return (
    <div className="attendees-toolbar">
      <div className="attendees-toolbar__search">
        <Input
          ref={searchInputRef}
          id="attendees-search"
          name="attendees-search"
          aria-label="Search attendees by name, email, or company"
          placeholder="Name, email, or company"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          icon={<i className="ti ti-search" aria-hidden="true" />}
        />
        {searchInput.length > 0 && (
          <button
            type="button"
            className="attendees-toolbar__search-clear"
            onClick={() => {
              onSearchChange("");
              searchInputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </div>
      <FiltersMenu activeCount={activeFilterCount} className="attendees-filters-menu">
        {!isDesktop && (
          <MobileSortControl sortBy={sortBy} sortDir={sortDir} onSortChange={onSortChange} />
        )}
        <div className="attendees-toolbar__filter">
          <MultiSelect
            id="attendees-filter-type"
            label="Filter by ticket type"
            placeholder="All ticket types"
            searchPlaceholder="Search ticket types…"
            emptyLabel="No ticket types found"
            value={ticketTypeFilter}
            options={ticketTypes.map((t) => ({ id: t.key, label: t.label }))}
            onChange={onTicketTypeFilterChange}
            panelMode="inline"
          />
          {ticketTypesError && (
            <RetryHint message={ticketTypesError} busy={ticketTypesRetrying} onRetry={onRetryTicketTypes} />
          )}
        </div>
        <div className="attendees-toolbar__filter">
          <MultiSelect
            id="attendees-filter-rsvp"
            label="Filter by attendance"
            placeholder="All attendance statuses"
            searchPlaceholder="Search attendance statuses…"
            emptyLabel="No attendance statuses found"
            value={rsvpStatusFilter}
            options={RSVP_STATUS_OPTIONS}
            onChange={(ids) => onRsvpStatusFilterChange(ids as RsvpStatus[])}
            panelMode="inline"
          />
        </div>
        <div className="attendees-toolbar__filter">
          <SearchableSelect
            id="attendees-filter-checkin"
            label="Filter by check-in status"
            placeholder="All check-ins"
            searchPlaceholder="Search check-in statuses…"
            emptyLabel="No check-in statuses found"
            value={statusFilter}
            options={[
              { id: "all", label: "All check-ins" },
              { id: "admitted", label: "Checked in", icon: "circle-check" },
              { id: "not_admitted", label: "Not checked in", icon: "circle-dashed" },
            ]}
            onChange={(id) => onStatusFilterChange(id as AttendeeStatusFilter)}
            panelMode="inline"
          />
        </div>
        <div className="attendees-toolbar__filter">
          {/* Buckets over raw delivery statuses — filters the same latest-delivery status
            * the Mail column badge shows (#522). */}
          <MultiSelect
            id="attendees-filter-mail"
            label="Filter by mail delivery status"
            placeholder="All mail statuses"
            searchPlaceholder="Search mail statuses…"
            emptyLabel="No mail statuses found"
            value={mailStatusFilter}
            options={[
              { id: "not_sent", label: "Not sent", icon: "mail-off" },
              { id: "sent", label: "Sent", icon: "mail-opened" },
              { id: "pending", label: "Pending", icon: "clock" },
              { id: "failed", label: "Failed", icon: "alert-triangle" },
            ]}
            onChange={(ids) => onMailStatusFilterChange(ids as AttendeeMailStatusFilter[])}
            panelMode="inline"
          />
        </div>
        {customFields.length > 0 && (
          <p className="attendees-filters-menu__section-label">Custom fields</p>
        )}
        {customFields.map((field) => {
          if (field.type === "text") {
            return (
              <div className="attendees-toolbar__filter" key={field.id}>
                <Input
                  id={`attendees-filter-cf-${field.source_field}`}
                  label={field.label}
                  placeholder={`Any ${field.label.toLowerCase()}`}
                  value={customFieldTextInputs[field.source_field] ?? ""}
                  onChange={(e) =>
                    onCustomFieldTextInputChange(field.source_field, e.target.value)
                  }
                />
              </div>
            );
          }
          if (field.type === "boolean") {
            return (
              <div className="attendees-toolbar__filter" key={field.id}>
                <span className="at-label">{field.label}</span>
                <Segmented
                  ariaLabel={field.label}
                  value={customFieldBooleanValue(customFieldSelectValues[field.source_field] ?? [])}
                  options={CUSTOM_FIELD_BOOLEAN_OPTIONS}
                  onChange={(val) =>
                    onCustomFieldSelectChange(field.source_field, val === "any" ? [] : [val])
                  }
                />
              </div>
            );
          }
          return (
            <div className="attendees-toolbar__filter" key={field.id}>
              <MultiSelect
                id={`attendees-filter-cf-${field.source_field}`}
                label={field.label}
                placeholder={`Any ${field.label.toLowerCase()}`}
                searchPlaceholder={`Search ${field.label.toLowerCase()}…`}
                emptyLabel="No options found"
                value={customFieldSelectValues[field.source_field] ?? []}
                options={(field.options ?? []).map((option) => ({ id: option, label: option }))}
                onChange={(values) => onCustomFieldSelectChange(field.source_field, values)}
                panelMode="inline"
              />
            </div>
          );
        })}
        {customFieldsError && (
          <RetryHint message={customFieldsError} busy={customFieldsRetrying} onRetry={onRetryCustomFields} />
        )}
      </FiltersMenu>
    </div>
  );
}

/** Deliberately not walletPlatforms.any (Apple/Google only, see its own doc comment) - this
 * column's own cell (WalletColumnCell) already reads real Samsung registration data the same
 * way it does Apple/Google's, so the column itself must still appear for an event that enables
 * Samsung alone. */
function hasWalletColumn(walletPlatforms: EnabledWalletPlatforms): boolean {
  return walletPlatforms.apple || walletPlatforms.google || walletPlatforms.samsung;
}

type AttendeeTableRowProps = Readonly<{
  row: AttendeeRowDto;
  selected: boolean;
  onToggle: () => void;
  onView: () => void;
  ticketTypes: TicketTypeDto[];
  eventTimezone: string;
  walletPlatforms: EnabledWalletPlatforms;
  walletColumnVisible: boolean;
}>;

/** One attendee as a table row. An erased entry is muted, shows "Erased attendee" and the date in
 * place of the name and address, and has a checkbox that stays off: no bulk action works on it. */
function AttendeeTableRow({
  row,
  selected,
  onToggle,
  onView,
  ticketTypes,
  eventTimezone,
  walletPlatforms,
  walletColumnVisible,
}: AttendeeTableRowProps) {
  const identity = rowIdentity(row, eventTimezone);
  const className = [
    "attendees-table-v2__row",
    selected && "attendees-table-v2__row--selected",
    identity.erased && "attendees-table-v2__row--erased",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <tr className={className}>
      <td>
        <Checkbox
          checked={selected}
          disabled={identity.erased}
          onChange={onToggle}
          aria-label={selectRowLabel(row)}
        />
      </td>
      <td>
        <button type="button" className="attendees-row-btn attendees-table-v2__attendee" onClick={onView}>
          <span className="attendees-table-v2__name" title={identity.name}>
            {identity.name}
            {identity.erased && <ErasedBadge />}
          </span>
          <span
            className={`attendees-table-v2__email${identity.erased ? " attendees-table-v2__email--note" : ""}`}
            title={identity.detail}
          >
            {identity.detail}
          </span>
        </button>
      </td>
      <td>
        <div className="attendees-table-v2__company">
          <span>{row.company ?? "-"}</span>
          {row.department ? <span className="attendees-table-v2__department">{row.department}</span> : null}
        </div>
      </td>
      <td>
        <TicketTypeBadge ticketType={row.ticket_type} catalog={ticketTypes} />
      </td>
      <td>
        <PassStatusBadge status={row.status} />
      </td>
      <td>
        <RsvpStatusBadge status={row.rsvp_status} />
      </td>
      <td>
        <MailStatusBadge status={row.last_mail_status} />
      </td>
      <td>
        <CheckInCell admittedAt={row.admitted_at} eventTimezone={eventTimezone} />
      </td>
      {walletColumnVisible && (
        <td>
          <WalletColumnCell status={row.wallet_status} enabledPlatforms={walletPlatforms} />
        </td>
      )}
    </tr>
  );
}

type AttendeesListContentProps = Readonly<{
  /** Rows the list had last time for this event (null if unknown): the skeleton is drawn that size. */
  rememberedRows: number | null;
  loading: boolean;
  hasLoadedOnce: boolean;
  items: AttendeeRowDto[];
  isDesktop: boolean;
  isUnfilteredEmpty: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleSelectAll: () => void;
  onViewAttendee: (id: string) => void;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
  onSortChange: (column: AttendeeSortBy) => void;
  ticketTypes: TicketTypeDto[];
  eventTimezone: string;
  walletPlatforms: EnabledWalletPlatforms;
}>;

/** Desktop table, mobile card list (with its own "Select all" row, since there's no header
 * checkbox to reuse), the empty state, or the loading skeleton — whichever applies.
 *
 * Two waits, each behind `useLoadingGate` (indicator after 200ms, at least 400ms once shown):
 * - the very first load ever (never-loaded, items always [] at that point) shows the skeleton. Until
 *   its 200ms have passed the skeleton is in the page but invisible, so the space is already
 *   reserved and nothing jumps when it appears or when the rows replace it. A later filter/search
 *   that also lands on zero matches is a refetch, not a first load, and never flashes the skeleton.
 * - every later fetch keeps the rows on screen: clicks are blocked at once (stale rows must not be
 *   acted on), and after 200ms the rows are dimmed and a thin bar runs along the top of the list. */
function AttendeesListContent(props: AttendeesListContentProps): ReactNode {
  const { loading, hasLoadedOnce, isDesktop, walletPlatforms, rememberedRows } = props;
  const firstLoad = useLoadingGate(loading && !hasLoadedOnce);
  const firstLoadSlow = useDelayedLoading(loading && !hasLoadedOnce, SLOW_NOTICE_MS);
  const refetch = useLoadingGate(loading && hasLoadedOnce);

  if (!firstLoad.showContent) {
    return (
      <div key="skeleton" className={firstLoad.showIndicator ? "at-fade-in" : "at-loading-hold"}>
        {isDesktop ? (
          <AttendeesTableSkeleton
            walletColumnVisible={hasWalletColumn(walletPlatforms)}
            rows={Math.max(1, rememberedRows ?? DEFAULT_TABLE_SKELETON_ROWS)}
            slow={firstLoadSlow}
          />
        ) : (
          <AttendeesCardsSkeleton rows={Math.max(1, rememberedRows ?? DEFAULT_CARDS_SKELETON_ROWS)} slow={firstLoadSlow} />
        )}
      </div>
    );
  }

  return (
    <div key="content" className="attendees-list-region at-fade-in">
      <TopProgressBar active={refetch.showIndicator} placement="container" label="Refreshing attendees" />
      <AttendeesListRows {...props} busy={loading} dimmed={refetch.showIndicator} />
    </div>
  );
}

function AttendeesListRows({
  busy,
  dimmed,
  items,
  isDesktop,
  isUnfilteredEmpty,
  selectedIds,
  onToggleRow,
  onToggleSelectAll,
  onViewAttendee,
  sortBy,
  sortDir,
  onSortChange,
  ticketTypes,
  eventTimezone,
  walletPlatforms,
}: Readonly<
  Omit<AttendeesListContentProps, "loading" | "hasLoadedOnce" | "rememberedRows"> & {
    /** A fetch is in flight: block clicks on the stale rows and mark the list busy. */
    busy: boolean;
    /** The fetch has taken long enough (see `useLoadingGate`) to dim the stale rows. */
    dimmed: boolean;
  }
>): ReactNode {
  const walletColumnVisible = hasWalletColumn(walletPlatforms);
  const loadingClass = [busy && " attendees-table-wrap--loading", dimmed && " attendees-table-wrap--dim"]
    .filter(Boolean)
    .join("");
  if (items.length === 0) {
    return (
      <div className={`attendees-table-wrap attendees-list-table-wrap${loadingClass}`} aria-busy={busy}>
        {isUnfilteredEmpty ? (
          <EmptyState
            icon={<i className="ti ti-users" aria-hidden="true" />}
            title="No attendees yet"
            description="Import a CSV or XLSX file, or add attendees one at a time."
          />
        ) : (
          <EmptyState
            icon={<i className="ti ti-search-off" aria-hidden="true" />}
            title="No matches"
            description="Try a different search, or clear your filters."
          />
        )}
      </div>
    );
  }

  // An erased entry cannot be selected, so "all" means every row that can be.
  const selectable = items.filter((row) => !row.erased_at);
  const allSelected = selectable.length > 0 && selectable.every((row) => selectedIds.has(row.id));
  const nothingSelectable = selectable.length === 0;

  if (!isDesktop) {
    return (
      <div className={`attendees-cards${loadingClass}`} aria-busy={busy}>
        <div className="attendees-cards__selectall">
          <Checkbox label="Select all" checked={allSelected} disabled={nothingSelectable} onChange={onToggleSelectAll} />
        </div>
        {items.map((row) => (
          <AttendeeCard
            key={row.id}
            row={row}
            selected={selectedIds.has(row.id)}
            onToggle={() => onToggleRow(row.id)}
            onView={() => onViewAttendee(row.id)}
            ticketTypes={ticketTypes}
            eventTimezone={eventTimezone}
            walletPlatforms={walletPlatforms}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`attendees-table-wrap attendees-list-table-wrap${loadingClass}`} aria-busy={busy}>
      <table className="table attendees-table-v2">
        <thead>
          <tr>
            <th className="attendees-table-v2__checkbox-col">
              <Checkbox checked={allSelected} disabled={nothingSelectable} onChange={onToggleSelectAll} aria-label="Select all" />
            </th>
            {SORTABLE_COLUMNS.map(({ column, label }) => (
              <SortableHeader
                key={column}
                column={column}
                label={label}
                sortBy={sortBy}
                sortDir={sortDir}
                onSortChange={onSortChange}
              />
            ))}
            <th>Mail</th>
            <SortableHeader
              column="admitted_at"
              label="Check-in"
              sortBy={sortBy}
              sortDir={sortDir}
              onSortChange={onSortChange}
            />
            {walletColumnVisible && <th>Wallet</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <AttendeeTableRow
              key={row.id}
              row={row}
              selected={selectedIds.has(row.id)}
              onToggle={() => onToggleRow(row.id)}
              onView={() => onViewAttendee(row.id)}
              ticketTypes={ticketTypes}
              eventTimezone={eventTimezone}
              walletPlatforms={walletPlatforms}
              walletColumnVisible={walletColumnVisible}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "0 attendees" is a confirmed-empty claim, not a loading placeholder — it must never render
 * while the first fetch (which "total" hasn't been set from yet) is still in flight. The list above
 * already shows the skeleton then, so the count stays empty instead of repeating it as text. */
function footSummary(isInitialLoad: boolean, total: number, from: number, to: number): string {
  if (isInitialLoad) return "";
  if (total === 0) return "0 attendees";
  return `Showing ${from}–${to} of ${total}`;
}

/**
 * Says out loud, the moment it happens, that a catalog the filters and bulk actions depend on (ticket types,
 * custom fields, items) failed to load. Their visible hints are inside the Filters panel, which only exists while
 * it is open, and in the tooltip of a disabled menu item, so without this a failure at page entry is silent.
 * Always mounted, so a message added to it is announced; visually hidden, because the hints stay where the
 * operator can act on them. (`CheckinConnectionLiveRegion` is the same idea for the check-in screen.) A retry
 * that ends with the same failure mounts it afresh, so it is announced again whichever Retry was pressed.
 */
function CatalogFailureAnnouncer({
  ticketTypes,
  customFields,
  items,
}: Readonly<{
  ticketTypes: { error?: string | null; retrying?: boolean };
  customFields: { error?: string | null; retrying?: boolean };
  items: { error?: string | null; retrying?: boolean };
}>) {
  const retriesEnded =
    useBusyEndCount(ticketTypes.retrying ?? false) +
    useBusyEndCount(customFields.retrying ?? false) +
    useBusyEndCount(items.retrying ?? false);
  const message = [ticketTypes.error, customFields.error, items.error].filter(Boolean).join(" ");
  return (
    <div key={retriesEnded} className="sr-only" role="alert">
      {message}
    </div>
  );
}

export function AttendeesTable({
  items,
  total,
  page,
  pageSize,
  loading,
  hasLoadedOnce,
  isUnfilteredEmpty,
  searchInput,
  statusFilter,
  ticketTypeFilter,
  rsvpStatusFilter,
  mailStatusFilter,
  ticketTypes = [],
  ticketTypesError,
  onRetryTicketTypes,
  ticketTypesRetrying,
  customFields = [],
  customFieldsError,
  onRetryCustomFields,
  customFieldsRetrying,
  customFieldSelectValues,
  onCustomFieldSelectChange,
  customFieldTextInputs,
  onCustomFieldTextInputChange,
  onSearchChange,
  onStatusFilterChange,
  onTicketTypeFilterChange,
  onRsvpStatusFilterChange,
  onMailStatusFilterChange,
  sortBy,
  sortDir,
  onSortChange,
  onViewAttendee,
  onPageChange,
  onPageSizeChange,
  selectedIds,
  onToggleRow,
  onToggleSelectAll,
  onClearSelection,
  onBulkSendTickets,
  bulkSendBusy,
  canBulkSend,
  onBulkCheckIn,
  bulkCheckInBusy,
  onBulkRevokeCheckIn,
  bulkRevokeCheckInBusy,
  onBulkExportSelected,
  bulkExportBusy,
  onBulkChangeTicketType,
  onBulkChangeRsvpStatus,
  onBulkSetCompany,
  onBulkSetDepartment,
  itemCount,
  itemsError,
  onRetryItems,
  itemsRetrying,
  onBulkRevokeItems,
  bulkRevokeItemsBusy,
  onBulkRevokePass,
  bulkRevokePassBusy,
  onBulkVoidWallet,
  bulkVoidWalletBusy,
  onBulkReissueWallet,
  bulkReissueWalletBusy,
  onBulkRefreshWalletStatus,
  bulkRefreshWalletStatusBusy,
  onBulkDeleteWallet,
  bulkDeleteWalletBusy,
  onBulkRemoveWallet,
  bulkRemoveWalletBusy,
  onBulkDelete,
  onBulkErase,
  erasedCount,
  showErased,
  onShowErasedChange,
  eventTimezone,
  eventId,
  event,
  walletPlatforms,
  walletConfigured,
}: Readonly<AttendeesTableProps>) {
  // Wider than the shared 768px breakpoint (used elsewhere in this file for button-label
  // fit, unaffected): the table itself needs ~950-975px min-width for its 7 columns, which
  // used to force this all the way out to 1280px — 1024px (the tablet-rail sidebar's own
  // split, staff.css) left the table ~90px short, and 1025-1279px used to be worse still,
  // since past the rail breakpoint the sidebar switched to its ~240px always-expanded
  // desktop width there. Fixed at the source instead of compressing the table down to fit
  // that narrow 1025-1279px band: the rail now spans 768-1279px (shell.css), so the sidebar
  // never widens past 72px until there's already enough room for the table. That leaves a
  // single, continuous ~88px shortfall right at this 1024px floor (887px available vs the
  // table's 975px), closed with attendees.css's own compressed-table rules below this
  // breakpoint (tighter cell padding, truncated email) instead of needing a wider floor.
  const isDesktop = useIsDesktop(1024);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const selectedRows = items.filter((row) => selectedIds.has(row.id));
  // "Check in" is a no-op once every selected attendee is already admitted - disabled rather
  // than left clickable into a toast that just says so (PO review, #522 follow-up). A mixed
  // selection stays enabled: there's still real work for the not-yet-admitted ones, and the
  // bulk endpoint already reports "N already checked in" for those, same as today.
  const allSelectedAdmitted =
    selectedRows.length > 0 && selectedRows.every((row) => row.check_in_status === "admitted");
  const anySelectedAdmitted = selectedRows.some((row) => row.check_in_status === "admitted");
  // How many of the selection "Revoke check-in" would actually affect - the More actions menu's
  // hint text shows this instead of the raw selection size (PO review: a mixed selection was
  // claiming to undo check-in for attendees who were never checked in to begin with).
  const admittedSelectedCount = selectedRows.filter((row) => row.check_in_status === "admitted").length;
  // "Revoke items" hint reports how many of the selection actually have something issued, not
  // the raw selection size (PO review) — mirrors "Revoke check-in"/"Revoke pass" reporting only
  // the attendees they'd actually affect. A blocked-pass attendee is excluded even if
  // has_issued_items is true: the server's own isAdmittable guard refuses to reset their items
  // (CodeRabbit review).
  const revokableItemsCount = selectedRows.filter(
    (row) => row.has_issued_items && row.status !== "cancelled" && row.status !== "revoked",
  ).length;
  // "Revoke items" is a no-op once nothing in the selection has anything issued - disabled
  // rather than left clickable into a confirm dialog reporting "0 attendees" (CodeRabbit/PO
  // review: was only gated on the event's catalog size via itemCount, not the selection).
  const canRevokeItems = revokableItemsCount > 0;
  // "Revoke pass" is a no-op once every selected attendee is already revoked/cancelled -
  // disabled rather than left clickable into a confirm dialog that just reports nothing
  // changed, same "nothing to do" gate as "Revoke check-in" (PO review follow-up, #549). A
  // mixed selection stays enabled: there's still real work for the still-active ones.
  const anySelectedPassActive = selectedRows.some(
    (row) => row.status !== "cancelled" && row.status !== "revoked",
  );
  // How many of the selection actually have an active pass to revoke - shown in the "Revoke
  // pass" menu item's hint instead of the raw selection size, so a mixed selection doesn't
  // overstate the impact (PO review follow-up, #549).
  const activeSelectedPassCount = selectedRows.filter(
    (row) => row.status !== "cancelled" && row.status !== "revoked",
  ).length;
  // "Void wallet pass"/"Reissue wallet pass" are no-ops once nothing in the selection has ever
  // added a wallet pass - the row list only knows whether a WalletPass row exists at all, not
  // its exact provider status (active vs already-voided), so an already-voided pass still
  // counts here and is skipped server-side instead (reported in the result toast).
  const walletPassCount = selectedRows.filter((row) => row.wallet_status !== null).length;
  const canBulkWallet = walletPassCount > 0;
  // isInitialLoad gates footSummary's 3-way branch so a fast response never renders "0 attendees"
  // against a "total" that hasn't been set from a real response yet.
  const isInitialLoad = loading && items.length === 0;
  // The skeleton is drawn as many rows as this event's list had last time, so the list does not change
  // size when the real rows replace it. Read once per event; written whenever a load has finished.
  const rememberedRows = useMemo(() => readRememberedRowCount(eventId), [eventId]);
  useEffect(() => {
    if (hasLoadedOnce && !loading) rememberRowCount(eventId, items.length);
  }, [eventId, hasLoadedOnce, loading, items.length]);

  return (
    <Card padded={false}>
      <CatalogFailureAnnouncer
        ticketTypes={{ error: ticketTypesError, retrying: ticketTypesRetrying }}
        customFields={{ error: customFieldsError, retrying: customFieldsRetrying }}
        items={{ error: itemsError, retrying: itemsRetrying }}
      />
      {selectedIds.size > 0 ? (
        <BulkBar
          selectedIds={selectedIds}
          onClearSelection={onClearSelection}
          event={event}
          bulkSendBusy={bulkSendBusy}
          canBulkSend={canBulkSend}
          onBulkSendTickets={onBulkSendTickets}
          bulkCheckInBusy={bulkCheckInBusy}
          onBulkCheckIn={onBulkCheckIn}
          checkInDisabled={allSelectedAdmitted}
          onBulkRevokeCheckIn={onBulkRevokeCheckIn}
          bulkRevokeCheckInBusy={bulkRevokeCheckInBusy}
          canRevokeCheckIn={anySelectedAdmitted}
          revokableCheckInCount={admittedSelectedCount}
          bulkExportBusy={bulkExportBusy}
          onBulkExportSelected={onBulkExportSelected}
          ticketTypes={ticketTypes}
          ticketTypesError={ticketTypesError}
          onRetryTicketTypes={onRetryTicketTypes}
          onBulkChangeTicketType={onBulkChangeTicketType}
          onBulkChangeRsvpStatus={onBulkChangeRsvpStatus}
          onBulkSetCompany={onBulkSetCompany}
          onBulkSetDepartment={onBulkSetDepartment}
          itemCount={itemCount}
          revokableItemsCount={revokableItemsCount}
          canRevokeItems={canRevokeItems}
          itemsError={itemsError}
          onRetryItems={onRetryItems}
          onBulkRevokeItems={onBulkRevokeItems}
          bulkRevokeItemsBusy={bulkRevokeItemsBusy}
          onBulkRevokePass={onBulkRevokePass}
          bulkRevokePassBusy={bulkRevokePassBusy}
          canRevokePass={anySelectedPassActive}
          revokablePassCount={activeSelectedPassCount}
          onBulkVoidWallet={onBulkVoidWallet}
          bulkVoidWalletBusy={bulkVoidWalletBusy}
          onBulkReissueWallet={onBulkReissueWallet}
          bulkReissueWalletBusy={bulkReissueWalletBusy}
          onBulkRefreshWalletStatus={onBulkRefreshWalletStatus}
          bulkRefreshWalletStatusBusy={bulkRefreshWalletStatusBusy}
          onBulkDeleteWallet={onBulkDeleteWallet}
          bulkDeleteWalletBusy={bulkDeleteWalletBusy}
          onBulkRemoveWallet={onBulkRemoveWallet}
          bulkRemoveWalletBusy={bulkRemoveWalletBusy}
          canBulkWallet={canBulkWallet}
          walletPassCount={walletPassCount}
          walletPlatforms={walletPlatforms}
          walletConfigured={walletConfigured}
          onBulkDelete={onBulkDelete}
          onBulkErase={onBulkErase}
        />
      ) : (
        <FilterToolbar
          searchInput={searchInput}
          onSearchChange={onSearchChange}
          statusFilter={statusFilter}
          onStatusFilterChange={onStatusFilterChange}
          ticketTypeFilter={ticketTypeFilter}
          onTicketTypeFilterChange={onTicketTypeFilterChange}
          ticketTypes={ticketTypes}
          ticketTypesError={ticketTypesError}
          onRetryTicketTypes={onRetryTicketTypes}
          ticketTypesRetrying={ticketTypesRetrying}
          rsvpStatusFilter={rsvpStatusFilter}
          onRsvpStatusFilterChange={onRsvpStatusFilterChange}
          mailStatusFilter={mailStatusFilter}
          onMailStatusFilterChange={onMailStatusFilterChange}
          customFields={customFields}
          customFieldsError={customFieldsError}
          onRetryCustomFields={onRetryCustomFields}
          customFieldsRetrying={customFieldsRetrying}
          customFieldSelectValues={customFieldSelectValues}
          onCustomFieldSelectChange={onCustomFieldSelectChange}
          customFieldTextInputs={customFieldTextInputs}
          onCustomFieldTextInputChange={onCustomFieldTextInputChange}
          isDesktop={isDesktop}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={onSortChange}
        />
      )}
      <AttendeesListContent
        rememberedRows={rememberedRows}
        loading={loading}
        hasLoadedOnce={hasLoadedOnce}
        items={items}
        isDesktop={isDesktop}
        isUnfilteredEmpty={isUnfilteredEmpty}
        selectedIds={selectedIds}
        onToggleRow={onToggleRow}
        onToggleSelectAll={onToggleSelectAll}
        onViewAttendee={onViewAttendee}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={onSortChange}
        ticketTypes={ticketTypes}
        eventTimezone={eventTimezone}
        walletPlatforms={walletPlatforms}
      />
      <ErasedEntriesBar count={erasedCount} shown={showErased} onShownChange={onShowErasedChange} />
      <div className="attendees-table-foot">
        <div className="attendees-table-foot__summary">
          <span>{footSummary(isInitialLoad, total, from, to)}</span>
          <div className="attendees-table-foot__pagesize">
            <label htmlFor="attendees-rows-per-page">Rows per page</label>
            <SearchableSelect
              id="attendees-rows-per-page"
              label="Rows per page"
              placeholder="Rows per page"
              searchPlaceholder="Search page sizes…"
              emptyLabel="No page sizes found"
              showLabel={false}
              minWidth={72}
              value={String(pageSize)}
              options={[10, 25, 50, 100].map((n) => ({ id: String(n), label: String(n) }))}
              onChange={(id) => onPageSizeChange(Number(id))}
            />
          </div>
        </div>
        <div className="attendees-table-foot__pager">
          {/* aria-disabled, never disabled (the same rule as PaginationFooter): the button just pressed turns off
              while the next page loads, and at the end of the list, on the same commit, and a browser drops the
              focus of a button that becomes disabled. Button swallows the click of an aria-disabled button. */}
          <Button
            variant="secondary"
            size="sm"
            aria-disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </Card>
  );
}
