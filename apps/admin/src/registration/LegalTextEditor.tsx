import { lazy, Suspense, useEffect, useId, useMemo, useState } from "react";
import { useBlocker } from "react-router";
import { Badge, Button, Card, Input, Notice, useToast } from "@admitto/ui";
import {
  ApiError,
  deleteLegalDocument,
  fetchLegalDocument,
  publishLegalDocument,
  saveLegalDocument,
  unpublishLegalDocument,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto, LegalDocumentLimitsDto, LegalDocumentWithContentDto } from "../api/types.js";
import { isEventArchived } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { RowsSkeleton } from "../components/RowsSkeleton.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useCardLoad } from "../hooks/useCardLoad.js";
import { useDelayedLoading, useLoadingGate } from "../hooks/useDelayedLoading.js";
import { useListLoad } from "../hooks/useListLoad.js";
import { DiscardUnsavedChangesDialogs } from "../identity/DiscardUnsavedChangesDialogs.js";
import { orLoginRedirect } from "../identity/loginRedirect.js";
import { SettingsPanelSkeleton } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import { SLOW_NOTICE_MS } from "../utils/loading-timing.js";
import { normalizeLegalHtml } from "./legalHtml.js";
import {
  CONSENT_KEY_MAX_CHARS,
  KIND_LABEL,
  consentKeyProblem,
  consentTarget,
  defaultTitle,
  legalFormState,
  type LegalTextTarget,
} from "./legalTexts.js";
import type { LegalEditorMode } from "./LegalHtmlEditor.js";
import "./legal-texts.css";

// The editor library is the heaviest part of this page, so it is read only when a text is opened, never with the list.
const LegalHtmlEditor = lazy(() => import("./LegalHtmlEditor.js").then((module) => ({ default: module.LegalHtmlEditor })));

/** The editor's own placeholder while its code is on its way: a box of its size, held invisibly for the first 200ms. */
function EditorFallback() {
  const gate = useLoadingGate(true);
  const slow = useDelayedLoading(true, SLOW_NOTICE_MS);
  return <RowsSkeleton label="Loading editor" held={!gate.showIndicator} slow={slow} rows={1} rowHeight={260} />;
}

function editorMode(archived: boolean, saving: boolean): LegalEditorMode {
  if (archived) return "view";
  return saving ? "busy" : "edit";
}

/** What a text says about who can read it, under the editor. */
function editorHint(saved: LegalDocumentWithContentDto | null): string {
  if (saved === null) return "Not saved yet. Save it first, then publish it for guests to read.";
  if (saved.published) return "Published. Saving changes what guests read at once.";
  return "Draft. Guests cannot read it until you publish it.";
}

function stateBadge(saved: LegalDocumentWithContentDto | null) {
  if (saved === null) return <Badge variant="neutral">Not saved</Badge>;
  return <Badge variant={saved.published ? "ok" : "warn"}>{saved.published ? "Published" : "Draft"}</Badge>;
}

/** What the server did to the text, and what the editor could not show of it. */
function FormNotices({ changed, lossy }: Readonly<{ changed: boolean; lossy: boolean }>) {
  return (
    <>
      {changed && (
        <Notice variant="warning" role="alert">
          Some formatting could not be kept when the text was saved. The editor now shows the text as it was saved.
        </Notice>
      )}
      {lossy && (
        <Notice variant="warning" role="status">
          This text has formatting the editor cannot show, such as italics, quotes or line breaks. It is shown without it, and saving removes it.
        </Notice>
      )}
    </>
  );
}

interface FormFieldsProps {
  kind: LegalTextTarget["kind"];
  /** The key of a consent that is already saved. */
  savedKey: string | null;
  isNewConsent: boolean;
  keyText: string;
  keyProblem: string | undefined;
  title: string;
  titleMax: number;
  /** A save is on its way: the fields cannot be typed in. */
  saving: boolean;
  /** An archived event: nothing can be changed. */
  archived: boolean;
  onKey: (value: string) => void;
  onTitle: (value: string) => void;
}

