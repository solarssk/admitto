import { useEffect, useMemo, useState } from "react";
import { Badge, Notice } from "@admitto/ui";
import { ApiError, fetchLegalDocument, fetchLegalDocuments, saveLegalDocument } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { LegalDocumentDto, LegalDocumentLimitsDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { SearchableSelect, type SearchableSelectOption } from "../components/SearchableSelect.js";
import { useEventOptions } from "../hooks/useEventOptions.js";
import { orLoginRedirect, redirectToLogin } from "../identity/loginRedirect.js";
import { lookupReady, useOptionsLoad } from "../hooks/useOptionsLoad.js";
import { LookupSlot } from "../pages/users/LookupSlot.js";
import { pluralSuffix } from "../utils/pluralize.js";
import { planCopy, type CopyAction, type CopyStep } from "./legalTexts.js";
import "./legal-texts.css";

const ACTION_LABEL: Readonly<Record<CopyAction, string>> = {
  add: "New",
  replace_draft: "Replaces your draft",
  replace_published: "Replaces the published text",
};

const ACTION_VARIANT = { add: "ok", replace_draft: "warn", replace_published: "error" } as const;

/** Runs `run` for each item, one after another, and stops at the first that fails. */
async function runInOrder<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  const [first, ...rest] = items;
  if (first === undefined) return;
  await run(first);
  await runInOrder(rest, run);
}

function CopySummary({ steps, limits, consentsAfter, overLimit }: Readonly<{ steps: readonly CopyStep[]; limits: LegalDocumentLimitsDto; consentsAfter: number; overLimit: boolean }>) {
  if (steps.length === 0) return <p className="at-hint">That event has no legal texts to copy.</p>;
  return (
    <div className="legal-copy-summary">
      <ul className="legal-copy-list" aria-label="What will be copied">
        {steps.map((step) => (
          <li key={step.source.ref} className="legal-copy-list__row">
            <span className="legal-copy-list__title">{step.source.title}</span>
            <Badge variant={ACTION_VARIANT[step.action]}>{ACTION_LABEL[step.action]}</Badge>
          </li>
        ))}
      </ul>
      <p className="at-hint">
        A new text starts as a draft. A text that is published here stays published, so guests read the copy at once. Texts here that the
        other event does not have stay as they are. Which consents the form asks for is not copied.
      </p>
      {overLimit && (
        <Notice variant="error" role="alert">
          This would give the event {consentsAfter} extra consents. The limit is {limits.consents}.
        </Notice>
      )}
    </div>
  );
}

export interface CopyLegalTextsDialogProps {
  open: boolean;
  eventId: string;
  /** The texts this event has now: what the copy would add to, and what it would replace. */
  current: readonly LegalDocumentDto[];
  limits: LegalDocumentLimitsDto;
  onClose: () => void;
  /** Every text was copied. */
  onCopied: (count: number, sourceTitle: string) => void;
  /** Some texts were copied before one failed: the list behind the dialog reads again. */
  onPartial: () => void;
}

/**
 * Copies the legal texts of another event into this one (D-F7). It says first what will happen to each text of the other
 * event here, since a copy replaces the text this event has under the same name and a published one goes on being
 * published. The texts are copied one after another with the calls an organiser's own editing uses, so each one is cleaned and
 * recorded as a save; when one fails the copy stops, says how far it got, and can be run again.
 */
export function CopyLegalTextsDialog({ open, eventId, current, limits, onClose, onCopied, onPartial }: Readonly<CopyLegalTextsDialogProps>) {
  const events = useEventOptions({ enabled: open, redirectOnUnauthorized: true });
  const [sourceId, setSourceId] = useState("");
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSourceId("");
      setError(null);
    }
  }, [open]);

  // A session that expired after the events were read hands the browser to sign-in, as the read of the events does.
  const loadSourceTexts = useMemo(
    () => orLoginRedirect((signal: AbortSignal) => fetchLegalDocuments(sourceId, signal).then((answer) => answer.items)),
    [sourceId],
  );
  const sourceTexts = useOptionsLoad(loadSourceTexts, "Could not load the legal texts of that event.", open && sourceId !== "");

  const options = useMemo<SearchableSelectOption[]>(
    () => events.events.filter((candidate) => candidate.id !== eventId).map((candidate) => ({ id: candidate.id, label: candidate.title, icon: "calendar-event" })),
    [events.events, eventId],
  );
  const sourceTitle = options.find((option) => option.id === sourceId)?.label ?? "";
  const plan = useMemo(() => planCopy(sourceTexts.items, current, limits.consents), [sourceTexts.items, current, limits.consents]);
  const ready = sourceId !== "" && lookupReady(sourceTexts) && plan.steps.length > 0 && !plan.overLimit;

  async function copy() {
    if (copying || !ready) return;
    setCopying(true);
    setError(null);
    let done = 0;
    try {
      await runInOrder(plan.steps, async (step) => {
        const text = await fetchLegalDocument(sourceId, step.source.ref);
        await saveLegalDocument(eventId, step.source.ref, { title: text.title, content_html: text.content_html });
        done += 1;
      });
      onCopied(done, sourceTitle);
    } catch (err) {
      // A session that ended while the copy waited for the confirmation: sign in again, as the read of the texts does.
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      if (done > 0) onPartial();
      const reason = operatorApiErrorMessage(err, "Could not copy the texts.");
      setError(done > 0 ? `Copied ${done} of ${plan.steps.length} text${pluralSuffix(plan.steps.length)}, then it stopped. ${reason}` : reason);
    } finally {
      setCopying(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      wide
      icon={<i className="ti ti-copy" aria-hidden="true" />}
      title="Copy legal texts from another event"
      message="Choose the event to copy from. Its privacy notice, event terms and extra consents are copied into this event."
      confirmLabel="Copy texts"
      loading={copying}
      disableConfirm={!ready}
      errorMessage={error}
      onConfirm={() => void copy()}
      onCancel={onClose}
    >
      <div className="legal-copy">
        <LookupSlot lookup={events} label="events">
          <SearchableSelect
            id="legal-copy-source"
            label="Copy from"
            placeholder={events.error ? "Could not load events" : "Choose an event"}
            searchPlaceholder="Search events"
            emptyLabel="No other events found"
            value={sourceId}
            options={options}
            disabled={events.error !== null || copying}
            onChange={(id) => {
              setSourceId(id);
              // What went wrong with the copy of another event says nothing about this one.
              setError(null);
            }}
          />
        </LookupSlot>
        {sourceId !== "" && (
          <LookupSlot lookup={sourceTexts} label="legal texts">
            {/* A read that failed is not an event with no texts: its hint and Retry are all there is to say. */}
            {lookupReady(sourceTexts) && (
              <CopySummary steps={plan.steps} limits={limits} consentsAfter={plan.consentsAfter} overLimit={plan.overLimit} />
            )}
          </LookupSlot>
        )}
      </div>
    </ConfirmDialog>
  );
}
