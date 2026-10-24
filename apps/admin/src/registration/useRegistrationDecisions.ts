import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@admitto/ui";
import {
  acceptRegistrations,
  bulkEraseAttendees,
  deleteRegistrations,
  deleteRegistrationsByFilter,
  rejectRegistrations,
  retryRegistrationMails,
} from "../api/client.js";
import { hasApiErrorCode } from "../api/operator-api-error.js";
import type { DeleteRegistrationsDto, RegistrationCountsDto, RegistrationListItemDto } from "../api/types.js";
import { reportBulkActionError } from "../attendees/reportBulkActionError.js";
import { useEraseWalletResult } from "../attendees/useEraseWalletResult.js";
import type { ListLoad } from "../hooks/useListLoad.js";
import {
  acceptChange,
  acceptToast,
  decisionErrorMessage,
  deleteChange,
  deleteToast,
  firstActedIndex,
  matchingTarget,
  rejectChange,
  rejectToast,
  retryChange,
  retryToast,
  selectionActions,
  withMatchingDeleted,
  withRowsChanged,
  type DecisionToast,
  type MatchingTarget,
  type RowsChange,
} from "./registrationDecisions.js";
import type { RequestsAnswer } from "./useRegistrationRequests.js";

/** What a dialog is open to confirm. Deleting what a filter selects carries nothing: it reads the newest answer of the list when it runs. */
export type PendingDecision =
  | { kind: "accept" | "reject" | "delete"; rows: RegistrationListItemDto[] }
  | { kind: "deleteMatching" };

/** What the tab is told when an action has changed the page. */
export interface ActionDone {
  /** The requests the action was asked for. */
  acted: ReadonlySet<string>;
  /** Where the first of them stood on the page: where the keyboard goes. Null when none was on it. */
  index: number | null;
}

/** The action that is running, if any: one flag for each, so a button spins only for its own action. */
export type BusyDecision = PendingDecision["kind"] | "retry" | null;

const FAILED: Record<PendingDecision["kind"] | "retry", string> = {
  accept: "Could not accept the requests. Try again.",
  reject: "Could not reject the requests. Try again.",
  delete: "Could not delete the requests. Try again.",
  deleteMatching: "Could not delete the requests. Try again.",
  retry: "Could not send the email again. Try again.",
};

/** What a finished action did: the change to the rows on screen, what to tell, and what else moved with it. */
interface Applied {
  /** `everything`: all the requests a filter selected are gone, on every page. */
  change: RowsChange | "everything";
  /** The requests the action was asked for, left out ones too: they leave the selection, and the first of them is where the keyboard goes. */
  acted: ReadonlySet<string>;
  toast: DecisionToast;
  /** Seats were taken or freed: the event of the layout is read again. */
  seatsChanged: boolean;
  /** Erased attendees whose wallet pass is still at the provider (the ids to try again with). */
  wallet: { pending: number; attendeeIds: string[] } | null;
}

const idsOf = (rows: readonly RegistrationListItemDto[]): string[] => rows.map((row) => row.id);

async function runAccept(eventId: string, rows: readonly RegistrationListItemDto[]): Promise<Applied> {
  const { results } = await acceptRegistrations(eventId, idsOf(selectionActions(rows).accept));
  return {
    change: acceptChange(results),
    acted: new Set(idsOf(rows)),
    toast: acceptToast(results),
    seatsChanged: results.some((result) => result.outcome === "accepted"),
    wallet: null,
  };
}

async function runReject(eventId: string, rows: readonly RegistrationListItemDto[], notify: boolean): Promise<Applied> {
  const { results } = await rejectRegistrations(eventId, idsOf(selectionActions(rows).reject), notify);
  return { change: rejectChange(results), acted: new Set(idsOf(rows)), toast: rejectToast(results, notify), seatsChanged: false, wallet: null };
}

/** The attendees an accepted request was deleted with: erased, and their wallet pass tried again through their erasure when it was not deleted. */
function walletOf(result: DeleteRegistrationsDto): Applied["wallet"] {
  if (result.wallet_pending === 0) return null;
  const attendeeIds = result.results.flatMap((entry) => (entry.outcome === "deleted" && entry.attendee_id ? [entry.attendee_id] : []));
  return { pending: result.wallet_pending, attendeeIds };
}

async function runDelete(eventId: string, rows: readonly RegistrationListItemDto[]): Promise<Applied> {
  const ids = idsOf(rows);
  const result = await deleteRegistrations(eventId, ids);
  return {
    change: deleteChange(result.results),
    acted: new Set(ids),
    toast: deleteToast(result),
    seatsChanged: result.attendees_erased > 0,
    wallet: walletOf(result),
  };
}

async function runDeleteMatching(eventId: string, target: MatchingTarget, shown: readonly RegistrationListItemDto[]): Promise<Applied> {
  const result = await deleteRegistrationsByFilter(eventId, { ...target.query, expected: target.total, selectionDigest: target.digest });
  return {
    change: "everything",
    acted: new Set(idsOf(shown)),
    toast: deleteToast(result),
    seatsChanged: result.attendees_erased > 0,
    wallet: walletOf(result),
  };
}

/** A deletion by filter that was refused because the list is not what it was when the staff member looked: the list is read again. */
function listWentStale(err: unknown): boolean {
  return hasApiErrorCode(err, "registration_count_changed") || hasApiErrorCode(err, "registration_selection_changed");
}

