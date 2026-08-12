import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  ModalBackdrop,
  Notice,
  PageHeader,
  resolveStatusMeta,
  Skeleton,
  Tabs,
  Tooltip,
  useToast,
  type BadgeProps,
} from "@admitto/ui";
import {
  addAttendeeNote,
  ApiError,
  bulkRevokeItems,
  deleteAttendee,
  deleteAttendeeNote,
  fetchAttendeeDetail,
  fetchTicketTypes,
  reissueWalletPass,
  resendTicket,
  restoreWalletPass,
  revokeAttendeeCheckIn,
  updateAttendee,
  updateAttendeeNote,
  voidWalletPass,
  type EventFullMeta,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AttendeeDetailDto, DeliveryDto, EventDto, NoteAuthorRole, RsvpStatus, TicketTypeDto, UpdateAttendeePatch, WalletPassActionDto } from "../api/types.js";
import {
  loadAttendeeDetailData,
  mergeFormAfterReload,
  toAttendeeForm,
  type AttendeeFormState,
} from "../attendees/attendeeDetailForm.js";
import { useDelayedLoading, whenShown } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { formatAdmissionDisplayParts, formatEventDateTime, getBrowserTimeZone } from "../utils/event-dates.js";
import {
  deriveAttendeeSource,
  getTimelineActor,
  getTimelineDetail,
  getTimelineIcon,
  getTimelineLabel,
  getTimelineTone,
  formatActivityTimestamp,
  humanizeFieldKey,
} from "../attendees/attendeeTimeline.js";
import { MailStatusBadge } from "../attendees/mailStatusBadge.js";
import { PassStatusBadge } from "../attendees/passStatusBadge.js";
import { RSVP_STATUS_OPTIONS, RsvpStatusBadge } from "../attendees/rsvpStatusBadge.js";
import { WalletStatusBadge } from "../attendees/walletStatusBadge.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";
import { CustomDataFieldInput } from "../attendees/CustomDataFieldInput.js";
import {
  allCustomDataEntries,
  readCustomDataField,
  validateCustomFieldsForm,
} from "../attendees/customData.js";
import type { CustomDataFieldDef } from "../attendees/customData.js";
import { useMailConfigured } from "../attendees/useMailConfigured.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  ArchivedGuard,
  ARCHIVED_ACTION_TOOLTIP,
  isEventArchived,
  type ArchivedGuardEvent,
} from "../components/ArchivedGuard.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { canRevokeCheckIn } from "../checkin/revokeEligibility.js";
import { formatDeliveryHistoryTime, deliveryHistoryIcon, rowTimestamp, countDeliveryOutcomes } from "../communication/delivery-format.js";
import { DeliveryRowMenu } from "../communication/DeliveryRowMenu.js";
import { SentMessagePreviewModal } from "../communication/SentMessagePreviewModal.js";
import { DeliveryDetailsModal } from "../communication/DeliveryDetailsModal.js";
import { NO_AUTOFILL_PROPS } from "../settings/mailTransportFormParts.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isOrgAdmin, isSuperadmin } from "../auth/capabilities.js";
import "../attendees/attendees.css";

type TabId = "overview" | "activity" | "notes";
type ActiveRevokeAction = "pass" | "checkin" | "items" | "restore" | null;
type ActiveWalletAction = "void" | "restore" | "reissue" | null;

/** Secondary actions that don't need their own header button - Resend ticket always, plus Edit
 * once folded in here below the mobile breakpoint (see `showEdit`) and Revoke check-in/items/pass
 * once grouped here on every viewport (see `RevokeActionMenuItems`) - matching the design mockup's
 * "More actions" menu (which also groups actions this page doesn't have yet, e.g. attendee
 * removal, tracked separately by #356). The trigger's own `disabled` is the archived lock
 * (blocks the whole menu); "Resend ticket" additionally gets its own disabled+tooltip when the
 * event has no working mail transport - same check and copy as the Attendees list's "Send
 * tickets" button, but scoped to just this one item since future menu entries (e.g. #356) may
 * have nothing to do with mail. Every item also carries a short hint line, same
 * `.more-actions-menu__item-text`/`.more-actions-menu__item-hint` pattern as the Attendees
 * list's bulk menu (PO report: this menu's items had no descriptions). */
