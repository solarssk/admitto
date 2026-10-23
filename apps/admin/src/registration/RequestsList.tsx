import { Badge, Button, EmptyState, Skeleton, StatusBadge } from "@admitto/ui";
import type { RegistrationListItemDto, RegistrationMailBriefDto } from "../api/types.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import {
  requestCompanionsLabel,
  requestGuestName,
  requestMailKind,
  requestMailTone,
} from "./registrationRequests.js";
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
function BreakableAddress({ address }: Readonly<{ address: string }>) {
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

function RequestTableRow({ row }: Readonly<{ row: RegistrationListItemDto }>) {
  return (
    <tr>
      <td>
        <RequestGuest row={row} />
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
function RequestCard({ row }: Readonly<{ row: RegistrationListItemDto }>) {
  const affiliation = [row.company, row.department].filter(Boolean).join(" · ");
  return (
    <li className="registration-requests__card">
      <RequestGuest row={row} />
      {affiliation ? <span className="registration-requests__affiliation">{affiliation}</span> : null}
      <div className="registration-requests__card-facts">
        <RequestStatus status={row.status} />
        <RequestTime iso={row.created_at} />
      </div>
      <div className="registration-requests__card-mail">
        <span className="registration-requests__card-label">Last email</span>
        <RequestMail mail={row.last_mail} />
      </div>
    </li>
  );
}

const COLUMNS = ["Guest", "Company", "Status", "Last email", "Registered"] as const;

/** The heading row of the table, which its placeholder draws too. */
function ColumnHeads() {
  return (
    <tr>
      {COLUMNS.map((column) => (
        <th key={column} scope="col">
          {column}
        </th>
      ))}
    </tr>
  );
}

/** The requests of one page: a table on a wide screen, cards on a narrow one. */
export function RequestsRows({
  items,
  isDesktop,
}: Readonly<{ items: readonly RegistrationListItemDto[]; isDesktop: boolean }>) {
  if (!isDesktop) {
    return (
      <ul className="registration-requests__cards" aria-label="Requests">
        {items.map((row) => (
          <RequestCard key={row.id} row={row} />
        ))}
      </ul>
    );
  }
  return (
    <div className="registration-requests__table-wrap">
      <table className="table registration-requests__table" aria-label="Requests">
        <thead>
          <ColumnHeads />
        </thead>
        <tbody>
          {items.map((row) => (
            <RequestTableRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What an empty page says: nothing has been sent yet, or the search and filters select nothing (with the way out). */
export function RequestsEmpty({
  filtered,
  onClearFilters,
  onClearFocus,
}: Readonly<{
  filtered: boolean;
  onClearFilters: () => void;
  /** The button that clears the filters has the focus: it will be gone when the list comes back, and the focus has to be handed on. */
  onClearFocus: () => void;
}>) {
  if (filtered) {
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
                  <td colSpan={COLUMNS.length}>
                    <Skeleton variant="rect" height={TABLE_ROW_HEIGHT - TABLE_ROW_CHROME} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="registration-requests__cards" aria-hidden="true">
          {Array.from({ length: SKELETON_CARDS }, (_, row) => (
            <div className="registration-requests__card" key={row}>
              <Skeleton variant="rect" height={CARD_HEIGHT - CARD_CHROME} />
            </div>
          ))}
        </div>
      )}
      {status}
    </div>
  );
}