/** The key (a consent that is being added, or the key of one that is saved) and the title of the text. */
function FormFields({ kind, savedKey, isNewConsent, keyText, keyProblem, title, titleMax, saving, archived, onKey, onTitle }: Readonly<FormFieldsProps>) {
  const isConsent = kind === "consent";
  return (
    <>
      {isNewConsent && (
        <Input
          label="Key"
          value={keyText}
          maxLength={CONSENT_KEY_MAX_CHARS}
          autoComplete="off"
          placeholder="photo-consent"
          hint="Part of the page address, and what a guest's consent is recorded under. It cannot be changed later."
          error={keyProblem}
          readOnly={saving}
          disabled={archived}
          onChange={(event) => onKey(event.target.value)}
        />
      )}
      {isConsent && !isNewConsent && <p className="at-hint">Key: {savedKey}</p>}
      <Input
        label={isConsent ? "Checkbox label" : "Title"}
        value={title}
        maxLength={titleMax}
        autoComplete="off"
        hint={
          isConsent
            ? "Guests read this next to the checkbox. It is also the title of the page the checkbox links to."
            : "The title of the page guests read, and its tab when the event has more than one text."
        }
        readOnly={saving}
        disabled={archived}
        onChange={(event) => onTitle(event.target.value)}
      />
    </>
  );
}

interface FormFooterProps {
  saved: LegalDocumentWithContentDto | null;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  publishing: boolean;
  deleting: boolean;
  onSave: () => void;
  onTogglePublished: () => void;
  onDelete: () => void;
}

