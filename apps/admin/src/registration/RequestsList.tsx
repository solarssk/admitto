import type { ReactNode } from "react";
import { Badge, Button, Checkbox, EmptyState, Skeleton, StatusBadge } from "@admitto/ui";
import type { RegistrationListItemDto, RegistrationMailBriefDto } from "../api/types.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import {
  requestCompanionsLabel,
  requestGuestName,
  requestMailKind,
  requestMailTone,
} from "./registrationRequests.js";
import type { RequestSelection } from "./useRequestSelection.js";
import "./registration-requests.css";

/** Rows a placeholder draws when it does not know how many the list will have. Cards are taller, so fewer of them fill a screen, and the note that says the wait is long, under them, stays in view on a phone. */
const SKELETON_ROWS = 6;
const SKELETON_CARDS = 3;
/** The height of a request in the table (two lines: the name and the address) and in the cards (the guest, the company, the state and the last email; 122px when the guest has no company), measured in Chrome against the real ones. */
const TABLE_ROW_HEIGHT = 64;
const CARD_HEIGHT = 150;
/** What a row and a card add around the bar that stands for their content: the padding and the rule under them. */
const TABLE_ROW_CHROME = 21;
const CARD_CHROME = 25;

/** The last email a request was queued, as a badge and what it was; a request that was queued none says so. */
function RequestMail({ mail }: Readonly<{ mail: RegistrationMailBriefDto | null }>) {
  if (mail === null) return <span className="registration-requests__none">None</span>;
  const tone = requestMailTone(mail);
  return (
    <div className="registration-requests__mail">
      <Badge variant={tone.variant}>{tone.label}</Badge>
      <span className="registration-requests__mail-kind">{requestMailKind(mail.template_name)}</span>
    </div>
  );
}

/** An address that may wrap after its "@" and its dots, so a long one breaks where it reads well and not in the middle of "com". */
export function BreakableAddress({ address }: Readonly<{ address: string }>) {
  const parts = address.split(/(?<=[@.])/u);
  let offset = 0;
  const nodes = parts.flatMap((part, index) => {
    offset += part.length;
    // No break after the last part.
    return index < parts.length - 1 ? [part, <wbr key={offset} />] : [part];
  });
  return <>{nodes}</>;
}

/** The guest: the name (with "+1" for someone they bring), then the address, which wraps rather than being cut. */
function RequestGuest({ row }: Readonly<{ row: RegistrationListItemDto }>) {
  const plus = requestCompanionsLabel(row.companions_count);
  return (
    <div className="registration-requests__guest">
      <span className="registration-requests__name">
        {requestGuestName(row)}
        {plus ? (
          <span className="registration-requests__plus">
            <span aria-hidden="true">{plus}</span>
            <span className="sr-only">, brings {row.companions_count === 1 ? "1 companion" : `${row.companions_count} companions`}</span>
          </span>
        ) : null}
      </span>
      <span className="registration-requests__email">
        <BreakableAddress address={row.email} />
      </span>
    </div>
  );
}

/** What a click on a request does: opens it in full. The button is the one way to it with a keyboard, and the element the focus comes back to. */
export type OpenRequest = (row: RegistrationListItemDto, opener: HTMLElement) => void;

/** The guest as the button that opens the request. `data-request-open` is how the tab finds the row the keyboard goes to when a request leaves the page. */
function OpenRequestButton({ row, onOpen, className }: Readonly<{ row: RegistrationListItemDto; onOpen: OpenRequest; className?: string }>) {
  return (
    <button
      type="button"
      className={["attendees-row-btn", "registration-requests__open", className].filter(Boolean).join(" ")}
      data-request-open={row.id}
      aria-haspopup="dialog"
      onClick={(event) => onOpen(row, event.currentTarget)}
    >
      <RequestGuest row={row} />
    </button>
  );
}

