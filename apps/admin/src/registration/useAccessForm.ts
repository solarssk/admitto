import { useRef, useState } from "react";
import { useToast } from "@admitto/ui";
import { ApiError, fetchLegalDocuments, fetchRegistrationSettings, saveRegistrationSettings } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { LegalDocumentDto, RegistrationSettingsDto, SaveRegistrationSettingsBody } from "../api/types.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { draftFromSettings, settingsPatch, type AccessDraft } from "./accessSettings.js";

/** Why a save did not happen, shown at the form: the checks that are not met (from the keys of the server's answer), or a sentence. */
export type AccessProblem = { kind: "not_ready"; blockers: readonly string[] } | { kind: "message"; text: string };

/** What a save that worked says, in a toast: turning registration on or off is the thing an organiser wants to hear. */
function savedMessage(patch: SaveRegistrationSettingsBody, base: AccessDraft): string {
  if (patch.mode === null) return "Registration is off.";
  if (patch.mode !== undefined && base.mode === null) return "Registration is on.";
  return "Registration settings saved.";
}

export interface AccessFormInput {
  eventId: string;
  /** The settings and the event's legal texts, as the first read of the tab found them. */
  settings: RegistrationSettingsDto;
  legalItems: readonly LegalDocumentDto[];
  /** Reads the event again, so that the page learns it was archived. */
  refreshEvent?: () => Promise<unknown>;
}

/**
 * The state of the Access tab once its first read is in. `server` is the latest answer (what the checklist, the link and the
 * password say), `base` is the form as it was when the person started editing, and `draft` is the form now. A save sends the
 * difference between `draft` and `base` and nothing else (`settingsPatch`), so a setting the person did not touch is never written
 * back, and the answer of the server becomes both the new `base` and the new `draft`. Turning registration off asks first.
 */
export function useAccessForm({ eventId, settings, legalItems: firstLegalItems, refreshEvent }: AccessFormInput) {
  const { addToast } = useToast();
  const [server, setServer] = useState(settings);
  const [legalItems, setLegalItems] = useState(firstLegalItems);
  const [base, setBase] = useState(() => draftFromSettings(settings));
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<AccessProblem | null>(null);
  const [confirmOffOpen, setConfirmOffOpen] = useState(false);
  // Which read of the settings is the newest: reads and changes can overtake each other, and only the newest may be applied.
  const newestRead = useRef(0);

  const patch = settingsPatch(draft, base);
  const dirty = Object.keys(patch).length > 0;

  function edit(change: Partial<AccessDraft>) {
    setDraft((current) => ({ ...current, ...change }));
    // What went wrong with the last save says nothing about the change that is being made now.
    setProblem(null);
  }

  function reset() {
    setDraft(base);
    setProblem(null);
  }

  /** Reads the settings and the texts again, quietly: the checklist and the list of consents learn what changed, and the form does not move. */
  async function refresh() {
    // A password set and then removed, or a save, can start a read while an older one is still on its way: the older answer, if it
    // comes last, must not put back what the newer change took away, and neither may a slow read of the texts hold an old answer back.
    const mine = ++newestRead.current;
    try {
      const [latest, texts] = await Promise.all([fetchRegistrationSettings(eventId), fetchLegalDocuments(eventId)]);
      if (mine !== newestRead.current) return;
      setServer(latest);
      setLegalItems(texts.items);
    } catch {
      // What the screen shows stays as it is, and so does the error that sent us here.
    }
  }

  /** A change was refused because the event is archived: the event is read again, so that the controls lock, and so are the settings, so that the checklist is true when it is restored. */
  function eventArchived() {
    void refreshEvent?.();
    void refresh();
  }

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      redirectToLogin();
      return;
    }
    // These answers say that what the screen shows is out of date (the event lost something, a text was withdrawn, the event was
    // archived): read it again, and let the answer be the truth.
    if (hasApiErrorCode(err, "registration_not_ready") || hasApiErrorCode(err, "consent_not_published")) void refresh();
    if (hasApiErrorCode(err, "event_archived")) eventArchived();
    // Only a 409 `registration_not_ready` carries `blockers`: the keys of the checks that are not met, which the screen words itself.
    const blockers = err instanceof ApiError ? err.blockers : undefined;
    if (blockers && blockers.length > 0) {
      // Registration stays as it was: the mode that was asked for is not on the form any more, and the person's other changes are.
      setDraft((current) => ({ ...current, mode: base.mode }));
      setProblem({ kind: "not_ready", blockers });
    } else setProblem({ kind: "message", text: operatorApiErrorMessage(err, "Could not save the registration settings.") });
  }

  async function submit() {
    // Only the confirmation of turning off calls this, and its button is busy while the save runs.
    /* v8 ignore if */
    if (saving) return;
    setSaving(true);
    setProblem(null);
    try {
      const answer = await saveRegistrationSettings(eventId, patch);
      const next = draftFromSettings(answer);
      addToast(savedMessage(patch, base), "success");
      // A read that started before this answer is older than it.
      newestRead.current += 1;
      setServer(answer);
      setBase(next);
      setDraft(next);
      setConfirmOffOpen(false);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }

  function save() {
    // The Save button is off while nothing has changed and busy while a save runs, so a click never gets here then.
    /* v8 ignore if */
    if (saving || !dirty) return;
    // Turning registration off closes the form for every guest at once: say what it does first.
    if (patch.mode === null) setConfirmOffOpen(true);
    else void submit();
  }

  function cancelTurnOff() {
    setConfirmOffOpen(false);
    setProblem(null);
  }

  /** The password was set or removed by its own request: the form says so now, and the checklist is read again. */
  function passwordChanged(isSet: boolean) {
    setServer((current) => ({ ...current, password_set: isSet }));
    void refresh();
  }

  return { server, legalItems, base, draft, dirty, saving, problem, confirmOffOpen, edit, reset, save, submit: () => void submit(), cancelTurnOff, passwordChanged, eventArchived };
}
