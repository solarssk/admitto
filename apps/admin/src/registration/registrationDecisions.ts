import type { RegistrationStatus } from "@admitto/db/status";
import { ApiError, type NotEnoughSeatsMeta } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  AcceptRegistrationResultDto,
  DeleteRegistrationsDto,
  RegistrationListItemDto,
  RejectRegistrationsDto,
  RetryRegistrationMailsDto,
} from "../api/types.js";
import { isPastTheEnd } from "../pages/users/list-changes.js";
import { pluralize } from "../utils/pluralize.js";
import { requestAgeLabel, requestStatusLabel } from "./registrationRequests.js";
import type { RequestQuery, RequestsAnswer } from "./useRegistrationRequests.js";

/**
 * What staff may do to a request, and what the screen says of it. The server decides every one of these (`admitRegistrations`,
 * `rejectRegistrations`, `retryRegistrationMails` and `deleteRegistrations` in `@admitto/tickets`, which the admin app may not import:
 * its root pulls Prisma into the browser bundle); this mirrors the rules so that the screen offers a button only where it can work and
 * counts what a dialog will do. `registrationDecisions.test.ts` reads the server's own lists and fails when they differ.
 */

/** The states a request can be accepted from: waiting for a decision, on the waiting list, and rejected (a rejected guest may be accepted later). */
export const ACCEPTABLE_STATUSES: readonly RegistrationStatus[] = ["pending", "waitlist", "rejected"];

/** The states a request can be rejected from. A request that waits for the guest's address, or is decided already, is not decided again. */
export const REJECTABLE_STATUSES: readonly RegistrationStatus[] = ["pending", "waitlist"];

type Row = Pick<RegistrationListItemDto, "status">;

export const canAccept = (row: Row): boolean => ACCEPTABLE_STATUSES.includes(row.status);
export const canReject = (row: Row): boolean => REJECTABLE_STATUSES.includes(row.status);
/** Only the last email of a request is sent again, and only when it failed for good (the server's `can_retry`). */
export const canRetryMail = (row: Pick<RegistrationListItemDto, "last_mail">): boolean => row.last_mail?.can_retry === true;

/** What a selection can be used for: the requests each action applies to. */
export function selectionActions(rows: readonly RegistrationListItemDto[]) {
  return { accept: rows.filter(canAccept), reject: rows.filter(canReject), retry: rows.filter(canRetryMail) };
}

/** The seats guests take: each one, and each person they bring. Seats are what an event's limit counts, never people. */
export function seatsNeeded(rows: readonly Pick<RegistrationListItemDto, "companions_count">[]): number {
  return rows.reduce((sum, row) => sum + 1 + row.companions_count, 0);
}

/** How many of the rows are accepted: deleting those erases their attendees too. */
export function acceptedAmong(rows: readonly Row[]): number {
  return rows.filter((row) => row.status === "accepted").length;
}

const requests = (count: number): string => `${count} ${pluralize(count, "request")}`;

/** Names the seats of a refusal as the staff member counts them. A guest who brings someone takes two. */
export function notEnoughSeatsMessage({ free, needed }: NotEnoughSeatsMeta): string {
  const seatsAre = free === 1 ? "seat is" : "seats are";
  const left = free === 0 ? "No seats are free" : `Only ${free} ${seatsAre} free`;
  return `${left}, and the guests you chose need ${needed} (a companion takes a seat too). Nobody was accepted. Choose fewer guests, or raise the event's capacity first.`;
}

/**
 * The words for a failed decision: the numbers of a 409 `not_enough_seats` (free and needed, in seats: the client reads them from that
 * answer only), else what the app says of any failure (`operatorApiErrorMessage`: its own text for a known code, never an exception,
 * otherwise the fallback).
 */
export function decisionErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.seats) return notEnoughSeatsMessage(err.seats);
  return operatorApiErrorMessage(err, fallback);
}

/** What a toast says after an action: the sentence, and how it looks (an action that did less than was asked is a warning). */
export interface DecisionToast {
  message: string;
  variant: "success" | "warning" | "info";
}

function tally<T extends string>(results: readonly { outcome: T }[], outcome: T): number {
  return results.filter((result) => result.outcome === outcome).length;
}