function MoreActionsMenu({
  event,
  onResend,
  onDelete,
  mailConfigured,
  showEdit,
  onEdit,
  canRevokeCheckIn,
  revokeCheckInTooltip,
  canRevokeItems,
  revokeItemsTooltip,
  isRevoked,
  revokeBusy,
  onRevokeCheckIn,
  onRevokeItems,
  onRestorePass,
  onRevokePass,
  walletPass,
  walletBusy,
  onVoidWallet,
  onRestoreWallet,
  onReissueWallet,
}: Readonly<{
  event: ArchivedGuardEvent;
  onResend: () => void;
  onDelete: () => void;
  mailConfigured: boolean | undefined;
  /** Mobile only (useIsDesktop() in the caller) - narrow viewports fold the standalone Edit
   * button in here instead, the same "own button on desktop, menu item on mobile" move already
   * used for the Attendees list's Import/Send tickets (PO report: not enough header width for
   * every button at once, on this page specifically Edit + Revoke/Restore + More + Back). */
  showEdit: boolean;
  onEdit: () => void;
  canRevokeCheckIn: boolean;
  revokeCheckInTooltip?: string;
  canRevokeItems: boolean;
  revokeItemsTooltip?: string;
  isRevoked: boolean;
  revokeBusy: boolean;
  onRevokeCheckIn: () => void;
  onRevokeItems: () => void;
  onRestorePass: () => void;
  onRevokePass: () => void;
  walletPass: WalletPassActionDto | null;
  walletBusy: boolean;
  onVoidWallet: () => void;
  onRestoreWallet: () => void;
  onReissueWallet: () => void;
}>) {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
  });

  return (
    <div className="more-actions-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        icon={<i className="ti ti-dots-vertical" aria-hidden="true" />}
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        More actions
      </Button>
      {open && (
        <div className="more-actions-menu__panel" role="menu" ref={panelRef} style={panelStyle}>
          {showEdit && (
            <>
              <ArchivedGuard event={event} reasonId="edit-profile-reason-menu">
                {(guard) => (
                  <button
                    type="button"
                    role="menuitem"
                    className="more-actions-menu__item"
                    {...guard}
                    onClick={() => {
                      setOpen(false);
                      onEdit();
                    }}
                  >
                    <i className="ti ti-pencil" aria-hidden="true" />
                    <span className="more-actions-menu__item-text">
                      <span>Edit</span>
                      <span className="more-actions-menu__item-hint">Update this attendee&rsquo;s profile</span>
                    </span>
                  </button>
                )}
              </ArchivedGuard>
              <hr className="more-actions-menu__divider" />
            </>
          )}
          <ArchivedGuard
            event={event}
            reasonId="resend-ticket-mail-reason"
            disabled={mailConfigured === false}
            tooltip={
              mailConfigured === false
                ? "No mail transport configured for this event. Set one up in Event Settings → Mailing."
                : undefined
            }
          >
            {(guard) => (
              <button
                type="button"
                role="menuitem"
                className="more-actions-menu__item"
                {...guard}
                onClick={() => {
                  setOpen(false);
                  onResend();
                }}
              >
                <i className="ti ti-send" aria-hidden="true" />
                <span className="more-actions-menu__item-text">
                  <span>Resend ticket</span>
                  <span className="more-actions-menu__item-hint">Send the ticket email again</span>
                </span>
              </button>
            )}
          </ArchivedGuard>
          <hr className="more-actions-menu__divider" />
          <RevokeActionMenuItems
            event={event}
            canRevokeCheckIn={canRevokeCheckIn}
            revokeCheckInTooltip={revokeCheckInTooltip}
            canRevokeItems={canRevokeItems}
            revokeItemsTooltip={revokeItemsTooltip}
            isRevoked={isRevoked}
            revokeBusy={revokeBusy}
            onRevokeCheckIn={() => {
              setOpen(false);
              onRevokeCheckIn();
            }}
            onRevokeItems={() => {
              setOpen(false);
              onRevokeItems();
            }}
            onRestorePass={() => {
              setOpen(false);
              onRestorePass();
            }}
            onRevokePass={() => {
              setOpen(false);
              onRevokePass();
            }}
          />
          {/* Own divider only when the group itself renders something (walletPass in an
              active/voided state) - an unconditional one here would leave an empty gap between
              two adjacent dividers whenever the attendee has no wallet pass yet (bot review). */}
          {walletPass && (walletPass.status === "active" || walletPass.status === "voided") && (
            <>
              <hr className="more-actions-menu__divider" />
              <WalletActionMenuItems
                event={event}
                walletPass={walletPass}
                walletBusy={walletBusy}
                onVoid={() => {
                  setOpen(false);
                  onVoidWallet();
                }}
                onRestore={() => {
                  setOpen(false);
                  onRestoreWallet();
                }}
                onReissue={() => {
                  setOpen(false);
                  onReissueWallet();
                }}
              />
            </>
          )}
          <hr className="more-actions-menu__divider" />
          {/* Not ArchivedGuard'd, unlike Resend ticket above — GDPR erasure requests can
           * legally arrive after an event ends, and the DELETE endpoint itself doesn't block
           * on archived_at (see docs/DSAR-PROCEDURE.md). */}
          <button
            type="button"
            role="menuitem"
            className="more-actions-menu__item more-actions-menu__item--danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <i className="ti ti-trash" aria-hidden="true" />
            <span className="more-actions-menu__item-text">
              <span>Delete attendee</span>
              <span className="more-actions-menu__item-hint">Permanently remove this attendee</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The reversible attendee actions share one contiguous menu group directly above deletion.
 * Extracted from AttendeeDetailPage so the menu stays a stable component instead of being
 * recreated by an inline render callback on every page render. */
function RevokeActionMenuItems({
  event,
  canRevokeCheckIn,
  revokeCheckInTooltip,
  canRevokeItems,
  revokeItemsTooltip,
  isRevoked,
  revokeBusy,
  onRevokeCheckIn,
  onRevokeItems,
  onRestorePass,
  onRevokePass,
}: Readonly<{
  event: ArchivedGuardEvent;
  canRevokeCheckIn: boolean;
  revokeCheckInTooltip?: string;
  canRevokeItems: boolean;
  revokeItemsTooltip?: string;
  isRevoked: boolean;
  revokeBusy: boolean;
  onRevokeCheckIn: () => void;
  onRevokeItems: () => void;
  onRestorePass: () => void;
  onRevokePass: () => void;
}>) {
  return (
    <>
      <ArchivedGuard
        event={event}
        reasonId="revoke-checkin-reason-menu"
        disabled={!canRevokeCheckIn || revokeBusy}
        tooltip={revokeCheckInTooltip}
      >
        {(guard) => (
          <button
            type="button"
            role="menuitem"
            className="more-actions-menu__item more-actions-menu__item--warning"
            {...guard}
            onClick={onRevokeCheckIn}
          >
            <i className="ti ti-qrcode-off" aria-hidden="true" />
            <span className="more-actions-menu__item-text">
              <span>Revoke check-in</span>
              <span className="more-actions-menu__item-hint">Undo this attendee&rsquo;s check-in</span>
            </span>
          </button>
        )}
      </ArchivedGuard>
      <ArchivedGuard
        event={event}
        reasonId="revoke-items-reason-menu"
        disabled={!canRevokeItems || revokeBusy}
        tooltip={revokeItemsTooltip}
      >
        {(guard) => (
          <button
            type="button"
            role="menuitem"
            className="more-actions-menu__item more-actions-menu__item--warning"
            {...guard}
            onClick={onRevokeItems}
          >
            <i className="ti ti-package" aria-hidden="true" />
            <span className="more-actions-menu__item-text">
              <span>Revoke items</span>
              <span className="more-actions-menu__item-hint">Reset issued items to pending</span>
            </span>
          </button>
        )}
      </ArchivedGuard>
      {isRevoked ? (
        <ArchivedGuard event={event} reasonId="restore-pass-reason-menu" disabled={revokeBusy}>
          {(guard) => (
            <button type="button" role="menuitem" className="more-actions-menu__item" {...guard} onClick={onRestorePass}>
              <i className="ti ti-refresh" aria-hidden="true" />
              <span className="more-actions-menu__item-text">
                <span>Restore pass</span>
                <span className="more-actions-menu__item-hint">Re-enable check-in for this attendee</span>
              </span>
            </button>
          )}
        </ArchivedGuard>
      ) : (
        <ArchivedGuard event={event} reasonId="revoke-pass-reason-menu">
          {(guard) => (
            <button
              type="button"
              role="menuitem"
              className="more-actions-menu__item more-actions-menu__item--danger"
              {...guard}
              onClick={onRevokePass}
            >
              <i className="ti ti-ban" aria-hidden="true" />
              <span className="more-actions-menu__item-text">
                <span>Revoke pass</span>
                <span className="more-actions-menu__item-hint">Block check-in for this attendee</span>
              </span>
            </button>
          )}
        </ArchivedGuard>
      )}
    </>
  );
}

/** Void/Restore/Reissue only make sense once the attendee has actually added a pass to a wallet
 * (walletPass null until their first "Add to Wallet" click succeeds or fails) - nothing renders
 * before then, matching RevokeActionMenuItems' own toggle-by-state shape above. Reissue stays
 * available in both active and voided states (it only pushes fresh data, independent of void
 * state); Void/Restore toggle the same way Revoke/Restore pass do above. */
function WalletActionMenuItems({
  event,
  walletPass,
  walletBusy,
  onVoid,
  onRestore,
  onReissue,
}: Readonly<{
  event: ArchivedGuardEvent;
  walletPass: WalletPassActionDto | null;
  walletBusy: boolean;
  onVoid: () => void;
  onRestore: () => void;
  onReissue: () => void;
}>) {
  if (!walletPass || (walletPass.status !== "active" && walletPass.status !== "voided")) return null;

  return (
    <>
      {walletPass.status === "active" ? (
        <ArchivedGuard event={event} reasonId="void-wallet-pass-reason-menu" disabled={walletBusy}>
          {(guard) => (
            <button
              type="button"
              role="menuitem"
              className="more-actions-menu__item more-actions-menu__item--warning"
              {...guard}
              onClick={onVoid}
            >
              <i className="ti ti-wallet-off" aria-hidden="true" />
              <span className="more-actions-menu__item-text">
                <span>Void wallet pass</span>
                <span className="more-actions-menu__item-hint">Show as invalid in Apple/Google Wallet</span>
              </span>
            </button>
          )}
        </ArchivedGuard>
      ) : (
        <ArchivedGuard event={event} reasonId="restore-wallet-pass-reason-menu" disabled={walletBusy}>
          {(guard) => (
            <button
              type="button"
              role="menuitem"
              className="more-actions-menu__item"
              {...guard}
              onClick={onRestore}
            >
              <i className="ti ti-refresh" aria-hidden="true" />
              <span className="more-actions-menu__item-text">
                <span>Restore wallet pass</span>
                <span className="more-actions-menu__item-hint">Show as valid again in Apple/Google Wallet</span>
              </span>
            </button>
          )}
        </ArchivedGuard>
      )}
      <ArchivedGuard event={event} reasonId="reissue-wallet-pass-reason-menu" disabled={walletBusy}>
        {(guard) => (
          <button type="button" role="menuitem" className="more-actions-menu__item" {...guard} onClick={onReissue}>
            <i className="ti ti-refresh-dot" aria-hidden="true" />
            <span className="more-actions-menu__item-text">
              <span>Reissue wallet pass</span>
              <span className="more-actions-menu__item-hint">Push the current name/ticket type/event details</span>
            </span>
          </button>
        )}
      </ArchivedGuard>
    </>
  );
}

/** Small "..." menu in the Wallet card's header - copies the pass's Apple/Google install link to
 * the clipboard rather than opening it (PO review: an admin has no reason to open the install
 * page themselves, only to hand the link to someone else). Renders nothing once neither link
 * exists yet (no wallet pass, or a provider that never returned one of the two). */
function WalletLinksMenu({
  appleUrl,
  androidUrl,
}: Readonly<{ appleUrl: string | null; androidUrl: string | null }>) {
  const { addToast } = useToast();
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
  });

  if (!appleUrl && !androidUrl) return null;

  async function copyLink(url: string, label: string) {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(url);
      addToast(`${label} link copied to clipboard`, "success");
    } catch {
      addToast("Could not copy. Clipboard access was blocked.", "error");
    }
  }

  return (
    <div className="more-actions-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="at-iconbtn at-iconbtn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Wallet pass links"
        onClick={() => setOpen((o) => !o)}
      >
        <i className="ti ti-dots-vertical" aria-hidden="true" />
      </button>
      {open && (
        <div className="more-actions-menu__panel" role="menu" ref={panelRef} style={panelStyle}>
          {appleUrl && (
            <button
              type="button"
              role="menuitem"
              className="more-actions-menu__item"
              onClick={() => void copyLink(appleUrl, "Apple Wallet")}
            >
              <i className="ti ti-brand-apple" aria-hidden="true" />
              <span className="more-actions-menu__item-text">
                <span>Copy Apple Wallet link</span>
                <span className="more-actions-menu__item-hint">Install link for this attendee's pass</span>
              </span>
            </button>
          )}
          {androidUrl && (
            <button
              type="button"
              role="menuitem"
              className="more-actions-menu__item"
              onClick={() => void copyLink(androidUrl, "Google Wallet")}
            >
              <i className="ti ti-brand-google" aria-hidden="true" />
              <span className="more-actions-menu__item-text">
                <span>Copy Google Wallet link</span>
                <span className="more-actions-menu__item-hint">Install link for this attendee's pass</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type ChipTone = "ok" | "warn" | "error" | "neutral";

function passStatusTone(status: string): ChipTone {
  if (status === "registered" || status === "confirmed") return "ok";
  if (status === "revoked") return "error";
  return "neutral";
}

function rsvpTone(status: RsvpStatus): ChipTone {
  if (status === "confirmed") return "ok";
  if (status === "declined" || status === "cancelled") return "error";
  if (status === "tentative") return "warn";
  return "neutral";
}

/** Clamped to this page's four chip tones - resolveStatusMeta's other badge variants
 * (info/confirmed/vip/primary) don't apply to any mail delivery status. */
function mailTone(status: string | null): ChipTone {
  if (!status) return "neutral";
  const variant = resolveStatusMeta(status).variant;
  return variant === "ok" || variant === "warn" || variant === "error" ? variant : "neutral";
}

function walletTone(pass: WalletPassActionDto | null): ChipTone {
  if (!pass) return "neutral";
  if (pass.status === "active") return "ok";
  if (pass.status === "voided" || pass.status === "failed") return "error";
  if (pass.status === "expired") return "warn";
  return "neutral";
}

/** Apple/Google registration counts as PassCreator itself reports them (refreshed periodically by
 * the wallet_sync worker job, apps/cli - never on a request path). `null` counts mean the worker
 * hasn't checked yet, not "confirmed zero" - distinct from a confirmed 0. */
/** "Status unknown", not "Not checked yet" - "checked" collides with check-in terminology
 * elsewhere in Admitto, and reads as if nothing has happened yet when the attendee may well
 * already have the pass in their wallet - we just haven't confirmed it with PassCreator (PO
 * review, 2026-08-13). */
function walletRegistrationLabel(active: number | null, inactive: number | null): string {
  if (active === null && inactive === null) return "Status unknown";
  if ((active ?? 0) > 0) return (active ?? 0) > 1 ? `Registered (${active} devices)` : "Registered";
  if ((inactive ?? 0) > 0) return "Unregistered";
  return "Not added";
}

/** PassCreator's firstDownloadedAt comes back as "YYYY-MM-DD HH:MM:SS" with no offset - confirmed
 * UTC by cross-checking a live pass's raw value against PassCreator's own dashboard, which shows
 * the same moment already converted to the viewer's local time (PO review, 2026-08-13). Shown in
 * UTC, not the viewer's browser zone (unlike issued_at/voided_at/etc below) - this is the
 * ATTENDEE's own action on their own device, in a timezone we have no way to know (PassCreator's
 * API doesn't expose it), so converting to the admin's own zone would misrepresent it as the
 * admin's or the attendee's local time when it's neither (PO review). Appending "Z" makes it a
 * real ISO instant so it can go through the same formatEventDateTime pipeline as every other
 * wallet timestamp instead of being shown as an unparsed raw string. */
function formatFirstDownloadedAt(raw: string): string {
  return formatEventDateTime(`${raw.replace(" ", "T")}Z`, "UTC");
}

function itemStateLabel(state: string): string {
  if (state === "issued") return "Issued";
  if (state === "returned") return "Returned";
  return "Not yet";
}

/** "Revoke items" menu item's disabled-title on the detail page — same event-catalog and
 * per-attendee "nothing to do" gates as the Attendees list's bulk version
 * (bulkRevokeItemsTooltip), just singular. */
function revokeItemsMenuTooltip(itemCount: number, canRevokeItems: boolean): string | undefined {
  if (itemCount === 0) return "No items configured for this event. Add some in Requirements.";
  if (!canRevokeItems) return "Nothing issued to revoke for this attendee.";
  return undefined;
}

function revokeItemsToast(revokedCount: number): { message: string; variant: "success" | "info" } {
  if (revokedCount === 0) return { message: "No issued items to revoke.", variant: "info" };
  const pluralSuffix = revokedCount === 1 ? "" : "s";
  return { message: `${revokedCount} item${pluralSuffix} revoked.`, variant: "success" };
}

/** "Revoke check-in" menu item's disabled-title on the detail page - same always-visible,
 * disabled + tooltip convention as revokeItemsMenuTooltip above, instead of hiding the item
 * entirely (PO report: "bardziej preferowałbym wyszarzoną opcję z tooltipem jak jest ładnie
 * zrobione wobec revoke items"). Covers both "never checked in"/"already undone" and "pass
 * revoked" - canRevokeCheckIn's own `blocked` param folds the latter in. */
function revokeCheckInMenuTooltip(
  checkInStatus: "admitted" | "not_admitted",
  isRevoked: boolean,
): string | undefined {
  if (isRevoked) return "This attendee's pass is revoked.";
  if (checkInStatus !== "admitted") return "This attendee isn't checked in.";
  return undefined;
}

/** Icon background/color has three looks (pending/issued/returned); the status text
 * only distinguishes "done" (issued) from everything else - matches the design mockup's
 * .att-item-row__icon vs .att-item-row__status rules exactly, not a simplification. */
function itemIconModifier(state: string): "issued" | "returned" | "" {
  if (state === "issued") return "issued";
  if (state === "returned") return "returned";
  return "";
}

function itemStateTone(state: string): "ok" | "muted" {
  return state === "issued" ? "ok" : "muted";
}

/** Whether the edit form differs from the last-loaded/saved attendee (field-by-field, including
 * custom data) — extracted out of the component (SonarCloud S3776: keeps the comparison chain out
 * of the component's own cognitive-complexity count, the same way EventOverviewPage.tsx extracts
 * buildReadinessItems). */
function isAttendeeFormDirty(form: AttendeeFormState | null, baseline: AttendeeFormState | null): boolean {
  if (form === null || baseline === null) return false;
  return (
    form.first_name !== baseline.first_name ||
    form.last_name !== baseline.last_name ||
    form.email !== baseline.email ||
    form.company !== baseline.company ||
    form.department !== baseline.department ||
    form.ticket_type !== baseline.ticket_type ||
    form.rsvp_status !== baseline.rsvp_status ||
    JSON.stringify(form.customFields) !== JSON.stringify(baseline.customFields)
  );
}

/** A stored ticket_type with no matching catalog entry (type deleted after assignment, or legacy
 * pre-catalog data) has no <option> to bind to — surfaced as its own option instead of silently
 * falling back to the blank "—" option (fail-open, same philosophy as ticketTypeBadge.tsx's
 * catalog resolver). Extracted out of the component (SonarCloud S3776). */
function resolveOrphanedTicketType(ticketType: string, ticketTypes: TicketTypeDto[]): string | null {
  if (!ticketType) return null;
  return ticketTypes.some((type) => type.key === ticketType) ? null : ticketType;
}

/** Ticket type picker options: the "-" (none) sentinel, the orphaned type surfaced by
 * `resolveOrphanedTicketType` if there is one, then the event's own catalog. Extracted out of
 * the component (SonarCloud S3776). */
function buildTicketTypeOptions(
  orphanedTicketType: string | null,
  ticketTypes: TicketTypeDto[],
): { id: string; label: string }[] {
  const options = [{ id: "", label: "No ticket type" }];
  if (orphanedTicketType) {
    options.push({ id: orphanedTicketType, label: `${orphanedTicketType} (not in catalog)` });
  }
  options.push(...ticketTypes.map((type) => ({ id: type.key, label: type.label })));
  return options;
}

/** Overview tab: read-only profile, additional info, wallet placeholder, event items, and
 * delivery history - extracted out of the component (SonarCloud S3776: keeps this tab's own
 * conditional rendering out of the component's cognitive-complexity count). */
function AttendeeOverviewTab({
  detail,
  ticketTypes,
  attendeeSource,
  customDataEntries,
  eventItems,
  event,
}: Readonly<{
  detail: AttendeeDetailDto;
  ticketTypes: TicketTypeDto[];
  attendeeSource: string | null;
  customDataEntries: Array<[string, string, string]>;
  eventItems: AttendeeDetailDto["event_items"];
  event: EventDto;
}>) {
  const [sentMessageRow, setSentMessageRow] = useState<DeliveryDto | null>(null);
  const [detailsRow, setDetailsRow] = useState<DeliveryDto | null>(null);
  const deliveryCounts = countDeliveryOutcomes(detail.deliveries);

  // React Router reuses this same AttendeeDetailPage/AttendeeOverviewTab instance across
  // :attendeeId param changes - without this, a delivery modal left open while navigating to a
  // different attendee would keep showing the previous attendee's delivery.
  useEffect(() => {
    setSentMessageRow(null);
    setDetailsRow(null);
  }, [detail.id]);

  const deliveryHistoryActions =
    detail.deliveries.length > 0 ? (
      <div
        className="attendee-delivery-stats"
        aria-label={`Delivery summary: ${deliveryCounts.sent} sent, ${deliveryCounts.bounced} bounced`}
      >
        <span className="attendee-delivery-stats__item attendee-delivery-stats__item--sent" title="Sent">
          <i className="ti ti-mail-check" aria-hidden="true" />
          <span>{deliveryCounts.sent}</span>
        </span>
        <span className="attendee-delivery-stats__item attendee-delivery-stats__item--bounced" title="Bounced">
          <i className="ti ti-mail-x" aria-hidden="true" />
          <span>{deliveryCounts.bounced}</span>
        </span>
      </div>
    ) : undefined;
  return (
    <div className="attendee-detail-grid">
      <div className="attendee-detail-main">
        <Card title="Profile" className="attendee-detail-profile">
          <div className="attendee-detail-readonly">
            <div className="attendee-detail-row">
              <span>Email</span>
              <span className="mono">{detail.email}</span>
            </div>
            <div className="attendee-detail-row">
              <span>Ticket type</span>
              <TicketTypeBadge ticketType={detail.ticket_type} catalog={ticketTypes} />
            </div>
            <div className="attendee-detail-row">
              <span>Company</span>
              <span>{detail.company ?? "-"}</span>
            </div>
            <div className="attendee-detail-row">
              <span>Department</span>
              <span>{detail.department ?? "-"}</span>
            </div>
            {attendeeSource && (
              <div className="attendee-detail-row">
                <span>Added via</span>
                <span>{attendeeSource}</span>
              </div>
            )}
            <div className="attendee-detail-row">
              <span>Registered on</span>
              <span className="mono">
                {formatEventDateTime(detail.created_at, detail.client_timezone ?? event.timezone)}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Additional information">
          {customDataEntries.length === 0 ? (
            <EmptyState
              icon={<i className="ti ti-list-details" aria-hidden="true" />}
              title="No additional information"
              description="Custom fields will appear here once this attendee has some."
            />
          ) : (
            <div className="attendee-detail-readonly">
              {customDataEntries.map(([key, label, value]) => (
                <div className="attendee-detail-row" key={key}>
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Wallet"
          actions={
            <WalletLinksMenu
              appleUrl={detail.wallet_apple_link}
              androidUrl={detail.wallet_google_link}
            />
          }
        >
          {detail.wallet_pass ? (
            <div className="attendee-detail-readonly">
              <div className="attendee-detail-row">
                <span>Apple Wallet</span>
                <span>
                  {walletRegistrationLabel(
                    detail.wallet_pass.apple_active_registrations,
                    detail.wallet_pass.apple_inactive_registrations,
                  )}
                </span>
              </div>
              <div className="attendee-detail-row">
                <span>Google Wallet</span>
                <span>
                  {walletRegistrationLabel(
                    detail.wallet_pass.google_active_registrations,
                    detail.wallet_pass.google_inactive_registrations,
                  )}
                </span>
              </div>
              {/* None of these timestamps has a captured actor/device timezone (issued_at is the
                  attendee's own device; voided_at/last_synced_at/registration_checked_at are
                  admin/worker actions with no persisted zone; first_downloaded_at is PassCreator's
                  own UTC value, see formatFirstDownloadedAt) - viewer's own browser zone, matching
                  viewerLocalTime's "no known actor zone" convention, not the event's timezone
                  (which has no real relationship to any of these - PO review). */}
              {detail.wallet_pass.first_downloaded_at && (
                <div className="attendee-detail-row">
                  <span>First downloaded</span>
                  <span className="mono">
                    {formatFirstDownloadedAt(detail.wallet_pass.first_downloaded_at)}
                  </span>
                </div>
              )}
              {detail.wallet_pass.issued_at && (
                <div className="attendee-detail-row">
                  <span>Pass created</span>
                  <span className="mono">
                    {formatEventDateTime(detail.wallet_pass.issued_at, getBrowserTimeZone())}
                  </span>
                </div>
              )}
              {detail.wallet_pass.voided_at && (
                <div className="attendee-detail-row">
                  <span>Voided</span>
                  <span className="mono">
                    {formatEventDateTime(detail.wallet_pass.voided_at, getBrowserTimeZone())}
                  </span>
                </div>
              )}
              {detail.wallet_pass.last_synced_at && (
                <div className="attendee-detail-row">
                  <span>Last reissued</span>
                  <span className="mono">
                    {formatEventDateTime(detail.wallet_pass.last_synced_at, getBrowserTimeZone())}
                  </span>
                </div>
              )}
              {detail.wallet_pass.registration_checked_at && (
                <div className="attendee-detail-row">
                  <span>Last updated</span>
                  <span className="mono">
                    {formatEventDateTime(detail.wallet_pass.registration_checked_at, getBrowserTimeZone())}
                  </span>
                </div>
              )}
              {detail.wallet_pass.last_error_code && (
                <div className="attendee-detail-row">
                  <span>Last error</span>
                  <span className="mono">{detail.wallet_pass.last_error_code}</span>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={<i className="ti ti-wallet" aria-hidden="true" />}
              title="Not added to a wallet"
              description="This attendee hasn't added their ticket to Apple Wallet or Google Wallet yet."
            />
          )}
        </Card>
      </div>

      <div className="attendee-detail-side">
        <Card title="Event items">
          {eventItems.length === 0 ? (
            <EmptyState
              icon={<i className="ti ti-package" aria-hidden="true" />}
              title="No event items"
              description="This event has no hand-out items configured yet."
            />
          ) : (
            <ul className="attendee-items-list">
              {eventItems.map((item) => (
                <li className="attendee-items-row" key={item.key}>
                  <span
                    className={[
                      "attendee-items-row__icon",
                      itemIconModifier(item.state) &&
                        `attendee-items-row__icon--${itemIconModifier(item.state)}`,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <i
                      className={`ti ti-${item.state === "issued" || item.state === "returned" ? "circle-check" : (item.icon ?? "package")}`}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="attendee-items-row__label">{item.label}</span>
                  <span
                    className={`attendee-items-row__state attendee-items-row__state--${itemStateTone(item.state)}`}
                  >
                    {itemStateLabel(item.state)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Delivery history" actions={deliveryHistoryActions}>
          {detail.deliveries.length === 0 ? (
            <EmptyState
              icon={<i className="ti ti-mail-off" aria-hidden="true" />}
              title="No delivery attempts yet"
              description="Ticket emails and resends will appear here once one is sent."
            />
          ) : (
            <div className="attendee-deliveries-scroll">
              <ul className="attendee-deliveries">
                {detail.deliveries.map((delivery) => {
                  const statusMeta = resolveStatusMeta(delivery.status);
                  const iconTone = statusMeta.variant;
                  return (
                    <li className="attendee-delivery" key={delivery.id}>
                      <Tooltip content={statusMeta.label} className="attendee-delivery__icon-tip">
                        <span
                          className={`attendee-delivery__icon attendee-delivery__icon--${iconTone}`}
                          aria-label={statusMeta.label}
                        >
                          <i
                            className={`ti ti-${deliveryHistoryIcon(delivery.purpose, delivery.status)}`}
                            aria-hidden="true"
                          />
                        </span>
                      </Tooltip>
                      <div className="attendee-delivery__body">
                        <div className="attendee-delivery__subject">
                          {delivery.rendered_subject ?? "Ticket email"}
                        </div>
                        {delivery.recipient_email && (
                          <div className="attendee-delivery__to">
                            <span aria-hidden="true">→</span> {delivery.recipient_email}
                          </div>
                        )}
                      </div>
                      <span className="attendee-delivery__time mono">
                        {formatDeliveryHistoryTime(
                          rowTimestamp(delivery),
                          delivery.client_timezone,
                          event.timezone,
                        )}
                      </span>
                      <DeliveryRowMenu
                        row={delivery}
                        onViewSentMessage={setSentMessageRow}
                        onViewDetails={setDetailsRow}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      </div>
      {sentMessageRow && (
        <SentMessagePreviewModal
          eventId={event.id}
          row={sentMessageRow}
          onClose={() => setSentMessageRow(null)}
        />
      )}
      {detailsRow && (
        <DeliveryDetailsModal
          eventId={event.id}
          eventTimezone={event.timezone}
          row={detailsRow}
          showOpenAttendee={false}
          onClose={() => setDetailsRow(null)}
          onViewSentMessage={(row) => {
            setDetailsRow(null);
            setSentMessageRow(row);
          }}
        />
      )}
    </div>
  );
}

/** Activity tab: chronological action log — extracted out of the component (SonarCloud S3776:
 * keeps this tab's own conditional rendering out of the component's cognitive-complexity count). */
function AttendeeActivityTab({
  actionLog,
  attributeFields,
  eventItems,
  event,
}: Readonly<{
  actionLog: AttendeeDetailDto["action_log"];
  attributeFields: CustomDataFieldDef[];
  eventItems: AttendeeDetailDto["event_items"];
  event: EventDto;
}>) {
  return (
    <Card padded>
      {actionLog.length === 0 ? (
        <EmptyState
          icon={<i className="ti ti-history" aria-hidden="true" />}
          title="No activity yet"
          description="Events will appear here as you work with this attendee."
        />
      ) : (
        <ul className="at-timeline">
          {actionLog.map((entry) => {
            const detailText = getTimelineDetail(entry, attributeFields, eventItems);
            return (
              <li key={entry.id} className="at-tl-item">
                <div className={`at-tl-dot at-tl-dot--${getTimelineTone(entry)}`}>
                  <i className={`ti ti-${getTimelineIcon(entry.action_type)}`} aria-hidden="true" />
                </div>
                <div className="at-tl-body">
                  <b>{getTimelineLabel(entry)}</b>
                  {detailText && <span>{detailText}</span>}
                </div>
                <div className="at-tl-meta">
                  <time className="at-tl-time" dateTime={entry.created_at}>
                    {formatActivityTimestamp(entry.created_at, entry.client_timezone, event.timezone)}
                  </time>
                  <span className="at-tl-actor">
                    <i className="ti ti-user" aria-hidden="true" />
                    {getTimelineActor(entry)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

type AssignedNoteAuthorRole = Exclude<NoteAuthorRole, null>;

const NOTE_ROLE_BADGE_VARIANTS: Record<AssignedNoteAuthorRole, BadgeProps["variant"]> = {
  superadmin: "error",
  admin: "warn",
  operator: "info",
};

const NOTE_ROLE_SHORTS: Record<AssignedNoteAuthorRole, string> = {
  superadmin: "SA",
  admin: "AD",
  operator: "OP",
};

function noteRoleBadgeVariant(role: AssignedNoteAuthorRole): BadgeProps["variant"] {
  return NOTE_ROLE_BADGE_VARIANTS[role];
}

function noteRoleShort(role: AssignedNoteAuthorRole): string {
  return NOTE_ROLE_SHORTS[role];
}

/** Delete rule (PO): admins may delete their own note or one written by an operator, but not
 * another admin's or a superadmin's; a superadmin may delete any note. Edit stays own-note-only
 * for every role - the server re-enforces both authoritatively regardless of what these hide. */
function canDeleteNote(
  note: AttendeeDetailDto["notes"][number],
  currentUserId: string | undefined,
  superadminUser: boolean,
  orgAdminUser: boolean,
): boolean {
  if (note.author_user_id === currentUserId) return true;
  if (superadminUser) return true;
  return orgAdminUser && note.author_role === "operator";
}

type NoteEditState = {
  noteId: string | null;
  draft: string;
  submitting: boolean;
};

/** Internal, staff-only notes on this attendee - shares the same AttendeeNote rows as the
 * check-in operator's own "Add note" action, so a note added on either side shows up on the
 * other (matches the mockup's "Internal, visible to staff only, never shown to the attendee"). */
function AttendeeNotesTab({
  notes,
  notesTotal,
  notesPage,
  notesPageSize,
  onPageChange,
  event,
  draft,
  onDraftChange,
  onSubmit,
  submitting,
  currentUserId,
  superadminUser,
  orgAdminUser,
  editState,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRequestDelete,
  mutationsDisabled,
}: Readonly<{
  notes: AttendeeDetailDto["notes"];
  notesTotal: number;
  notesPage: number;
  notesPageSize: number;
  onPageChange: (page: number) => void;
  event: EventDto;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  currentUserId: string | undefined;
  superadminUser: boolean;
  orgAdminUser: boolean;
  editState: NoteEditState;
  onEditDraftChange: (value: string) => void;
  onStartEdit: (note: AttendeeDetailDto["notes"][number]) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onRequestDelete: (noteId: string) => void;
  mutationsDisabled: boolean;
}>) {
  const pageCount = Math.max(1, Math.ceil(notesTotal / notesPageSize));
  return (
    <Card padded>
      <Notice variant="info" className="at-notes-hint">
        Internal notes are visible to staff only and are never shown to the attendee.
      </Notice>
      <div className="at-notes-form">
        <textarea
          className="at-textarea at-notes-form__textarea"
          rows={2}
          aria-label="New internal note"
          // 2000-char cap matches NoteModal.tsx (check-in) and the backend's MAX_ATTENDEE_NOTE_LENGTH.
          maxLength={2000}
          placeholder="Add a note about this attendee…"
          value={draft}
          disabled={mutationsDisabled || submitting}
          onChange={(e) => onDraftChange(e.target.value)}
        />
        <div className="at-notes-form__actions">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={mutationsDisabled || !draft.trim() || submitting}
            onClick={onSubmit}
          >
            {submitting ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>
      {notes.length === 0 ? (
        <p className="at-notes-empty">No notes yet.</p>
      ) : (
        <ul className="at-notes-list">
          {notes.map((note) => {
            const isOwn = !mutationsDisabled && note.author_user_id === currentUserId;
            const canDelete = !mutationsDisabled && canDeleteNote(note, currentUserId, superadminUser, orgAdminUser);
            const isEditing = !mutationsDisabled && editState.noteId === note.id;
            return (
              <li key={note.id} className="at-notes-list__item">
                <div className="at-notes-list__head">
                  <div className="at-notes-list__author-group">
                    <Avatar name={note.author_display} size="sm" />
                    <span className="at-notes-list__author">{note.author_display}</span>
                    {note.author_role && (
                      <Badge variant={noteRoleBadgeVariant(note.author_role)} title={note.author_role}>
                        {noteRoleShort(note.author_role)}
                      </Badge>
                    )}
                  </div>
                  <time className="at-notes-list__time" dateTime={note.created_at}>
                    {formatActivityTimestamp(note.created_at, null, event.timezone)}
                  </time>
                </div>
                {isEditing ? (
                  <div className="at-notes-list__edit">
                    <textarea
                      className="at-textarea at-notes-form__textarea"
                      rows={2}
                      aria-label="Edit note"
                      maxLength={2000}
                      value={editState.draft}
                      disabled={editState.submitting}
                      onChange={(e) => onEditDraftChange(e.target.value)}
                    />
                    <div className="at-notes-form__actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={editState.submitting}
                        onClick={onCancelEdit}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!editState.draft.trim() || editState.submitting}
                        onClick={onSaveEdit}
                      >
                        {editState.submitting ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="at-notes-list__text">{note.body}</p>
                    {(isOwn || canDelete) && (
                      <div className="at-notes-list__actions">
                        {isOwn && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={<i className="ti ti-pencil" aria-hidden="true" />}
                            aria-label={`Edit note by ${note.author_display}`}
                            onClick={() => onStartEdit(note)}
                          >
                            Edit
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={<i className="ti ti-trash" aria-hidden="true" />}
                            aria-label={`Delete note by ${note.author_display}`}
                            onClick={() => onRequestDelete(note.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {notesTotal > notesPageSize && (
        <nav className="at-notes-pagination" aria-label="Notes pagination">
          <Button type="button" variant="ghost" size="sm" disabled={notesPage <= 1} onClick={() => onPageChange(notesPage - 1)}>
            Previous
          </Button>
          <span>Page {notesPage} of {pageCount}</span>
          <Button type="button" variant="ghost" size="sm" disabled={notesPage >= pageCount} onClick={() => onPageChange(notesPage + 1)}>
            Next
          </Button>
        </nav>
      )}
    </Card>
  );
}

/** Event attendee detail: profile edit, pass revoke/restore, resend, and activity log. */
/** Diffs the edit form against the loaded attendee to build the PATCH body — top-level fields
 * plus any changed custom-data attributes — extracted out of handleSave (SonarCloud S3776). */
function buildAttendeePatch(
  form: AttendeeFormState,
  detail: AttendeeDetailDto,
  attributeFields: CustomDataFieldDef[],
): UpdateAttendeePatch {
  const patch: UpdateAttendeePatch = {};
  if (form.first_name !== (detail.first_name ?? "")) patch.first_name = form.first_name;
  if (form.last_name !== (detail.last_name ?? "")) patch.last_name = form.last_name;
  if (form.email !== detail.email) patch.email = form.email;
  if (form.company !== (detail.company ?? "")) patch.company = form.company || null;
  if (form.department !== (detail.department ?? "")) patch.department = form.department || null;
  if (form.ticket_type !== (detail.ticket_type ?? "")) patch.ticket_type = form.ticket_type || null;
  if (form.rsvp_status !== detail.rsvp_status) patch.rsvp_status = form.rsvp_status;

  const customDataPatch: Record<string, string | null> = {};
  for (const field of attributeFields) {
    const key = field.source_field;
    const next = form.customFields[key] ?? "";
    const current = readCustomDataField(detail.custom_data, key) ?? "";
    if (next !== current) customDataPatch[key] = next || null;
  }
  if (Object.keys(customDataPatch).length > 0) patch.custom_data_fields = customDataPatch;

  return patch;
}

type SaveErrorOutcome =
  | { kind: "email_conflict" }
  | { kind: "stale_write" }
  | { kind: "message"; message: string };

/** Classifies a failed profile save into the UI action it should trigger — extracted out of
 * handleSave (SonarCloud S3776). */
function classifySaveError(err: unknown): SaveErrorOutcome {
  if (err instanceof ApiError && err.status === 409) {
    if (hasApiErrorCode(err, "email_conflict")) return { kind: "email_conflict" };
    if (hasApiErrorCode(err, "stale_write")) return { kind: "stale_write" };
    return { kind: "message", message: "Could not save changes." };
  }
  if (
    err instanceof ApiError &&
    err.status === 400 &&
    (hasApiErrorCode(err, "unknown_custom_data_field") ||
      hasApiErrorCode(err, "required_custom_data_field_missing") ||
      hasApiErrorCode(err, "validation_failed"))
  ) {
    return {
      kind: "message",
      message: hasApiErrorCode(err, "unknown_custom_data_field")
        ? "Event configuration changed. Reload this page to edit attributes."
        : "Could not save attribute fields. Check required values and options.",
    };
  }
  return { kind: "message", message: operatorApiErrorMessage(err, "Failed to save changes.") };
}

type PassStatusErrorOutcome =
  | { kind: "capacity"; eventFull: EventFullMeta }
  | { kind: "stale_write" }
  | { kind: "message"; message: string };

/** Next form value after a pass-status change lands — merges onto any in-progress edit, or falls
 * back to a fresh form when there's none to merge onto — extracted out of handlePassStatusChange
 * (SonarCloud S3776: keeps this nested branch out of its cognitive-complexity count). */
function nextFormAfterPassStatusChange(
  currentForm: AttendeeFormState | null,
  previousDetail: AttendeeDetailDto,
  updated: AttendeeDetailDto,
  attributeFields: CustomDataFieldDef[],
): AttendeeFormState {
  if (!currentForm) return toAttendeeForm(updated, attributeFields);
  return mergeFormAfterReload(currentForm, previousDetail, updated, attributeFields);
}

/** Classifies a failed pass status change into the UI action it should trigger — extracted out
 * of handlePassStatusChange (SonarCloud S3776). */
function classifyPassStatusError(err: unknown): PassStatusErrorOutcome {
  if (err instanceof ApiError && err.status === 409) {
    if (err.code === "event_full" && err.eventFull) return { kind: "capacity", eventFull: err.eventFull };
    if (err.code === "stale_write") return { kind: "stale_write" };
    return { kind: "message", message: "Could not update pass status." };
  }
  return { kind: "message", message: operatorApiErrorMessage(err, "Could not update pass status.") };
}

export function AttendeeDetailPage() {
  const { eventId, attendeeId } = useParams();
  const { event } = useOutletContext<{ event: EventDto }>();
  const { assignments, user } = useAuth();
  const superadmin = isSuperadmin(assignments);
  const orgAdmin = isOrgAdmin(assignments, event.organization_id);
  const navigate = useNavigate();
  const { addToast } = useToast();
  // Edit folds into the "More actions" menu below this breakpoint instead of its own header
  // button - not enough width for Edit + Revoke/Restore + More + Back at once (PO report).
  const isDesktop = useIsDesktop();
  const resendTitleId = useId();
  const resendPanelRef = useRef<HTMLFormElement>(null);
  const editTitleId = useId();
  const editPanelRef = useRef<HTMLFormElement>(null);

  const [tab, setTab] = useState<TabId>("overview");
  const [detail, setDetail] = useState<AttendeeDetailDto | null>(null);
  const [attributeFields, setAttributeFields] = useState<CustomDataFieldDef[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
  const [form, setForm] = useState<AttendeeFormState | null>(null);
  const [initialEmail, setInitialEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemsWarning, setItemsWarning] = useState<string | null>(null);
  const [emailConflict, setEmailConflict] = useState(false);
  const [staleWrite, setStaleWrite] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [resendMode, setResendMode] = useState<"same" | "other">("same");
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  // Which action the pending discard-confirm resolves to: navigating back away from the page,
  // or just closing edit mode in place (#361) - same dialog, different consequence on confirm.
  const [discardIntent, setDiscardIntent] = useState<"back" | "cancel-edit">("back");
  const [editMode, setEditMode] = useState(false);
  // Which of the three "revoke" confirm flows is active — mutually exclusive
  // by construction, replacing six independent booleans that could
  // technically both be true at once (review finding).
  const [activeRevoke, setActiveRevoke] = useState<ActiveRevokeAction>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  // Same mutually-exclusive-by-construction shape as activeRevoke above, for the wallet pass's
  // own three lifecycle actions.
  const [activeWalletAction, setActiveWalletAction] = useState<ActiveWalletAction>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [restoreCapacityBlocked, setRestoreCapacityBlocked] = useState<EventFullMeta | null>(null);
  const [restoreForceCapacity, setRestoreForceCapacity] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteEditDraft, setNoteEditDraft] = useState("");
  const [noteEditSubmitting, setNoteEditSubmitting] = useState(false);
  const [noteDeleteId, setNoteDeleteId] = useState<string | null>(null);
  const [noteDeleting, setNoteDeleting] = useState(false);
  const [noteDeleteError, setNoteDeleteError] = useState<string | null>(null);
  const [notesPage, setNotesPage] = useState(1);

  /** Guards async handlers when route params change before a request completes. */
  const selectionRef = useRef({ eventId, attendeeId });
  selectionRef.current = { eventId, attendeeId };
  const notesPageRef = useRef(notesPage);
  notesPageRef.current = notesPage;

  function isStillSelected(target: { eventId: string; attendeeId: string }): boolean {
    const current = selectionRef.current;
    return current.eventId === target.eventId && current.attendeeId === target.attendeeId;
  }

  const loadDetail = useCallback(async () => {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId, notesPage };
    // Changing attendee resets the page to one, but the previous page's request can still
    // finish afterwards. Only let the currently selected page update the detail view.
    const isCurrentRequest = () =>
      isStillSelected(target) && notesPageRef.current === target.notesPage;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setRestoreCapacityBlocked(null);
    setRestoreForceCapacity(false);
    setRevokeError(null);
    setRevokeBusy(false);
    setActiveRevoke(null);
    setWalletError(null);
    setWalletBusy(false);
    setActiveWalletAction(null);
    setNoteDraft("");
    setNoteSubmitting(false);
    setEditingNoteId(null);
    setNoteEditDraft("");
    setNoteEditSubmitting(false);
    setNoteDeleteId(null);
    setNoteDeleting(false);
    setNoteDeleteError(null);
    try {
      const { detail: d, attributeFields: fields, itemsWarning: warn } =
        await loadAttendeeDetailData(eventId, attendeeId, notesPage);
      if (!isCurrentRequest()) return;
      setDetail(d);
      setAttributeFields(fields);
      setForm(toAttendeeForm(d, fields));
      setInitialEmail(d.email);
      setItemsWarning(warn);
      setStaleWrite(false);
      setEmailConflict(false);
    } catch (err) {
      if (!isCurrentRequest()) return;
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setNotFound(true);
      } else {
        setError(operatorApiErrorMessage(err, "Failed to load attendee."));
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [eventId, attendeeId, notesPage]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    setNotesPage(1);
  }, [eventId, attendeeId]);

  const loadTicketTypes = useCallback(() => {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    setTicketTypes([]);
    setTicketTypesError(null);
    fetchTicketTypes(eventId)
      .then((types) => {
        if (!isStillSelected(target)) return;
        setTicketTypes(types);
      })
      .catch((err: unknown) => {
        if (!isStillSelected(target)) return;
        setTicketTypesError(operatorApiErrorMessage(err, "Failed to load ticket types."));
      });
  }, [eventId, attendeeId]);

  useEffect(() => {
    loadTicketTypes();
  }, [loadTicketTypes]);

  // Whether "Resend ticket" should work at all — same check as the Attendees list's "Send
  // tickets" button, shared via useMailConfigured.
  const mailConfigured = useMailConfigured(eventId);

  const baseline = detail != null ? toAttendeeForm(detail, attributeFields) : null;
  const isDirty = isAttendeeFormDirty(form, baseline);

  const goBack = () => {
    if (eventId) navigate(`/admin/events/${eventId}/attendees`);
    else navigate(-1);
  };

  const handleBack = () => {
    if (isDirty) {
      setDiscardIntent("back");
      setDiscardOpen(true);
    } else {
      goBack();
    }
  };

  async function handleDeleteConfirm() {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAttendee(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      addToast("Attendee permanently deleted", "success");
      navigate(`/admin/events/${eventId}/attendees`);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setDeleteError(operatorApiErrorMessage(err, "Delete failed"));
    } finally {
      if (isStillSelected(target)) setDeleting(false);
    }
  }

  function handleCancelEdit() {
    if (isDirty) {
      setDiscardIntent("cancel-edit");
      setDiscardOpen(true);
    } else {
      setEditMode(false);
      setError(null);
      setEmailConflict(false);
    }
  }

  useModalFocusTrap(resendPanelRef, resendOpen, () => setResendOpen(false));
  useModalFocusTrap(editPanelRef, editMode, handleCancelEdit);

  async function handleReload() {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    const previousDetail = detail;
    setReloading(true);
    setError(null);
    try {
      const { detail: d, attributeFields: fields, itemsWarning: warn } =
        await loadAttendeeDetailData(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      setAttributeFields(fields);
      setForm((currentForm) => {
        if (!currentForm || !previousDetail) return toAttendeeForm(d, fields);
        return mergeFormAfterReload(currentForm, previousDetail, d, fields);
      });
      setDetail(d);
      setInitialEmail(d.email);
      setStaleWrite(false);
      setItemsWarning(warn);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setError(operatorApiErrorMessage(err, "Failed to reload. Please try again."));
    } finally {
      if (isStillSelected(target)) setReloading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId || !attendeeId || !detail || !form) return;

    const patch = buildAttendeePatch(form, detail, attributeFields);
    if (Object.keys(patch).length === 0) {
      setEditMode(false);
      setError(null);
      setEmailConflict(false);
      return;
    }

    const customValidation = validateCustomFieldsForm(attributeFields, form.customFields);
    if (customValidation) {
      setError(customValidation);
      return;
    }

    patch.expected_updated_at = detail.updated_at;
    const target = { eventId, attendeeId };
    setSaving(true);
    setEmailConflict(false);
    setError(null);
    try {
      const updated = await updateAttendee(eventId, attendeeId, patch);
      if (!isStillSelected(target)) return;
      setDetail(updated);
      setForm(toAttendeeForm(updated, attributeFields));
      setInitialEmail(updated.email);
      setStaleWrite(false);
      setEditMode(false);
      addToast("Profile saved", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      const outcome = classifySaveError(err);
      if (outcome.kind === "email_conflict") {
        setEmailConflict(true);
      } else if (outcome.kind === "stale_write") {
        // Inline modal warning + Reload button only, no toast - same error, actionable
        // retry control already visible in the still-open modal (bot review, matches the
        // ConfirmDialog convention of not duplicating an actionable inline error as a toast).
        setStaleWrite(true);
        void handleReload();
      } else {
        setError(outcome.message);
      }
    } finally {
      if (isStillSelected(target)) setSaving(false);
    }
  }

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId || !attendeeId || !detail) return;
    const target = { eventId, attendeeId };
    if (resendMode === "other" && !resendEmail.trim()) {
      setResendError("Enter an email address for the alternate recipient.");
      return;
    }
    setResending(true);
    setResendError(null);
    try {
      const body = resendMode === "other" ? { to: resendEmail.trim() } : {};
      const delivery = await resendTicket(eventId, attendeeId, body);
      if (!isStillSelected(target)) return;
      const refreshed = await fetchAttendeeDetail(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      setDetail(refreshed);
      setResendOpen(false);
      addToast(
        delivery.status === "failed"
          ? `Resend queued but delivery failed (${delivery.error_code ?? "unknown"}).`
          : "Ticket resent successfully.",
        delivery.status === "failed" ? "warning" : "success",
      );
    } catch (err) {
      if (!isStillSelected(target)) return;
      setResendError(operatorApiErrorMessage(err, "Resend failed."));
    } finally {
      if (isStillSelected(target)) setResending(false);
    }
  }

  /** Revoke or restore wallet pass; preserves unsaved profile edits in the form. */
  async function handlePassStatusChange(
    nextStatus: "registered" | "revoked",
    opts?: { force?: boolean },
  ) {
    if (!eventId || !attendeeId || !detail || !form) return;
    const target = { eventId, attendeeId };
    const previousDetail = detail;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      const updated = await updateAttendee(
        eventId,
        attendeeId,
        {
          status: nextStatus,
          expected_updated_at: detail.updated_at,
        },
        { force: opts?.force },
      );
      if (!isStillSelected(target)) return;
      setDetail(updated);
      setForm((currentForm) =>
        nextFormAfterPassStatusChange(currentForm, previousDetail, updated, attributeFields),
      );
      setActiveRevoke(null);
      setRestoreCapacityBlocked(null);
      setRestoreForceCapacity(false);
      addToast(nextStatus === "revoked" ? "Pass revoked" : "Pass restored", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      const outcome = classifyPassStatusError(err);
      if (outcome.kind === "capacity") {
        setRestoreCapacityBlocked(outcome.eventFull);
        const { current, capacity } = outcome.eventFull;
        setRevokeError(
          `Event is at capacity (${current}/${capacity}). Free a slot or increase capacity before restoring this pass.`,
        );
      } else if (outcome.kind === "stale_write") {
        addToast("Someone else updated this attendee. Page will reload.", "warning");
        void handleReload();
      } else {
        setRevokeError(outcome.message);
      }
    } finally {
      if (isStillSelected(target)) setRevokeBusy(false);
    }
  }

  /** Un-admits this attendee regardless of who checked them in or when — distinct from the operator-facing device-scoped undo on the Check-in page. */
  async function handleRevokeCheckIn() {
    if (!eventId || !attendeeId || !detail) return;
    const target = { eventId, attendeeId };
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await revokeAttendeeCheckIn(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      await loadDetail();
      setActiveRevoke(null);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setRevokeError(operatorApiErrorMessage(err, "Could not revoke check-in."));
    } finally {
      if (isStillSelected(target)) setRevokeBusy(false);
    }
  }

  /** Resets every issued/returned item back to pending for just this attendee — there's no
   * attendee-scoped endpoint, so this reuses the Attendees list's bulk revoke-items endpoint
   * with a single-element id array (PO report: "brakuje nam opcji revoke items w osobie, mamy
   * chyba już mechanizm utworzony"). */
  async function handleRevokeItems() {
    // This handler is reachable only from the loaded attendee view, which already returns early
    // for missing route params or detail. Keeping that invariant here avoids a second, unreachable
    // guard and makes the single-attendee bulk request explicit.
    const target = { eventId: eventId!, attendeeId: attendeeId! };
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      const { revokedCount } = await bulkRevokeItems(target.eventId, [target.attendeeId]);
      if (!isStillSelected(target)) return;
      await loadDetail();
      setActiveRevoke(null);
      const toast = revokeItemsToast(revokedCount);
      addToast(toast.message, toast.variant);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setRevokeError(operatorApiErrorMessage(err, "Could not revoke items."));
    } finally {
      if (isStillSelected(target)) setRevokeBusy(false);
    }
  }

  /** Voids the wallet pass at the provider (e.g. PassCreator) - it stays installed on the
   * attendee's phone but shows as invalid there. */
  async function handleWalletVoid() {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    setWalletBusy(true);
    setWalletError(null);
    try {
      await voidWalletPass(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      await loadDetail();
      setActiveWalletAction(null);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setWalletError(operatorApiErrorMessage(err, "Could not void the wallet pass."));
    } finally {
      if (isStillSelected(target)) setWalletBusy(false);
    }
  }

  /** Reverses a previous void, restoring the wallet pass to active at the provider. */
  async function handleWalletRestore() {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    setWalletBusy(true);
    setWalletError(null);
    try {
      await restoreWalletPass(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      await loadDetail();
      setActiveWalletAction(null);
    } catch (err) {
      if (!isStillSelected(target)) return;
      setWalletError(operatorApiErrorMessage(err, "Could not restore the wallet pass."));
    } finally {
      if (isStillSelected(target)) setWalletBusy(false);
    }
  }

  /** Pushes the attendee's current name/ticket type/event details to the already-issued wallet
   * pass, e.g. after a ticket type change or a corrected name. */
  async function handleWalletReissue() {
    if (!eventId || !attendeeId) return;
    const target = { eventId, attendeeId };
    setWalletBusy(true);
    setWalletError(null);
    try {
      await reissueWalletPass(eventId, attendeeId);
      if (!isStillSelected(target)) return;
      await loadDetail();
      setActiveWalletAction(null);
      addToast("Wallet pass reissued.", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      setWalletError(operatorApiErrorMessage(err, "Could not reissue the wallet pass."));
    } finally {
      if (isStillSelected(target)) setWalletBusy(false);
    }
  }

  /** Adds a staff note from the Notes tab - same AttendeeNote model as check-in's note
   * composer, so the response's full detail DTO (incl. the new note) replaces local state
   * directly, matching handlePassStatusChange's toast-on-success / inline-error-on-failure split. */
  async function handleAddNote() {
    const body = noteDraft.trim();
    // The Notes tab only renders after the route and detail are present, and the Add button is
    // disabled for an empty draft. The server remains authoritative for the same validation.
    const target = { eventId: eventId!, attendeeId: attendeeId! };
    setNoteSubmitting(true);
    try {
      const updated = await addAttendeeNote(eventId!, attendeeId!, body);
      if (!isStillSelected(target)) return;
      setDetail(updated);
      setNotesPage(updated.notes_page);
      setNoteDraft("");
      addToast("Note added", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      addToast(operatorApiErrorMessage(err, "Could not add note."), "error");
    } finally {
      if (isStillSelected(target)) setNoteSubmitting(false);
    }
  }

  /** Opens the inline editor on a note's own body - server re-checks own-note-only regardless
   * of what the Edit button's visibility already hides. */
  function handleStartEditNote(note: AttendeeDetailDto["notes"][number]) {
    setEditingNoteId(note.id);
    setNoteEditDraft(note.body);
  }

  function handleCancelEditNote() {
    setEditingNoteId(null);
    setNoteEditDraft("");
  }

  async function handleSaveEditNote() {
    const body = noteEditDraft.trim();
    // Save is only rendered for the selected note, and disabled until its draft is non-empty.
    const target = { eventId: eventId!, attendeeId: attendeeId! };
    setNoteEditSubmitting(true);
    try {
      const updated = await updateAttendeeNote(eventId!, attendeeId!, editingNoteId!, body);
      if (!isStillSelected(target)) return;
      setDetail(updated);
      setNotesPage(updated.notes_page);
      setEditingNoteId(null);
      setNoteEditDraft("");
      addToast("Note updated", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      addToast(operatorApiErrorMessage(err, "Could not update note."), "error");
    } finally {
      if (isStillSelected(target)) setNoteEditSubmitting(false);
    }
  }

  /** Confirm-dialog-driven delete - canDeleteNote() in AttendeeNotesTab already hides the
   * Delete button when neither ownership nor role rules allow it, but the server is the
   * authority (resolves the note author's role itself before deciding). */
  async function handleConfirmDeleteNote() {
    // This callback is mounted only while a note id is selected in the open confirmation dialog.
    const target = { eventId: eventId!, attendeeId: attendeeId! };
    setNoteDeleting(true);
    setNoteDeleteError(null);
    try {
      const updated = await deleteAttendeeNote(eventId!, attendeeId!, noteDeleteId!);
      if (!isStillSelected(target)) return;
      setDetail(updated);
      setNotesPage(updated.notes_page);
      setNoteDeleteId(null);
      addToast("Note deleted", "success");
    } catch (err) {
      if (!isStillSelected(target)) return;
      setNoteDeleteError(operatorApiErrorMessage(err, "Could not delete note."));
    } finally {
      if (isStillSelected(target)) setNoteDeleting(false);
    }
  }

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // the skeleton on and off faster than it can register as loading — show it only once
  // the fetch has genuinely taken a moment.
  const showLoadingSkeleton = useDelayedLoading(loading);

  if (!eventId || !attendeeId) return <p>Missing event or attendee.</p>;

  if (loading && !detail) {
    return whenShown(
      showLoadingSkeleton,
      <div className="attendee-detail-page screen">
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="rect" height={240} className="attendee-detail-skeleton" />
      </div>,
    );
  }

  if (notFound) {
    return (
      <div className="attendee-detail-page screen">
        <PageHeader title="Attendee not found" actions={<Button variant="secondary" onClick={goBack}>Back</Button>} />
        <p>The attendee could not be found or you do not have access.</p>
      </div>
    );
  }

  if (!detail || !form) {
    return (
      <div className="attendee-detail-page screen">
        <PageHeader title="Attendee" actions={<Button variant="secondary" onClick={goBack}>Back</Button>} />
        {error && <p className="text-error">{error}</p>}
      </div>
    );
  }

  const lastMail = detail.deliveries[0]?.status ?? null;
  const emailChanged = form.email !== initialEmail;
  const isRevoked = detail.status === "revoked";
  // A stored ticket_type with no matching catalog entry (type deleted after assignment, or
  // legacy pre-catalog data) has no option to bind to — the picker would otherwise silently
  // fall back to the blank "—" option while form.ticket_type still holds the orphaned value,
  // hiding it from the admin. Surface it as its own option instead (fail-open, same philosophy
  // as ticketTypeBadge.tsx's catalog resolver).
  const orphanedTicketType = resolveOrphanedTicketType(form.ticket_type, ticketTypes);
  const attendeeSource = deriveAttendeeSource(detail.action_log);
  const customDataEntries = allCustomDataEntries(detail.custom_data, attributeFields, humanizeFieldKey);
  // Falls back to [] against a stale API response missing this field (e.g. an apps/web dev
  // server running from before event_items was added - it doesn't hot-reload) instead of
  // crashing the whole page on detail.event_items.length.
  const eventItems = detail.event_items ?? [];
  // Same has_issued_items && status !== "cancelled" && status !== "revoked" gate as the
  // Attendees list's bulk "Revoke items" (revokableItemsCount), checked for just this attendee.
  const hasIssuedItems = eventItems.some((item) => item.state === "issued" || item.state === "returned");
  const canRevokeItemsForAttendee =
    hasIssuedItems && detail.status !== "cancelled" && detail.status !== "revoked";
  // Menu item stays visible and just disables instead of vanishing (PO report on "Revoke
  // check-in" popping in/out of the menu) - blocked: isRevoked folds the "pass revoked" case
  // into the same disabled state instead of a separate hide condition.
  const canRevokeCheckInForAttendee = canRevokeCheckIn({
    checkInStatus: detail.check_in_status,
    blocked: isRevoked,
  });
  // Stacked day/time (e.g. "Today" / "14:51 UTC+2"), same shape as the Attendees list's check-in
  // cell - a single truncated line hid the time on narrow chips (PO report: "godziny na mobile
  // nie widzimy"). Usually short enough to never truncate, but the numeric UTC offset can push a
  // same-day fallback ("28 Jul 2026" / "04:30 PM UTC+5:30") past the chip's width for a
  // half-hour-offset zone like India's - title carries the untruncated text as a hover fallback.
  const admissionParts = detail.admitted_at
    ? formatAdmissionDisplayParts(detail.admitted_at, event.timezone)
    : null;

  return (
    <div className="attendee-detail-page screen">
      <PageHeader
        title={detail.name}
        subtitle="Manage this attendee's profile, ticket, and check-in status."
        className="attendee-detail-pageheader"
        actions={
          <>
            {isDesktop && (
              <ArchivedGuard event={event} reasonId="edit-profile-reason">
                {(guard) => (
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<i className="ti ti-pencil" aria-hidden="true" />}
                    {...guard}
                    onClick={() => setEditMode(true)}
                  >
                    Edit
                  </Button>
                )}
              </ArchivedGuard>
            )}
            {/* Revoke pass/check-in/items and Restore pass all live only in the More actions
             * menu now, on every viewport (see RevokeActionMenuItems above) - the standalone header
             * "Revoke" dropdown was folded in there too (PO report: "te revoke przenieś też na
             * desktop do more actions"), and Restore pass followed the same move so it sits "w
             * miejscu revoke pass" and goes through the same confirm-dialog gate instead of
             * firing immediately on click (PO report). */}
            <MoreActionsMenu
              event={event}
              mailConfigured={mailConfigured}
              showEdit={!isDesktop}
              onEdit={() => setEditMode(true)}
              onResend={() => setResendOpen(true)}
              onDelete={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
              canRevokeCheckIn={canRevokeCheckInForAttendee}
              revokeCheckInTooltip={revokeCheckInMenuTooltip(detail.check_in_status, isRevoked)}
              canRevokeItems={canRevokeItemsForAttendee}
              revokeItemsTooltip={revokeItemsMenuTooltip(eventItems.length, canRevokeItemsForAttendee)}
              isRevoked={isRevoked}
              revokeBusy={revokeBusy}
              onRevokeCheckIn={() => {
                setRevokeError(null);
                setActiveRevoke("checkin");
              }}
              onRevokeItems={() => {
                setRevokeError(null);
                setActiveRevoke("items");
              }}
              onRestorePass={() => {
                setRevokeError(null);
                setRestoreCapacityBlocked(null);
                setRestoreForceCapacity(false);
                setActiveRevoke("restore");
              }}
              onRevokePass={() => {
                setRevokeError(null);
                setActiveRevoke("pass");
              }}
              walletPass={detail.wallet_pass}
              walletBusy={walletBusy}
              onVoidWallet={() => {
                setWalletError(null);
                setActiveWalletAction("void");
              }}
              onRestoreWallet={() => {
                setWalletError(null);
                setActiveWalletAction("restore");
              }}
              onReissueWallet={() => {
                setWalletError(null);
                setActiveWalletAction("reissue");
              }}
            />
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
          </>
        }
      />

      {/* Not shown while the Edit modal is open - that error text renders inside the modal
          itself instead, otherwise it's stuck behind the modal's opaque backdrop, invisible
          (bot review), and duplicated in the DOM behind it if left unconditional here. */}
      {error && !editMode && <p className="text-error">{error}</p>}
      {itemsWarning && <Notice variant="warning" className="attendee-form__warn">{itemsWarning}</Notice>}

      <div className="attendee-status-strip">
        <div className="attendee-status-chip">
          <span className={`attendee-status-chip__icon attendee-status-chip__icon--${passStatusTone(detail.status)}`}>
            <i className="ti ti-user-check" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Pass</strong>
            <PassStatusBadge status={detail.status} />
          </div>
        </div>
        <div className="attendee-status-chip">
          <span className={`attendee-status-chip__icon attendee-status-chip__icon--${rsvpTone(detail.rsvp_status)}`}>
            <i className="ti ti-calendar-question" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Attendance</strong>
            <RsvpStatusBadge status={detail.rsvp_status} />
          </div>
        </div>
        <div className="attendee-status-chip">
          <span className={`attendee-status-chip__icon attendee-status-chip__icon--${mailTone(lastMail)}`}>
            <i className="ti ti-mail" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Ticket delivery</strong>
            <MailStatusBadge status={lastMail} />
          </div>
        </div>
        <div className="attendee-status-chip">
          <span className={`attendee-status-chip__icon attendee-status-chip__icon--${detail.admitted_at ? "ok" : "neutral"}`}>
            <i className="ti ti-qrcode" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Check-in</strong>
            {admissionParts ? (
              <span className="attendee-status-chip__checkin" title={`${admissionParts.day}, ${admissionParts.time}`}>
                <span className="attendee-status-chip__checkin-day">{admissionParts.day}</span>
                <span className="attendee-status-chip__checkin-time">{admissionParts.time}</span>
              </span>
            ) : (
              <span>Not yet</span>
            )}
          </div>
        </div>
        <div className="attendee-status-chip">
          <span className={`attendee-status-chip__icon attendee-status-chip__icon--${walletTone(detail.wallet_pass)}`}>
            <i className="ti ti-wallet" aria-hidden="true" />
          </span>
          <div className="attendee-status-chip__body">
            <strong>Wallet</strong>
            <WalletStatusBadge status={detail.wallet_pass?.status ?? null} />
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "activity", label: "Activity log" },
          { id: "notes", label: "Notes", count: detail.notes_total || undefined },
        ]}
      />

      {tab === "overview" && (
        <AttendeeOverviewTab
          detail={detail}
          ticketTypes={ticketTypes}
          attendeeSource={attendeeSource}
          customDataEntries={customDataEntries}
          eventItems={eventItems}
          event={event}
        />
      )}

      {tab === "activity" && (
        <AttendeeActivityTab
          actionLog={detail.action_log}
          attributeFields={attributeFields}
          eventItems={eventItems}
          event={event}
        />
      )}

      {tab === "notes" && (
        <AttendeeNotesTab
          notes={detail.notes ?? []}
          notesTotal={detail.notes_total ?? detail.notes?.length ?? 0}
          notesPage={detail.notes_page ?? 1}
          notesPageSize={detail.notes_page_size ?? 50}
          onPageChange={setNotesPage}
          event={event}
          draft={noteDraft}
          onDraftChange={setNoteDraft}
          onSubmit={() => void handleAddNote()}
          submitting={noteSubmitting}
          currentUserId={user?.id}
          superadminUser={superadmin}
          orgAdminUser={orgAdmin}
          editState={{
            noteId: editingNoteId,
            draft: noteEditDraft,
            submitting: noteEditSubmitting,
          }}
          onEditDraftChange={setNoteEditDraft}
          onStartEdit={handleStartEditNote}
          onCancelEdit={handleCancelEditNote}
          onSaveEdit={() => void handleSaveEditNote()}
          onRequestDelete={setNoteDeleteId}
          mutationsDisabled={isEventArchived(event)}
        />
      )}

      {editMode && (
        <dialog className="attendee-edit-modal" open aria-modal="true" aria-labelledby={editTitleId}>
          <ModalBackdrop onClose={handleCancelEdit} />
          <form ref={editPanelRef} className="attendee-edit-modal__panel" onSubmit={handleSave}>
            <h2 id={editTitleId} className="attendee-edit-modal__title">
              <i className="ti ti-pencil" aria-hidden="true" /> Edit attendee
            </h2>
            <p className="attendee-edit-modal__subtitle">
              Update this attendee&apos;s profile and ticket details.
            </p>
            {error && (
              <p className="text-error" role="alert">
                {error}
              </p>
            )}
            {staleWrite && (
              <Notice
                variant="warning"
                className="attendee-form__warn"
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleReload()}
                    disabled={reloading}
                  >
                    {reloading ? "Reloading…" : "Reload"}
                  </Button>
                }
              >
                Someone else updated this attendee. Reload and reapply your edits.
              </Notice>
            )}
            <Tooltip
              content={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
              className="attendee-form__fieldset-wrapper"
            >
              <fieldset className="attendee-form__fieldset" disabled={isEventArchived(event)}>
                <div className="at-field">
                  <label className="at-label" htmlFor="attendee-edit-rsvp-status">
                    Attendance
                  </label>
                  <SearchableSelect
                    id="attendee-edit-rsvp-status"
                    label="Attendance"
                    placeholder="Select attendance…"
                    searchPlaceholder="Search attendance…"
                    emptyLabel="No attendance options found"
                    showLabel={false}
                    value={form.rsvp_status}
                    options={RSVP_STATUS_OPTIONS}
                    onChange={(id) => setForm({ ...form, rsvp_status: id as RsvpStatus })}
                  />
                </div>
                <Input
                  label="Email"
                  type="text"
                  inputMode="email"
                  icon={<i className="ti ti-mail" aria-hidden="true" />}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  {...NO_AUTOFILL_PROPS}
                />
                {emailChanged && (
                  <Notice variant="warning" className="attendee-form__warn">
                    This changes the attendee&apos;s primary address. To send a ticket elsewhere, use Resend ticket.
                  </Notice>
                )}
                {emailConflict && (
                  <p className="attendee-form__error">This email is already used by another attendee in this event.</p>
                )}
                <Input
                  label="First name"
                  icon={<i className="ti ti-user" aria-hidden="true" />}
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  required
                  {...NO_AUTOFILL_PROPS}
                />
                <Input
                  label="Last name"
                  icon={<i className="ti ti-user" aria-hidden="true" />}
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  required
                  {...NO_AUTOFILL_PROPS}
                />
                <Input
                  label="Company"
                  icon={<i className="ti ti-building" aria-hidden="true" />}
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
                <Input
                  label="Department"
                  icon={<i className="ti ti-sitemap" aria-hidden="true" />}
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
                <div className="at-field">
                  <label className="at-label" htmlFor="attendee-edit-ticket-type">
                    Ticket type
                  </label>
                  <SearchableSelect
                    id="attendee-edit-ticket-type"
                    label="Ticket type"
                    placeholder="Select ticket type…"
                    searchPlaceholder="Search ticket types…"
                    emptyLabel="No ticket types found"
                    showLabel={false}
                    value={form.ticket_type}
                    options={buildTicketTypeOptions(orphanedTicketType, ticketTypes)}
                    onChange={(id) => setForm({ ...form, ticket_type: id })}
                  />
                </div>
                {ticketTypesError && (
                  <p className="attendee-form__error">
                    {ticketTypesError}{" "}
                    <button type="button" className="link-btn" onClick={loadTicketTypes}>
                      Retry
                    </button>
                  </p>
                )}
                {attributeFields.map((field) => (
                  <CustomDataFieldInput
                    key={field.source_field}
                    field={field}
                    value={form.customFields[field.source_field] ?? ""}
                    disabled={saving || reloading || staleWrite}
                    onChange={(next) =>
                      setForm({
                        ...form,
                        customFields: { ...form.customFields, [field.source_field]: next },
                      })
                    }
                  />
                ))}
              </fieldset>
            </Tooltip>
            <div className="attendee-form__actions">
              <Button type="button" variant="secondary" onClick={handleCancelEdit} disabled={saving}>
                Cancel
              </Button>
              <ArchivedGuard
                event={event}
                reasonId="save-changes-reason"
                disabled={saving || reloading || staleWrite}
              >
                {(guard) => (
                  <Button type="submit" variant="primary" {...guard}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                )}
              </ArchivedGuard>
            </div>
          </form>
        </dialog>
      )}

      {resendOpen && (
        <dialog className="attendee-resend-modal" open aria-modal="true" aria-labelledby={resendTitleId}>
          <ModalBackdrop onClose={() => setResendOpen(false)} />
          <form ref={resendPanelRef} className="attendee-resend-modal__panel" onSubmit={handleResend}>
            <h3 id={resendTitleId} className="attendee-resend-modal__title">Resend ticket</h3>
            {resendError && <Notice variant="error" role="alert">{resendError}</Notice>}
            <div className="attendee-resend-options">
              <label>
                <input type="radio" name="resendMode" checked={resendMode === "same"} onChange={() => setResendMode("same")} />
                Same address ({detail.email})
              </label>
              <label>
                <input type="radio" name="resendMode" checked={resendMode === "other"} onChange={() => setResendMode("other")} />{" "}
                Other address
              </label>
            </div>
            {resendMode === "other" && (
              <Input label="Recipient email" type="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} />
            )}
            <div className="attendee-form__actions">
              <Button type="button" variant="secondary" onClick={() => setResendOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={resending}>{resending ? "Sending…" : "Send"}</Button>
            </div>
          </form>
        </dialog>
      )}

      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        message={
          discardIntent === "back"
            ? "You have unsaved profile edits. Leave without saving?"
            : "You have unsaved profile edits. Discard them?"
        }
        confirmLabel={discardIntent === "back" ? "Leave" : "Discard"}
        onConfirm={() => {
          setDiscardOpen(false);
          if (discardIntent === "back") {
            goBack();
          } else {
            if (baseline) setForm(baseline);
            setEditMode(false);
            setError(null);
            setEmailConflict(false);
          }
        }}
        onCancel={() => setDiscardOpen(false)}
      />

      <ConfirmDialog
        open={activeRevoke === "pass"}
        title="Revoke pass?"
        message="This attendee will no longer be able to check in. You can restore the pass later if capacity allows."
        confirmLabel="Revoke"
        confirmVariant="danger"
        loading={revokeBusy}
        errorMessage={revokeError ?? undefined}
        onConfirm={() => void handlePassStatusChange("revoked")}
        onCancel={() => {
          if (!revokeBusy) {
            setActiveRevoke(null);
            setRevokeError(null);
          }
        }}
      />

      <ConfirmDialog
        open={activeRevoke === "restore"}
        title="Restore pass?"
        message={`This re-enables check-in for ${detail.name}.`}
        confirmLabel="Restore"
        confirmVariant="primary"
        loading={revokeBusy}
        errorMessage={revokeError ?? undefined}
        onConfirm={() =>
          void handlePassStatusChange("registered", { force: restoreForceCapacity && superadmin })
        }
        onCancel={() => {
          if (!revokeBusy) {
            setActiveRevoke(null);
            setRevokeError(null);
          }
        }}
      >
        {restoreCapacityBlocked && superadmin && (
          <label className="attendee-restore-force">
            <input
              type="checkbox"
              checked={restoreForceCapacity}
              onChange={(e) => setRestoreForceCapacity(e.target.checked)}
              disabled={revokeBusy}
            />
            <span>Override capacity limit (superadmin)</span>
          </label>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={activeRevoke === "checkin"}
        title="Revoke check-in?"
        message={`This un-admits ${detail.name}. They'll show as not checked in and will need to be scanned or admitted again to re-enter. This works regardless of when or how they were originally checked in.`}
        confirmLabel="Revoke"
        confirmVariant="danger"
        loading={revokeBusy}
        errorMessage={revokeError ?? undefined}
        onConfirm={() => void handleRevokeCheckIn()}
        onCancel={() => {
          if (!revokeBusy) {
            setActiveRevoke(null);
            setRevokeError(null);
          }
        }}
      />

      <ConfirmDialog
        open={activeRevoke === "items"}
        title="Revoke items?"
        message={`Every issued item (badge, wristband, giftbag, …) for ${detail.name} is reset to pending. Items can be re-issued from the check-in screen at any time.`}
        confirmLabel="Revoke"
        confirmVariant="warning"
        loading={revokeBusy}
        errorMessage={revokeError ?? undefined}
        onConfirm={() => void handleRevokeItems()}
        onCancel={() => {
          if (!revokeBusy) {
            setActiveRevoke(null);
            setRevokeError(null);
          }
        }}
      />

      <ConfirmDialog
        open={activeWalletAction === "void"}
        title="Void wallet pass?"
        message={`${detail.name}'s pass stays installed on their phone but shows as invalid in Apple/Google Wallet. You can restore it later.`}
        confirmLabel="Void"
        confirmVariant="danger"
        loading={walletBusy}
        errorMessage={walletError ?? undefined}
        onConfirm={() => void handleWalletVoid()}
        onCancel={() => {
          if (!walletBusy) {
            setActiveWalletAction(null);
            setWalletError(null);
          }
        }}
      />

      <ConfirmDialog
        open={activeWalletAction === "restore"}
        title="Restore wallet pass?"
        message={`This shows ${detail.name}'s pass as valid again in Apple/Google Wallet.`}
        confirmLabel="Restore"
        confirmVariant="primary"
        loading={walletBusy}
        errorMessage={walletError ?? undefined}
        onConfirm={() => void handleWalletRestore()}
        onCancel={() => {
          if (!walletBusy) {
            setActiveWalletAction(null);
            setWalletError(null);
          }
        }}
      />

      <ConfirmDialog
        open={activeWalletAction === "reissue"}
        title="Reissue wallet pass?"
        message={`Pushes ${detail.name}'s current name, ticket type, and event details to their already-installed wallet pass.`}
        confirmLabel="Reissue"
        confirmVariant="primary"
        loading={walletBusy}
        errorMessage={walletError ?? undefined}
        onConfirm={() => void handleWalletReissue()}
        onCancel={() => {
          if (!walletBusy) {
            setActiveWalletAction(null);
            setWalletError(null);
          }
        }}
      />

      <ConfirmDialog
        open={noteDeleteId !== null}
        title="Delete this note?"
        message="This permanently removes the note. This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={noteDeleting}
        errorMessage={noteDeleteError ?? undefined}
        onConfirm={() => void handleConfirmDeleteNote()}
        onCancel={() => {
          if (!noteDeleting) {
            setNoteDeleteId(null);
            setNoteDeleteError(null);
          }
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Permanently delete this attendee?"
        message={`This cannot be undone. Deleting ${detail.name} permanently removes:`}
        errorMessage={deleteError}
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
        confirmationValue={detail.name}
        confirmationLabel={`Type the attendee's name to confirm: "${detail.name}"`}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => {
          if (!deleting) {
            setDeleteOpen(false);
            setDeleteError(null);
          }
        }}
      >
        <ul className="confirm-dialog__list">
          <li>Profile and contact details</li>
          <li>Ticket deliveries</li>
          <li>Wallet pass</li>
          <li>Check-in history</li>
        </ul>
      </ConfirmDialog>
    </div>
  );
}
