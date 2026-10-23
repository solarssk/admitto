import { REGISTRATION_STATUS, type RegistrationMailTemplateName, type RegistrationStatus } from "@admitto/db/status";
import { statusLabel } from "@admitto/ui";
import type { RegistrationCountsDto, RegistrationListItemDto, RegistrationMailBriefDto } from "../api/types.js";
import type { SearchableSelectOption } from "../components/SearchableSelect.js";

/** A state the list can be limited to, or every state. */
export type RequestStatusFilter = RegistrationStatus | "all";

/** The age filter: "every request" or one of the server's closed list (REGISTRATION_AGE_OPTIONS). */
export type RequestAgeFilter = (typeof REGISTRATION_AGE_OPTIONS)[number]["id"] | "any";

/** What a row says of a state, from the status map the badge uses, so the filter and the badge always read alike. */
export function requestStatusLabel(status: RegistrationStatus): string {
  return statusLabel(`registration_${status}`);
}

/**
 * The states in the order a staff member works through them: what waits for a decision first, then the waiting list, the
 * decided ones, and last the requests whose address is not confirmed yet (nothing to decide on them). The label of each
 * is the badge's; `requestStatusOptions.test.ts` fails when the database list gains a state that is not here.
 */
const STATUS_FILTER_ORDER = [
  { status: "pending", icon: "clock" },
  { status: "waitlist", icon: "list-numbers" },
  { status: "accepted", icon: "circle-check" },
  { status: "rejected", icon: "circle-x" },
  { status: "awaiting_email", icon: "mail" },
] as const satisfies readonly { status: RegistrationStatus; icon: string }[];

export const REQUEST_STATUS_ORDER: readonly RegistrationStatus[] = STATUS_FILTER_ORDER.map((entry) => entry.status);

export function isRequestStatus(value: string | null | undefined): value is RegistrationStatus {
  return value !== null && value !== undefined && (REGISTRATION_STATUS as readonly string[]).includes(value);
}

/** The state the address asks for (`?status=pending`); anything else, or nothing, is every state. */
export function requestStatusFromSearch(searchParams: URLSearchParams): RequestStatusFilter {
  const raw = searchParams.get("status");
  return isRequestStatus(raw) ? raw : "all";
}

/** The options of the status filter, each with how many requests are in that state once the counts are known. */
export function requestStatusOptions(counts: RegistrationCountsDto | null): SearchableSelectOption[] {
  const total = counts ? REGISTRATION_STATUS.reduce((sum, status) => sum + counts.by_status[status], 0) : null;
  return [
    { id: "all", label: withCount("All statuses", total), icon: "list" },
    ...STATUS_FILTER_ORDER.map(({ status, icon }) => ({
      id: status,
      label: withCount(requestStatusLabel(status), counts ? counts.by_status[status] : null),
      icon,
    })),
  ];
}

function withCount(label: string, count: number | null): string {
  return count === null ? label : `${label} (${count})`;
}

/**
 * "Registered more than ... ago": the closed list of the server (REGISTRATION_AGE_FILTERS in `@admitto/tickets`, which the admin
 * app may not import: its root pulls Prisma into the browser bundle). `registrationAgeOptions.test.ts` reads that list and fails
 * when the two differ.
 */
export const REGISTRATION_AGE_OPTIONS = [
  { id: "1h", label: "1 hour ago" },
  { id: "24h", label: "1 day ago" },
  { id: "3d", label: "3 days ago" },
  { id: "7d", label: "7 days ago" },
  { id: "14d", label: "14 days ago" },
  { id: "30d", label: "30 days ago" },
  { id: "90d", label: "90 days ago" },
  { id: "180d", label: "6 months ago" },
  { id: "365d", label: "1 year ago" },
] as const;

export const REQUEST_AGE_SELECT_OPTIONS: SearchableSelectOption[] = [
  { id: "any", label: "Any time", icon: "calendar" },
  ...REGISTRATION_AGE_OPTIONS.map((option) => ({ id: option.id, label: option.label, icon: "hourglass" })),
];

export function isRequestAge(value: string): value is RequestAgeFilter {
  return value === "any" || REGISTRATION_AGE_OPTIONS.some((option) => option.id === value);
}

/** The server reads at most this many words and characters of a search; more is a 400, not a longer search. */
const SEARCH_MAX_WORDS = 8;
const SEARCH_MAX_CHARS = 254;

/** What the server refuses in a search: control and invisible characters (`registrant-input.ts`), which come along when an address is copied from a page or a mail. */
const UNSEARCHABLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * The search text as the server accepts it: what it refuses becomes a space, runs of white space become one, and a text longer
 * than the server reads is cut to its first eight words and 254 characters. Without it such a paste would end in "Check the
 * form and try again" over the list.
 */
export function requestSearchText(raw: string): string {
  const words = raw
    .replaceAll(UNSEARCHABLE, " ")
    .split(/\s+/u)
    .filter((word) => word !== "")
    .slice(0, SEARCH_MAX_WORDS);
  return Array.from(words.join(" ")).slice(0, SEARCH_MAX_CHARS).join("").trim();
}

/** The guest as a row names them. */
export function requestGuestName(row: Pick<RegistrationListItemDto, "first_name" | "last_name">): string {
  return `${row.first_name} ${row.last_name}`.trim();
}

/** "+1" for a guest who brings someone, "+2" for two; null for a guest who comes alone. */
export function requestCompanionsLabel(count: number): string | null {
  return count > 0 ? `+${count}` : null;
}

/** What the guest was sent, in the words of a staff member: the five mails the queue holds (D-D1). */
const MAIL_KIND_LABELS: Record<RegistrationMailTemplateName, string> = {
  "registration-confirm": "Address confirmation",
  "registration-received": "Request received",
  "registration-waitlist": "Waiting list notice",
  "registration-rejected": "Decline notice",
  ticket: "Ticket",
};

export function requestMailKind(name: RegistrationMailTemplateName): string {
  return MAIL_KIND_LABELS[name];
}

/** The mail kinds the label table covers, for the test that fails when the database list gains one. */
export const REQUEST_MAIL_KINDS = Object.keys(MAIL_KIND_LABELS) as RegistrationMailTemplateName[];

/**
 * How the last mail of a request is drawn: the badge, and, for a failed one, whether the worker still tries it.
 * A failed mail the worker retries by itself is not final, so it reads "Retrying" and not "Failed".
 */
export function requestMailTone(mail: Pick<RegistrationMailBriefDto, "status" | "retryable">): {
  label: string;
  variant: "ok" | "warn" | "error" | "neutral";
} {
  switch (mail.status) {
    case "queued":
      return { label: "Pending", variant: "warn" };
    case "accepted":
    case "sent":
    case "delivered":
      return { label: "Sent", variant: "ok" };
    case "failed":
      return mail.retryable === true ? { label: "Retrying", variant: "warn" } : { label: "Failed", variant: "error" };
    case "bounced":
      return { label: "Bounced", variant: "error" };
    case "rejected":
      return { label: "Failed", variant: "error" };
    case "cancelled":
      return { label: "Cancelled", variant: "neutral" };
  }
}