/** What a screen reader says of the checkbox of a request: the guest's name. */
const selectLabel = (row: RegistrationListItemDto): string => `Select ${requestGuestName(row)}`;

function RequestCompany({ row }: Readonly<{ row: RegistrationListItemDto }>) {
  return (
    <div className="registration-requests__company">
      <span>{row.company ?? "-"}</span>
      {row.department ? <span className="registration-requests__department">{row.department}</span> : null}
    </div>
  );
}

/** The time the guest sent the request: the same text for every viewer, in UTC (it has no zone of its own). */
function RequestTime({ iso }: Readonly<{ iso: string }>) {
  return <time dateTime={iso}>{formatUtcDateTime(iso)}</time>;
}

function RequestStatus({ status }: Readonly<{ status: RegistrationListItemDto["status"] }>) {
  return <StatusBadge status={`registration_${status}`} />;
}

interface RowProps {
  row: RegistrationListItemDto;
  selected: boolean;
  onToggle: () => void;
  onOpen: OpenRequest;
}

function RequestTableRow({ row, selected, onToggle, onOpen }: Readonly<RowProps>) {
  return (
    <tr className={selected ? "attendees-table-v2__row attendees-table-v2__row--selected" : "attendees-table-v2__row"}>
      <td>
        <Checkbox checked={selected} onChange={onToggle} aria-label={selectLabel(row)} />
      </td>
      <td>
        <OpenRequestButton row={row} onOpen={onOpen} />
      </td>
      <td>
        <RequestCompany row={row} />
      </td>
      <td>
        <RequestStatus status={row.status} />
      </td>
      <td>
        <RequestMail mail={row.last_mail} />
      </td>
      <td>
        <RequestTime iso={row.created_at} />
      </td>
    </tr>
  );
}

/** A request as a card, for a screen too narrow for the table. */
function RequestCard({ row, selected, onToggle, onOpen }: Readonly<RowProps>) {
  const affiliation = [row.company, row.department].filter(Boolean).join(" · ");
  return (
    <li className={selected ? "registration-requests__card registration-requests__card--selected" : "registration-requests__card"}>
      <div className="registration-requests__card-top">
        <span className="registration-requests__card-cb">
          <Checkbox checked={selected} onChange={onToggle} aria-label={selectLabel(row)} />
        </span>
        <OpenRequestButton row={row} onOpen={onOpen} className="registration-requests__card-open" />
      </div>
      <div className="registration-requests__card-detail">
        {affiliation ? <span className="registration-requests__affiliation">{affiliation}</span> : null}
        <div className="registration-requests__card-facts">
          <RequestStatus status={row.status} />
          <RequestTime iso={row.created_at} />
        </div>
        <div className="registration-requests__card-mail">
          <span className="registration-requests__card-label">Last email</span>
          <RequestMail mail={row.last_mail} />
        </div>
      </div>
    </li>
  );
}

const COLUMNS = ["Guest", "Company", "Status", "Last email", "Registered"] as const;

/** The heading row of the table, which its placeholder draws too: the first column holds the checkbox that selects the page. */
function ColumnHeads({ selectAll }: Readonly<{ selectAll?: ReactNode }>) {
  return (
    <tr>
      <th scope="col" className="attendees-table-v2__checkbox-col">
        {selectAll}
      </th>
      {COLUMNS.map((column) => (
        <th key={column} scope="col">
          {column}
        </th>
      ))}
    </tr>
  );
}