/** " Skipped: 2 already accepted, 1 no longer there.", or nothing when nothing was skipped. */
function skippedSentence(parts: readonly [number, string][]): string {
  const said = parts.filter(([count]) => count > 0).map(([count, reason]) => `${count} ${reason}`);
  return said.length === 0 ? "" : ` Skipped: ${said.join(", ")}.`;
}

export function acceptToast(results: readonly AcceptRegistrationResultDto[]): DecisionToast {
  const accepted = tally(results, "accepted");
  const skipped = skippedSentence([
    [tally(results, "already_decided"), "already accepted"],
    [tally(results, "awaiting_email"), "not confirmed by the guest yet"],
    [tally(results, "already_attendee"), "removed because an attendee has the address"],
    [tally(results, "gone"), "no longer there"],
  ]);
  if (accepted === 0) return { message: `Nobody was accepted.${skipped}`, variant: "warning" };
  return { message: `${requests(accepted)} accepted.${skipped}`, variant: skipped === "" ? "success" : "warning" };
}

export function rejectToast(results: RejectRegistrationsDto["results"], notify: boolean): DecisionToast {
  const rejected = tally(results, "rejected");
  const skipped = skippedSentence([
    [tally(results, "already_decided"), "already decided"],
    [tally(results, "awaiting_email"), "not confirmed by the guest yet"],
    [tally(results, "gone"), "no longer there"],
  ]);
  if (rejected === 0) return { message: `Nobody was rejected.${skipped}`, variant: "warning" };
  const told = notify ? " The guests are emailed." : "";
  return { message: `${requests(rejected)} rejected.${told}${skipped}`, variant: skipped === "" ? "success" : "warning" };
}

export function retryToast(results: RetryRegistrationMailsDto["results"]): DecisionToast {
  const retried = tally(results, "retried");
  const skipped = skippedSentence([
    [tally(results, "not_retryable"), "cannot be sent again"],
    [tally(results, "gone"), "no longer there"],
  ]);
  if (retried === 0) return { message: `No email was sent again.${skipped}`, variant: "warning" };
  return { message: `${retried} ${pluralize(retried, "email")} will be sent again.${skipped}`, variant: skipped === "" ? "success" : "warning" };
}

export function deleteToast(result: Pick<DeleteRegistrationsDto, "deleted" | "attendees_erased">): DecisionToast {
  if (result.deleted === 0) return { message: "Nothing was deleted. The requests were already gone.", variant: "info" };
  const erased = result.attendees_erased;
  const alsoErased = erased === 0 ? "" : ` ${erased} ${pluralize(erased, "attendee")} erased too.`;
  return { message: `${requests(result.deleted)} deleted.${alsoErased}`, variant: "success" };
}

/** What an action did to the rows on screen: the requests that are gone, the state the others are in now, the ones whose email was queued again. */
export interface RowsChange {
  removed: ReadonlySet<string>;
  moved: ReadonlyMap<string, RegistrationStatus>;
  retried: ReadonlySet<string>;
}

const NO_CHANGE: RowsChange = { removed: new Set(), moved: new Map(), retried: new Set() };

const idsOf = (results: readonly { id: string; outcome: string }[], ...outcomes: string[]): string[] =>
  results.filter((result) => outcomes.includes(result.outcome)).map((result) => result.id);

/** An accepted request is an attendee now; one the server says was accepted already is too. One that an attendee's address replaced, or that is gone, is not in the list any more. */
export function acceptChange(results: readonly AcceptRegistrationResultDto[]): RowsChange {
  return {
    ...NO_CHANGE,
    removed: new Set(idsOf(results, "gone", "already_attendee")),
    moved: new Map(idsOf(results, "accepted", "already_decided").map((id): [string, RegistrationStatus] => [id, "accepted"])),
  };
}

/** `already_decided` says it was decided, not which way, so the row stays for the refresh to tell. */
export function rejectChange(results: RejectRegistrationsDto["results"]): RowsChange {
  return {
    ...NO_CHANGE,
    removed: new Set(idsOf(results, "gone")),
    moved: new Map(idsOf(results, "rejected").map((id): [string, RegistrationStatus] => [id, "rejected"])),
  };
}

export function retryChange(results: RetryRegistrationMailsDto["results"]): RowsChange {
  return { ...NO_CHANGE, removed: new Set(idsOf(results, "gone")), retried: new Set(idsOf(results, "retried")) };
}

