import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Badge, Button, IconButton, ModalBackdrop, Notice, StatusBadge } from "@admitto/ui";
import { fetchRegistration } from "../api/client.js";
import type { RegistrationCompanionDto, RegistrationDetailDto, RegistrationListItemDto, RegistrationMailDto } from "../api/types.js";
import { allCustomDataEntries, isLongAnswer } from "../attendees/customData.js";
import { humanizeFieldKey } from "../attendees/attendeeTimeline.js";
import { ArchivedGuard, type ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import { panelView, usePanelLoad } from "../hooks/usePanelLoad.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { canAccept, canReject } from "./registrationDecisions.js";
import { requestGuestName, requestMailKind, requestMailTone } from "./registrationRequests.js";
import { BreakableAddress } from "./RequestsList.js";
import { RequestDetailSkeleton } from "./RequestDetailSkeleton.js";
import type { BusyDecision } from "./useRegistrationDecisions.js";
import type { RequestLookups } from "./useRequestLookups.js";
import "../communication/delivery-modals.css";
import "./request-detail.css";

/** What the window holds once it has read the request: the record, and the names behind its answers. */
interface Loaded {
  detail: RegistrationDetailDto;
  lookups: RequestLookups;
}

export interface RequestDetailDialogProps {
  eventId: string;
  event: ArchivedGuardEvent & { timezone: string };
  /** The request as the list shows it: the header and the decisions are drawn from it at once, while the rest is read. */
  row: RegistrationListItemDto;
  lookups: () => Promise<RequestLookups>;
  /** A confirmation is open over this window: its own focus trap and Escape step aside. */
  suspended: boolean;
  busy: BusyDecision;
  onClose: () => void;
  /** `record` is the request as this window knows it (its state and companions as read), which the list's row may no longer be. */
  onAsk: (kind: "accept" | "reject" | "delete", record: RegistrationListItemDto) => void;
  /** `setError` is where a failure is said: in this window, beside the button. */
  onRetryMail: (id: string, setError: (message: string | null) => void) => void;
}

function UtcTime({ iso }: Readonly<{ iso: string }>) {
  return <time dateTime={iso}>{formatUtcDateTime(iso)}</time>;
}

function Pair({ label, wide = false, children }: Readonly<{ label: string; wide?: boolean; children: ReactNode }>) {
  return (
    <div className={wide ? "request-detail__wide" : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** What the address check came to: when the guest confirmed it, that it is still waited for, or that nothing asked for it (single sign-on, or an event that does not check). */
function AddressCheck({ detail }: Readonly<{ detail: RegistrationDetailDto }>) {
  if (detail.email_verified_at) return <UtcTime iso={detail.email_verified_at} />;
  if (detail.confirm_expires_at) {
    return (
      <>
        Not confirmed yet. The link works until <UtcTime iso={detail.confirm_expires_at} />.
      </>
    );
  }
  return <>Not checked</>;
}

function Decision({ detail }: Readonly<{ detail: RegistrationDetailDto }>) {
  if (!detail.decided_at) return <>-</>;
  return (
    <>
      <UtcTime iso={detail.decided_at} />
      {detail.decided_by ? ` by ${detail.decided_by.name}` : ""}
    </>
  );
}

/** The answers as rows of the same grid: a long one under its question, over the full width. */
function Answers({ entries }: Readonly<{ entries: readonly (readonly [string, string, string])[] }>) {
  return (
    <dl className="delivery-modal-kv request-detail__grid">
      {entries.map(([key, label, value]) => (
        <Pair key={key} label={label} wide={isLongAnswer(value)}>
          {value}
        </Pair>
      ))}
    </dl>
  );
}

/** The person a guest brings: their name, then the answers about them, as the guest's own. */
function CompanionSection({
  companion,
  title,
  lookups,
  timezone,
}: Readonly<{ companion: RegistrationCompanionDto; title: string; lookups: RequestLookups; timezone: string }>) {
  const answers = allCustomDataEntries(companion.custom_data, lookups.fields, humanizeFieldKey, timezone);
  return (
    <div>
      <h3 className="delivery-modal__section-title">{title}</h3>
      <dl className="delivery-modal-kv request-detail__grid">
        <Pair label="Name">{companion.name}</Pair>
      </dl>
      {answers.length > 0 ? <Answers entries={answers} /> : null}
    </div>
  );
}

function RequestSection({ detail, lookups, timezone }: Readonly<{ detail: RegistrationDetailDto; lookups: RequestLookups; timezone: string }>) {
  const answers = allCustomDataEntries(detail.custom_data, lookups.fields, humanizeFieldKey, timezone);
  const consents = Object.entries(detail.consents);
  return (
    <>
      <div>
        <h3 className="delivery-modal__section-title">Request</h3>
        <dl className="delivery-modal-kv request-detail__grid">
          <Pair label="Status">
            <StatusBadge status={`registration_${detail.status}`} />
          </Pair>
          <Pair label="Sent">
            <UtcTime iso={detail.created_at} />
          </Pair>
          {detail.company ? <Pair label="Company">{detail.company}</Pair> : null}
          {detail.department ? <Pair label="Department">{detail.department}</Pair> : null}
          <Pair label="Address confirmed">
            <AddressCheck detail={detail} />
          </Pair>
          <Pair label="Terms accepted">{detail.accepted_at ? <UtcTime iso={detail.accepted_at} /> : "-"}</Pair>
          <Pair label="Decision">
            <Decision detail={detail} />
          </Pair>
          {detail.locale ? <Pair label="Language">{detail.locale}</Pair> : null}
        </dl>
      </div>
      {answers.length > 0 ? (
        <div>
          <h3 className="delivery-modal__section-title">Answers</h3>
          <Answers entries={answers} />
        </div>
      ) : null}
      {consents.length > 0 ? (
        <div>
          <h3 className="delivery-modal__section-title">Consents</h3>
          <dl className="delivery-modal-kv request-detail__grid">
            {consents.map(([key, given]) => (
              <Pair key={key} label={lookups.consentTitles.get(key) ?? humanizeFieldKey(key)}>
                Given <UtcTime iso={given} />
              </Pair>
            ))}
          </dl>
        </div>
      ) : null}
      {detail.companions.map((companion, index) => (
        <CompanionSection
          key={`${companion.name}-${index}`}
          companion={companion}
          title={detail.companions.length === 1 ? "Companion" : `Companion ${index + 1}`}
          lookups={lookups}
          timezone={timezone}
        />
      ))}
    </>
  );
}

/** When an email went out, or was last tried, or is waiting: the one time that says most about it. */
function MailTime({ mail }: Readonly<{ mail: RegistrationMailDto }>) {
  if (mail.sent_at) return <>Sent <UtcTime iso={mail.sent_at} /></>;
  if (mail.attempted_at) return <>Last tried <UtcTime iso={mail.attempted_at} /></>;
  return <>Queued <UtcTime iso={mail.queued_at} /></>;
}

function isFailed(mail: Pick<RegistrationMailDto, "status">): boolean {
  return mail.status === "failed" || mail.status === "bounced" || mail.status === "rejected";
}

function MailRow({
  mail,
  last,
  attendeeId,
  eventId,
  event,
  busy,
  onRetry,
}: Readonly<{
  mail: RegistrationMailDto;
  last: boolean;
  attendeeId: string | null;
  eventId: string;
  event: ArchivedGuardEvent;
  busy: boolean;
  onRetry: () => void;
}>) {
  const tone = requestMailTone(mail);
  const ticketFailed = mail.template_name === "ticket" && isFailed(mail) && attendeeId !== null;
  return (
    <li className="request-detail__mail">
      <div className="request-detail__mail-head">
        <span className="request-detail__mail-kind">{requestMailKind(mail.template_name)}</span>
        <Badge variant={tone.variant}>{tone.label}</Badge>
      </div>
      <p className="request-detail__mail-meta">
        <MailTime mail={mail} />
        {mail.attempts > 1 ? `. ${mail.attempts} attempts` : ""}
      </p>
      {isFailed(mail) && mail.error ? <p className="request-detail__mail-error">{mail.error}</p> : null}
      {last && mail.can_retry ? (
        <ArchivedGuard event={event} reasonId={`request-mail-retry-${mail.id}`}>
          {(guard) => (
            <Button type="button" variant="secondary" size="sm" icon={<i className="ti ti-mail-forward" aria-hidden="true" />} {...guard} loading={busy} onClick={onRetry}>
              Send again
            </Button>
          )}
        </ArchivedGuard>
      ) : null}
      {ticketFailed ? (
        <p className="request-detail__mail-meta">
          The ticket is sent again from the attendee&apos;s page.{" "}
          <Link className="request-detail__link" to={`/admin/events/${eventId}/attendees/${attendeeId}`}>
            Open attendee
          </Link>
        </p>
      ) : null}
    </li>
  );
}

function MailsSection({
  detail,
  eventId,
  event,
  busy,
  retryError,
  onRetry,
}: Readonly<{
  detail: RegistrationDetailDto;
  eventId: string;
  event: ArchivedGuardEvent;
  busy: boolean;
  /** Why the email could not be sent again, when it could not. */
  retryError: string | null;
  onRetry: () => void;
}>) {
  return (
    <div>
      <h3 className="delivery-modal__section-title">Emails</h3>
      {detail.mails.length === 0 ? (
        <p className="request-detail__none">No email was queued for this guest.</p>
      ) : (
        <ol className="request-detail__mails">
          {detail.mails.map((mail, index) => (
            <MailRow
              key={mail.id}
              mail={mail}
              last={index === detail.mails.length - 1}
              attendeeId={detail.attendee_id}
              eventId={eventId}
              event={event}
              busy={busy}
              onRetry={onRetry}
            />
          ))}
        </ol>
      )}
      {retryError ? (
        <Notice variant="error" role="alert">
          {retryError}
        </Notice>
      ) : null}
    </div>
  );
}

/**
 * One request in full, in a window over the list: the answers, the consents, the people the guest brings, the emails the guest was sent
 * (and the one that can be sent again), and the decisions. It follows the record-modal recipe: the header and the decisions that need
 * nothing from the record are there from the first frame, and the record is read once (`usePanelLoad`: nothing drawn for 200ms, then
 * the placeholder, a note after 8 seconds, an error with a busy Retry after 30). A decision opens its confirmation over this window (the
 * tab owns it); this window's focus trap and Escape step aside meanwhile.
 *
 * It is for one request: the tab mounts it when a request is opened and drops it when it closes, so its read never follows a changing `row`.
 * A link to the attendee needs no close of its own: the page it leads to takes the tab, and this window, away.
 */
export function RequestDetailDialog({ eventId, event, row, lookups, suspended, busy, onClose, onAsk, onRetryMail }: Readonly<RequestDetailDialogProps>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panel = usePanelLoad({
    fetch: async (signal) => {
      const [detail, names] = await Promise.all([fetchRegistration(eventId, row.id, signal), lookups()]);
      return { detail, lookups: names };
    },
    apply: setLoaded,
    fallback: "Could not load the request.",
  });
  const view = panelView(panel);
  useModalFocusTrap(panelRef, !suspended, onClose);
  useOverscrollBounceGuard(scrollRef);

  const detail = loaded?.detail ?? null;
  // The row is as old as the list: the guest may have confirmed the address, or somebody may have decided, since it was read.
  const current: RegistrationListItemDto = detail ? { ...row, status: detail.status, companions_count: detail.companions.length } : row;
  const { status } = current;
  const name = requestGuestName(row);
  const attendeeId = detail?.attendee_id ?? null;

  return (
    <dialog open className="delivery-modal" aria-modal="true" aria-labelledby="request-detail-title">
      <ModalBackdrop onClose={onClose} />
      <div ref={panelRef} className="delivery-modal__panel delivery-modal__panel--wide">
        <div ref={scrollRef} className="delivery-modal__scroll">
          <div className="delivery-modal__header">
            <div className="request-detail__who">
              <h2 id="request-detail-title" className="delivery-modal__title request-detail__name">
                {name}
              </h2>
              <p className="delivery-modal__subtitle request-detail__email">
                <BreakableAddress address={row.email} />
              </p>
            </div>
            <IconButton label="Close" onClick={onClose} icon={<i className="ti ti-x" aria-hidden="true" />} />
          </div>
          <div className="delivery-modal__body">
            {view === "loading" && <RequestDetailSkeleton held={!panel.gate.showIndicator} slow={panel.slow} />}
            {view === "error" && (
              <Notice
                variant="error"
                role="alert"
                actionBusy={panel.retrying}
                action={
                  <Button type="button" variant="secondary" size="sm" loading={panel.retrying} onClick={() => void panel.retry()}>
                    Retry
                  </Button>
                }
              >
                {panel.error}
              </Notice>
            )}
            {view === "ready" && loaded && (
              <>
                <RequestSection detail={loaded.detail} lookups={loaded.lookups} timezone={event.timezone} />
                <MailsSection
                  detail={loaded.detail}
                  eventId={eventId}
                  event={event}
                  busy={busy === "retry"}
                  retryError={retryError}
                  onRetry={() => {
                    setRetryError(null);
                    onRetryMail(row.id, setRetryError);
                  }}
                />
              </>
            )}
          </div>
          <div className="delivery-modal__footer request-detail__footer">
            <Button type="button" variant="ghost" className="request-detail__delete" icon={<i className="ti ti-trash" aria-hidden="true" />} onClick={() => onAsk("delete", current)}>
              Delete
            </Button>
            {canReject({ status }) ? (
              <ArchivedGuard event={event} reasonId="request-detail-reject-reason">
                {(guard) => (
                  <Button type="button" variant="secondary" icon={<i className="ti ti-x" aria-hidden="true" />} {...guard} onClick={() => onAsk("reject", current)}>
                    Reject
                  </Button>
                )}
              </ArchivedGuard>
            ) : null}
            {canAccept({ status }) ? (
              <ArchivedGuard event={event} reasonId="request-detail-accept-reason">
                {(guard) => (
                  <Button type="button" icon={<i className="ti ti-check" aria-hidden="true" />} {...guard} onClick={() => onAsk("accept", current)}>
                    Accept
                  </Button>
                )}
              </ArchivedGuard>
            ) : null}
            {attendeeId ? (
              <Link className="at-btn at-btn--secondary" to={`/admin/events/${eventId}/attendees/${attendeeId}`}>
                <span className="at-btn__icon" aria-hidden="true">
                  <i className="ti ti-user" aria-hidden="true" />
                </span>
                <span>Open attendee</span>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </dialog>
  );
}