/** The requests of one page: a table on a wide screen, cards on a narrow one, each with a checkbox for the bulk bar and a button that opens it. */
export function RequestsRows({
  items,
  isDesktop,
  selection,
  onOpen,
}: Readonly<{ items: readonly RegistrationListItemDto[]; isDesktop: boolean; selection: RequestSelection; onOpen: OpenRequest }>) {
  const rowProps = (row: RegistrationListItemDto): RowProps => ({
    row,
    selected: selection.isSelected(row.id),
    onToggle: () => selection.toggle(row.id),
    onOpen,
  });
  if (!isDesktop) {
    return (
      <div className="registration-requests__cards-wrap">
        <div className="attendees-cards__selectall">
          <Checkbox label="Select all" checked={selection.allSelected} onChange={selection.toggleAll} />
        </div>
        <ul className="registration-requests__cards" aria-label="Requests">
          {items.map((row) => (
            <RequestCard key={row.id} {...rowProps(row)} />
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="registration-requests__table-wrap">
      <table className="table registration-requests__table" aria-label="Requests">
        <thead>
          <ColumnHeads
            selectAll={<Checkbox checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all" />}
          />
        </thead>
        <tbody>
          {items.map((row) => (
            <RequestTableRow key={row.id} {...rowProps(row)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What an empty page says: nothing has been sent yet, the queue is clear (the only filter is "waiting for a decision": the work
 * is done), or the search and filters select nothing (with the way out).
 */
export type RequestsEmptyKind = "none" | "queue" | "filtered";

export function RequestsEmpty({
  kind,
  onClearFilters,
  onClearFocus,
}: Readonly<{
  kind: RequestsEmptyKind;
  onClearFilters: () => void;
  /** The button that clears the filters has the focus: it will be gone when the list comes back, and the focus has to be handed on. */
  onClearFocus: () => void;
}>) {
  if (kind === "queue") {
    return (
      <EmptyState
        icon={<i className="ti ti-circle-check" aria-hidden="true" />}
        title="Nothing is waiting for a decision"
        description="Requests that need a decision are listed here."
        action={
          <Button type="button" variant="secondary" onFocus={onClearFocus} onClick={onClearFilters}>
            Show all requests
          </Button>
        }
      />
    );
  }
  if (kind === "filtered") {
    return (
      <EmptyState
        icon={<i className="ti ti-search-off" aria-hidden="true" />}
        title="No matches"
        description="Try a different search, or clear your filters."
        action={
          <Button type="button" variant="secondary" onFocus={onClearFocus} onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={<i className="ti ti-clipboard-list" aria-hidden="true" />}
      title="No requests yet"
      description="Guests who register through the form are listed here."
    />
  );
}

/**
 * The placeholder of the first read: the headings of the table (or the cards) with a grey bar for each row, in a status region
 * named after what is loading. `held` is the first 200ms, when the room is reserved and nothing is drawn; after 8 seconds
 * (`slow`) the region says it is taking longer than usual.
 */
export function RequestsSkeleton({
  isDesktop,
  held,
  slow,
}: Readonly<{ isDesktop: boolean; held: boolean; slow: boolean }>) {
  const status = (
    <output>
      <span className="sr-only">Loading requests</span>
      {slow ? <span className="at-hint registration-requests__slow">{SLOW_NOTICE_TEXT}</span> : null}
    </output>
  );
  return (
    <div className={held ? "at-loading-hold" : "at-fade-in"} aria-busy="true">
      {isDesktop ? (
        <div className="registration-requests__table-wrap">
          <table className="table registration-requests__table" aria-hidden="true">
            <thead>
              <ColumnHeads />
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }, (_, row) => (
                <tr key={row}>
                  <td colSpan={COLUMNS.length + 1}>
                    <Skeleton variant="rect" height={TABLE_ROW_HEIGHT - TABLE_ROW_CHROME} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="registration-requests__cards-wrap" aria-hidden="true">
          <div className="attendees-cards__selectall">
            <Skeleton variant="rect" width={88} height={16} />
          </div>
          <div className="registration-requests__cards">
            {Array.from({ length: SKELETON_CARDS }, (_, row) => (
              <div className="registration-requests__card" key={row}>
                <Skeleton variant="rect" height={CARD_HEIGHT - CARD_CHROME} />
              </div>
            ))}
          </div>
        </div>
      )}
      {status}
    </div>
  );
}