export function deleteChange(results: DeleteRegistrationsDto["results"]): RowsChange {
  return { ...NO_CHANGE, removed: new Set(idsOf(results, "deleted", "gone")) };
}

/** An email that was queued again is queued as the server has it now: waiting, with nothing left to send again. */
function withMailQueuedAgain(row: RegistrationListItemDto): RegistrationListItemDto {
  return row.last_mail === null ? row : { ...row, last_mail: { ...row.last_mail, status: "queued", retryable: null, can_retry: false } };
}

/**
 * The page as it is once the server has confirmed an action: a request that is gone leaves it, and one that moved to another state
 * leaves it too when the list shows one state only (the server's next answer would not have it). The number of requests follows.
 * The name the list gave the requests a filter selects (`selectionDigest`) is no longer true once some left, and goes: deleting by
 * filter waits for the answer that brings the new one. Nothing else is guessed; the refresh that follows tells the rest.
 */
export function withRowsChanged(answer: RequestsAnswer, change: RowsChange): RequestsAnswer {
  const only = answer.query.status;
  const items = answer.items.flatMap((row): RegistrationListItemDto[] => {
    if (change.removed.has(row.id)) return [];
    const status = change.moved.get(row.id);
    const next = change.retried.has(row.id) ? withMailQueuedAgain(row) : row;
    if (status === undefined) return [next];
    return only !== undefined && only !== status ? [] : [{ ...next, status }];
  });
  const left = answer.items.length - items.length;
  const moved = answer.items.some((row) => change.moved.has(row.id));
  const mailed = answer.items.some((row) => change.retried.has(row.id));
  if (left === 0 && !moved && !mailed) return answer;
  const total = Math.max(0, answer.total - left);
  const setChanged = left > 0 || moved;
  return {
    ...answer,
    items,
    total,
    pastTheEnd: isPastTheEnd(items.length, total, answer.page),
    selectionDigest: setChanged ? null : answer.selectionDigest,
  };
}

/** The list after everything a filter selected was deleted: nothing matches it now, whatever page it was on. */
export function withMatchingDeleted(answer: RequestsAnswer): RequestsAnswer {
  return { ...answer, items: [], total: 0, pastTheEnd: false, selectionDigest: null };
}

/**
 * Where the focus goes when an action has changed the page: the position of the first request the action was for. The request that
 * takes its place (or the same one, when it stays) is where the keyboard lands, so that a queue is worked through one request after
 * the other. Null when none of them was on the page.
 */
export function firstActedIndex(before: readonly Pick<RegistrationListItemDto, "id">[], acted: ReadonlySet<string>): number | null {
  const index = before.findIndex((row) => acted.has(row.id));
  return index === -1 ? null : index;
}

/** Whether a filter limits the list at all: deleting by filter needs at least one of the three (the server refuses a filter that selects everything). */
export function hasFilter(query: RequestQuery): boolean {
  return query.status !== undefined || query.olderThan !== undefined || query.q !== undefined;
}

/** What deleting everything a filter selects needs, all of it from one answer of the list: the filter, its total, and the name of the requests. */
export interface MatchingTarget {
  query: RequestQuery;
  total: number;
  digest: string;
}

/**
 * The deletion by filter the newest answer allows: only when a filter is set (the server refuses a filter that selects everything), when
 * something matches, and when the server named the requests (`selection_digest` is null for a filter that selects more than one deletion
 * takes, and the page drops it once an action has changed what the filter selects). The total and the name are the answer's own, so that
 * what is sent is what the staff member was shown.
 */
export function matchingTarget(answer: RequestsAnswer | null): MatchingTarget | null {
  if (!answer || answer.total === 0 || answer.selectionDigest === null || !hasFilter(answer.query)) return null;
  return { query: answer.query, total: answer.total, digest: answer.selectionDigest };
}

/**
 * What the filter of a deletion says, in the words of the list, one line for each part that is set. The words of a search are not in
 * it: they are a name or an address, and a dialog is easy to screenshot.
 */
export function describeFilter(query: RequestQuery): string[] {
  const lines: string[] = [];
  if (query.status !== undefined) lines.push(`State: ${requestStatusLabel(query.status)}`);
  if (query.olderThan !== undefined) lines.push(`Registered more than ${requestAgeLabel(query.olderThan)}`);
  if (query.q !== undefined) lines.push("Matching your search");
  return lines;
}
