import { useRef, useState } from "react";
import { useToast } from "@admitto/ui";
import { ApiError, deleteLegalDocument, publishLegalDocument, saveRegistrationSettings, unpublishLegalDocument } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { LegalDocumentDto, LegalDocumentsListResponse } from "../api/types.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { askedKeysWith, type LegalTextRow } from "./legalTexts.js";
import type { PendingAction } from "./LegalTextTable.js";

/**
 * A session that ended hands the browser to sign-in, as the write calls of the identity editors do, instead of an
 * error whose retry meets the same 401. True when it did, and the action has nothing more to say. Unsaved words are
 * guarded by the browser's own prompt when the page is left.
 */
export function handedToSignIn(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 401) return false;
  redirectToLogin();
  return true;
}

/** What a request of a row ended with: `message` is what to tell the person, or null when nothing is to be said (a refused session). */
type Outcome = { ok: true } | { ok: false; message: string | null };

/** The text that asks to be withdrawn or deleted, until the person has answered. */
export type ConfirmTarget = { action: "unpublish" | "delete"; row: LegalTextRow };

export interface LegalTextActionsInput {
  eventId: string;
  items: readonly LegalDocumentDto[];
  /** Something changed: the list reads again (and the page reads the checks again with it). */
  reload: () => Promise<void>;
  /** Puts what the server has just confirmed into the list on screen, so that it is true even when the read that follows fails. */
  update: (change: (data: LegalDocumentsListResponse) => LegalDocumentsListResponse) => void;
}

/**
 * What the list of the Legal tab does with a text without opening it: switch a consent on or off on the form, publish, unpublish, delete.
 * One request at a time: a click while another is on its way does nothing (`pending` says which row is busy). A consent that the form
 * asks for is taken off the form first when it is withdrawn or deleted while registration is off, so that no text the form asks for is
 * ever missing. A refusal is worded by `operatorApiErrorMessage`, and the list reads again after any failure, since a refusal says that
 * what is on screen is out of date.
 */
export function useLegalTextActions({ eventId, items, reload, update }: Readonly<LegalTextActionsInput>) {
  const { addToast } = useToast();
  const busy = useRef(false);
  // The form stopped asking for a consent, and the request that follows may still fail: the dialog then says so.
  const askedSwitchedOff = useRef(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function run(action: PendingAction["action"], ref: string, job: () => Promise<unknown>, fallback: string): Promise<Outcome> {
    if (busy.current) return { ok: false, message: null };
    busy.current = true;
    setPending({ ref, action });
    try {
      await job();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: handedToSignIn(err) ? null : operatorApiErrorMessage(err, fallback) };
    } finally {
      busy.current = false;
      setPending(null);
      void reload();
    }
  }

  /** Writes the consents the form asks for, the whole list: the server takes the list, not a change. What was saved is shown at once. */
  async function writeAsked(row: LegalTextRow, asked: boolean) {
    await saveRegistrationSettings(eventId, { consent_keys: askedKeysWith(items, row.target.key ?? "", asked) });
    update((data) => ({ ...data, items: data.items.map((item) => (item.ref === row.target.ref ? { ...item, required: asked } : item)) }));
  }

  /** A consent the form asks for leaves the form before it is withdrawn, or the form would keep asking for a text that is not there. */
  async function withdraw(row: LegalTextRow, job: () => Promise<unknown>) {
    const dropsAsked = row.document?.required === true && row.target.kind === "consent";
    if (dropsAsked) await writeAsked(row, false);
    askedSwitchedOff.current = dropsAsked;
    await job();
  }

  function tell(outcome: Outcome, success: string) {
    if (outcome.ok) addToast(success, "success");
    else if (outcome.message !== null) addToast(outcome.message, "error");
  }

  async function toggleAsked(row: LegalTextRow, asked: boolean) {
    const outcome = await run("asked", row.target.ref, () => writeAsked(row, asked), "Could not change this.");
    tell(outcome, asked ? "The form now asks for this consent." : "The form no longer asks for this consent.");
  }

  async function publish(row: LegalTextRow) {
    const outcome = await run("publish", row.target.ref, () => publishLegalDocument(eventId, row.target.ref), "Could not publish this text.");
    tell(outcome, "Text published.");
  }

  function ask(action: ConfirmTarget["action"], row: LegalTextRow) {
    setConfirmError(null);
    setConfirm({ action, row });
  }

  async function answerYes() {
    if (confirm === null) return;
    const { action, row } = confirm;
    const ref = row.target.ref;
    askedSwitchedOff.current = false;
    const outcome =
      action === "unpublish"
        ? await run("unpublish", ref, () => withdraw(row, () => unpublishLegalDocument(eventId, ref)), "Could not unpublish this text.")
        : await run("delete", ref, () => withdraw(row, () => deleteLegalDocument(eventId, ref)), "Could not delete this text.");
    if (outcome.ok) {
      setConfirm(null);
      addToast(action === "unpublish" ? "Text unpublished. Guests can no longer read it." : "Text deleted.", "success");
    } else setConfirmError(outcome.message === null || !askedSwitchedOff.current ? outcome.message : `${outcome.message} The form no longer asks for this consent. Switch Asked on again if you still want it.`);
  }

  const confirmBusy = confirm !== null && pending?.ref === confirm.row.target.ref && pending.action === confirm.action;

  return {
    pending,
    confirm,
    confirmBusy,
    confirmError,
    toggleAsked: (row: LegalTextRow, asked: boolean) => void toggleAsked(row, asked),
    publish,
    askToUnpublish: (row: LegalTextRow) => ask("unpublish", row),
    askToDelete: (row: LegalTextRow) => ask("delete", row),
    cancelConfirm: () => setConfirm(null),
    answerYes: () => void answerYes(),
  };
}