/**
 * Accepting, rejecting, deleting and sending again, for the Requests tab: which confirmation is open, which action is running, the
 * failure the open dialog shows, and what an action that worked does. It applies what the server confirmed to the rows on screen
 * (`list.update`), then reads the list and the numbers again without blocking anything (`list.poll`, `counts.poll`): a reviewer clicks
 * through the queue. The event of the layout is read again when seats were taken or freed (an acceptance, the deletion of an accepted
 * request). A wallet pass that could not be deleted at the provider after a deletion is told in its own dialog, with Try again.
 *
 * `onChanged` is told, once, when an action has changed the page: with the requests it was asked for and the position of the first of
 * them, so the tab can drop them from the selection, close the request that was open and put the keyboard where the next request is.
 */
export function useRegistrationDecisions({
  eventId,
  list,
  counts,
  refreshEvent,
  reportApiError,
  onChanged,
}: Readonly<{
  eventId: string;
  list: ListLoad<RequestsAnswer>;
  counts: ListLoad<RegistrationCountsDto>;
  /** Reads the event of the layout again: its seats change with an acceptance, and with the deletion of an accepted request. */
  refreshEvent: (() => Promise<unknown>) | undefined;
  reportApiError: (status: number) => void;
  onChanged: (change: ActionDone) => void;
}>) {
  const { addToast } = useToast();
  const { update, poll, reload } = list;
  const { poll: pollCounts } = counts;
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [busy, setBusy] = useState<BusyDecision>(null);
  const [error, setError] = useState<string | null>(null);
  // The newest answer and the callbacks, read when an action finishes (long after the click that started it).
  const answerRef = useRef(list.data);
  const refreshEventRef = useRef(refreshEvent);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    answerRef.current = list.data;
    refreshEventRef.current = refreshEvent;
    onChangedRef.current = onChanged;
  });

  const settleWallet = useCallback(() => undefined, []);
  const eraseWalletResult = useEraseWalletResult({ scopeKey: eventId, onSettled: settleWallet });
  const openWallet = eraseWalletResult.open;

  /** The dialog goes, with what it said of a failure. */
  const close = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  const matching = matchingTarget(list.data);
  // What the list is read for can go while its dialog is open (the filter now selects nothing, or too much): there is nothing to confirm,
  // and the dialog must not come back when a later answer allows the deletion again.
  useEffect(() => {
    if (pending?.kind === "deleteMatching" && matching === null && busy === null) close();
  }, [pending, matching, busy, close]);

  const settle = useCallback(
    (applied: Applied) => {
      const before = answerRef.current?.items ?? [];
      onChangedRef.current({ acted: applied.acted, index: firstActedIndex(before, applied.acted) });
      update((data) => (applied.change === "everything" ? withMatchingDeleted(data) : withRowsChanged(data, applied.change)));
      addToast(applied.toast.message, applied.toast.variant);
      if (applied.wallet) {
        const { pending: count, attendeeIds } = applied.wallet;
        openWallet(count, () => bulkEraseAttendees(eventId, attendeeIds));
      }
      void poll();
      void pollCounts();
      if (applied.seatsChanged) void refreshEventRef.current?.();
    },
    [addToast, eventId, openWallet, poll, pollCounts, update],
  );

  const perform = useCallback(
    (target: PendingDecision, notify: boolean): Promise<Applied | null> => {
      switch (target.kind) {
        case "accept":
          return runAccept(eventId, target.rows);
        case "reject":
          return runReject(eventId, target.rows, notify);
        case "delete":
          return runDelete(eventId, target.rows);
        case "deleteMatching": {
          const now = matchingTarget(answerRef.current);
          return now ? runDeleteMatching(eventId, now, answerRef.current?.items ?? []) : Promise.resolve(null);
        }
      }
    },
    [eventId],
  );

  const confirm = useCallback(
    async ({ notify = false }: { notify?: boolean } = {}) => {
      if (pending === null) return;
      setBusy(pending.kind);
      setError(null);
      try {
        const applied = await perform(pending, notify);
        if (applied) settle(applied);
        close();
      } catch (err) {
        reportBulkActionError(err, {
          reportApiError,
          setError,
          addToast,
          apiErrorFallback: FAILED[pending.kind],
          genericFallback: FAILED[pending.kind],
          mapErrorMessage: (apiError) => decisionErrorMessage(apiError, FAILED[pending.kind]),
        });
        if (listWentStale(err)) void reload();
      } finally {
        setBusy(null);
      }
    },
    [addToast, close, perform, pending, reload, reportApiError, settle],
  );

  /** Sends again the last email of `ids`; `acted` is every request that was asked (the selection, of which only some have an email to send again). */
  const retryMail = useCallback(
    async (ids: readonly string[], acted: readonly string[] = ids) => {
      setBusy("retry");
      try {
        const { results } = await retryRegistrationMails(eventId, [...ids]);
        settle({ change: retryChange(results), acted: new Set(acted), toast: retryToast(results), seatsChanged: false, wallet: null });
      } catch (err) {
        reportBulkActionError(err, { reportApiError, addToast, apiErrorFallback: FAILED.retry, genericFallback: FAILED.retry });
      } finally {
        setBusy(null);
      }
    },
    [addToast, eventId, reportApiError, settle],
  );

  const ask = useCallback((kind: "accept" | "reject" | "delete", rows: readonly RegistrationListItemDto[]) => setPending({ kind, rows: [...rows] }), []);
  const askDeleteMatching = useCallback(() => setPending({ kind: "deleteMatching" }), []);

  return { pending, busy, error, matching, ask, askDeleteMatching, cancel: close, confirm, retryMail, walletDialogProps: eraseWalletResult.dialogProps };
}