/** What can be done with the text: save it, publish or unpublish it once it is saved, delete it. An archived event has none of it. */
function FormFooter({ saved, dirty, canSave, saving, publishing, deleting, onSave, onTogglePublished, onDelete }: Readonly<FormFooterProps>) {
  const busy = saving || publishing || deleting;
  return (
    <div className="settings-footer legal-editor__footer">
      <div className="settings-footer__status">
        {dirty && (
          <span className="settings-footer__save-state">
            <i className="ti ti-alert-triangle" aria-hidden="true" /> Unsaved changes
          </span>
        )}
      </div>
      <div className="settings-footer__buttons legal-editor__buttons">
        {saved !== null && (
          <Button variant="danger" icon={<i className="ti ti-trash" aria-hidden="true" />} aria-disabled={busy} onClick={onDelete}>
            Delete
          </Button>
        )}
        {saved !== null && (
          <Button variant="secondary" loading={publishing} aria-disabled={busy || dirty} onClick={onTogglePublished}>
            {saved.published ? "Unpublish" : "Publish"}
          </Button>
        )}
        <Button loading={saving} aria-disabled={!canSave || publishing || deleting} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

export interface LegalTextFormProps {
  eventId: string;
  event: EventDto;
  target: LegalTextTarget;
  /** The text as it is stored; null for one that has not been written. */
  initial: LegalDocumentWithContentDto | null;
  /** A consent that has not been written: its key is typed here, and it must not be one the event has. */
  newConsent: boolean;
  usedKeys: ReadonlySet<string>;
  limits: LegalDocumentLimitsDto;
  onBack: () => void;
  /** Something was saved, published, unpublished or deleted: the list behind this reads again. */
  onChanged: () => void;
  onDeleted: () => void;
}

/**
 * One text of the event: its title, its body in the visual editor, and the four things to do with it (save, publish or
 * unpublish, delete, and go back). A published text changes on its public page the moment it is saved, so the
 * editor says so, and Publish is for a text that is saved. The server cleans the HTML on save; when what it kept is not what
 * was sent, the editor shows what it kept and says so (the Notice).
 */
function LegalTextForm({ eventId, event, target, initial, newConsent, usedKeys, limits, onBack, onChanged, onDeleted }: Readonly<LegalTextFormProps>) {
  const { addToast } = useToast();
  const archived = isEventArchived(event);
  const labelId = useId();
  const hintId = useId();
  const [saved, setSaved] = useState<LegalDocumentWithContentDto | null>(initial);
  const [title, setTitle] = useState(initial?.title ?? defaultTitle(target.kind));
  const [keyText, setKeyText] = useState("");
  // The text as the editor reports it ("" for none), and what it reported when this text was loaded: the difference is the edit.
  const [html, setHtml] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  // True when what was stored has things the editor cannot show (italics, quotes, line breaks): it is shown without them.
  const [lossy, setLossy] = useState(false);
  // True after a save whose answer was not what was sent.
  const [changed, setChanged] = useState(false);
  // A new key makes a new editor, which shows the text as the server kept it.
  const [editorVersion, setEditorVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const isNewConsent = newConsent && saved === null;
  const keyProblem = isNewConsent ? consentKeyProblem(keyText, usedKeys) : undefined;
  const { dirty, empty, tooLong, canSave } = legalFormState({
    title,
    savedTitle: saved?.title ?? defaultTitle(target.kind),
    html,
    baseline,
    contentLimit: limits.content_chars,
    isNewConsent,
    keyText,
    keyProblem,
  });
  const busy = saving || publishing || deleting;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function handleHtml(next: string) {
    setHtml(next);
    if (baseline === null) {
      setBaseline(next);
      setLossy(saved !== null && next !== normalizeLegalHtml(saved.content_html));
    }
  }

  function takeSaved(answer: LegalDocumentWithContentDto, sent: string) {
    setSaved(answer);
    setTitle(answer.title);
    if (normalizeLegalHtml(answer.content_html) === sent) {
      setBaseline(sent);
      return;
    }
    // What the server kept is not what was sent: the editor shows what it kept, and says so.
    setChanged(true);
    setBaseline(null);
    setHtml(null);
    setLossy(false);
    setEditorVersion((version) => version + 1);
  }

  async function save() {
    if (busy || html === null || !canSave) return;
    const ref = saved?.ref ?? (isNewConsent ? consentTarget(keyText).ref : target.ref);
    setSaving(true);
    setChanged(false);
    try {
      takeSaved(await saveLegalDocument(eventId, ref, { title: title.trim(), content_html: html }), html);
      addToast("Text saved.", "success");
      onChanged();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Could not save this text."), "error");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublished() {
    if (busy || saved === null) return;
    setPublishing(true);
    try {
      const answer = saved.published ? await unpublishLegalDocument(eventId, saved.ref) : await publishLegalDocument(eventId, saved.ref);
      setSaved({ ...saved, ...answer });
      addToast(answer.published ? "Text published." : "Text unpublished. Guests can no longer read it.", "success");
      onChanged();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, saved.published ? "Could not unpublish this text." : "Could not publish this text."), "error");
    } finally {
      setPublishing(false);
    }
  }

  async function remove() {
    if (saved === null || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteLegalDocument(eventId, saved.ref);
      setDeleteOpen(false);
      addToast("Text deleted.", "success");
      onDeleted();
    } catch (err) {
      setDeleteError(operatorApiErrorMessage(err, "Could not delete this text."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="legal-editor">
      <div>
        <Button variant="ghost" icon={<i className="ti ti-arrow-left" aria-hidden="true" />} onClick={() => (dirty ? setDiscardOpen(true) : onBack())}>
          Back to legal texts
        </Button>
      </div>
      <Card title={KIND_LABEL[target.kind]} actions={stateBadge(saved)}>
        <div className="legal-editor__body">
          <FormNotices changed={changed} lossy={lossy} />
          <FormFields
            kind={target.kind}
            savedKey={target.key}
            isNewConsent={isNewConsent}
            keyText={keyText}
            keyProblem={keyProblem}
            title={title}
            titleMax={limits.title_chars}
            saving={saving}
            archived={archived}
            onKey={setKeyText}
            onTitle={setTitle}
          />
          <div className="at-field">
            <span id={labelId} className="at-label">
              Text
            </span>
            <Suspense fallback={<EditorFallback />}>
              <LegalHtmlEditor
                key={editorVersion}
                initialHtml={saved?.content_html ?? ""}
                labelledBy={labelId}
                describedBy={hintId}
                mode={editorMode(archived, saving)}
                onHtml={handleHtml}
              />
            </Suspense>
            <p id={hintId} className="at-hint">
              {editorHint(saved)}
            </p>
            {empty && !archived && html !== null && <p className="at-hint">Write some text before saving.</p>}
            {tooLong && (
              <p className="at-hint at-hint--error" role="alert">
                This text is too long to save: the limit is {limits.content_chars} characters, formatting included.
              </p>
            )}
            {saved?.published && (
              <a className="legal-editor__public-link" href={saved.public_path} target="_blank" rel="noopener noreferrer">
                View the public page <i className="ti ti-external-link" aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
        </div>
      </Card>
      {archived ? null : (
        <FormFooter
          saved={saved}
          dirty={dirty}
          canSave={canSave}
          saving={saving}
          publishing={publishing}
          deleting={deleting}
          onSave={() => void save()}
          onTogglePublished={() => void togglePublished()}
          onDelete={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        />
      )}
      <ConfirmDialog
        open={deleteOpen}
        title={`Delete "${saved?.title ?? ""}"?`}
        message="The text is removed for good, and its page stops working. There is no earlier version to bring back."
        confirmLabel="Delete"
        confirmVariant="danger"
        errorMessage={deleteError}
        loading={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      />
      <DiscardUnsavedChangesDialogs
        message="You have unsaved changes to this text."
        cancelDialogOpen={discardOpen}
        onCancelDialogConfirm={() => {
          setDiscardOpen(false);
          onBack();
        }}
        onCancelDialogDismiss={() => setDiscardOpen(false)}
        blockerDialogOpen={blocker.state === "blocked"}
        onBlockerDialogConfirm={() => blocker.proceed?.()}
        onBlockerDialogDismiss={() => blocker.reset?.()}
      />
    </div>
  );
}

export type LegalTextEditorProps = Omit<LegalTextFormProps, "initial"> & {
  /** Whether the text is stored: one that is not is a form that starts empty, with nothing to read. */
  exists: boolean;
};

/**
 * The editor of one text. A stored text is read first (its HTML is not in the list), and has the same wait as any card: a
 * placeholder after 200ms, "Taking longer than usual" after 8 seconds, and an error with a Retry that stays until the
 * answer is in. A text that has not been written has nothing to read.
 */
export function LegalTextEditor({ exists, ...form }: Readonly<LegalTextEditorProps>) {
  if (!exists) return <LegalTextForm {...form} initial={null} />;
  return <StoredLegalText {...form} />;
}

function StoredLegalText(form: Readonly<Omit<LegalTextFormProps, "initial">>) {
  const { eventId, target } = form;
  const { reportApiError } = useConnectionState();
  // A failure is told to the connection state when the answer is in, and a 401 hands the browser to the login page.
  const fetchText = useMemo(
    () =>
      orLoginRedirect(async (signal: AbortSignal) => {
        try {
          return await fetchLegalDocument(eventId, target.ref, signal);
        } catch (err) {
          if (err instanceof ApiError) reportApiError(err.status);
          throw err;
        }
      }),
    [eventId, target.ref, reportApiError],
  );
  const text = useListLoad({ fetcher: fetchText, fallback: "Could not load this text." });
  const card = useCardLoad(text);

  if (!card.gate.showContent) {
    return (
      <SettingsPanelSkeleton
        label="Loading legal text"
        held={!card.gate.showIndicator}
        slow={card.slow}
        cards={[{ id: "text", title: KIND_LABEL[target.kind], fields: 1, rows: 1, rowHeight: 396 }]}
        footer={false}
      />
    );
  }
  if (card.failure.error) {
    return (
      <RetryEmptyState
        title="Could not load this text"
        message={card.failure.error}
        retrying={card.failure.retrying}
        onRetry={card.failure.retry}
      />
    );
  }
  assertPresent(text.data);
  return (
    <div className="at-fade-in">
      <LegalTextForm {...form} initial={text.data} />
    </div>
  );
}
