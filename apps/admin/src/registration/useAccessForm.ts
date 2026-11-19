import { useRef, useState } from "react";
import { useToast } from "@admitto/ui";
import { ApiError, fetchLegalDocuments, fetchRegistrationSettings, saveRegistrationSettings } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { LegalDocumentDto, RegistrationSettingsDto } from "../api/types.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { claimErrors, draftFromSettings, settingsPatch, technicalOf, technicalPatch, type AccessDraft } from "./accessSettings.js";

/** Why a save did not happen, shown at the form: the checks that are not met (from the keys of the server's answer), or a sentence. */
export type AccessProblem = { kind: "not_ready"; blockers: readonly string[] } | { kind: "message"; text: string };

export interface AccessFormInput {
  eventId: string;
  /** The settings and the event's legal texts, as the first read of the tab found them. */
  settings: RegistrationSettingsDto;
  legalItems: readonly LegalDocumentDto[];
  /** Reads the event again, so that the page learns it was archived. */
  refreshEvent?: () => Promise<unknown>;
  /** Only a superadmin sends how guests open the form (the access method, the bot check, the identity provider and the restriction). */
  superadmin: boolean;
}

/**
 * The state of Event settings, Registration once its first read is in. `server` is the latest answer (what the checklist, the link and the
 * password say), `base` is the form as it was when the person started editing, and `draft` is the form now. A save sends the
 * difference between `draft` and `base` and nothing else (`settingsPatch`), so a setting the person did not touch is never written
 * back, and the answer of the server becomes both the new `base` and the new `draft`. Whether registration is on is the switch of the Registration page, not this form. For a
 * superadmin the difference includes how guests open the form (`technicalPatch`), sent with the provider the form was made from.
 */
export function useAccessForm({ eventId, settings, legalItems: firstLegalItems, refreshEvent, superadmin }: AccessFormInput) {
  const { addToast } = useToast();
  const [server, setServer] = useState(settings);
  const [legalItems, setLegalItems] = useState(firstLegalItems);
  const [base, setBase] = useState(() => draftFromSettings(settings));
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<AccessProblem | null>(null);
  // Which read of the settings is the newest: reads and changes can overtake each other, and only the newest may be applied.
  const newestRead = useRef(0);

  const technical = superadmin ? technicalPatch(draft, base) : {};
  const patch = { ...settingsPatch(draft, base), ...technical };
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
      const [latest, texts] = await Promise.allSettled([fetchRegistrationSettings(eventId), fetchLegalDocuments(eventId)]);
      if (mine !== newestRead.current) return;
      if (latest.status === "fulfilled") setServer(latest.value);
      if (texts.status === "fulfilled") setLegalItems(texts.value.items);
    } catch {
      // What the screen shows stays as it is, and so does the error that sent us here.
    }
  }

  /** A change was refused because the event is archived: the event is read again, so that the controls lock, and so are the settings, so that the checklist is true when it is restored. */
  function eventArchived() {
    void refreshEvent?.();
    void refresh();
  }

  /** Somebody else changed the identity provider of the event: nothing was saved. The settings are read again and the technical part of
   * the form takes them, so that the person sees what is saved now and decides again; what else was typed stays. A read that fails
   * leaves the form as it is. */
  async function startAgain() {
    const mine = ++newestRead.current;
    try {
      const latest = await fetchRegistrationSettings(eventId);
      if (mine !== newestRead.current) return;
      const next = technicalOf(draftFromSettings(latest));
      // Registration may have been turned off (or its mode changed) by somebody else meanwhile. A form that has not touched the mode takes
      // what is saved, and one that has keeps its edit, unless registration is off: then the mode is not a choice, and a Save that sent
      // the old one would turn registration on again without the activation of the Registration page.
      const mode = latest.mode;
      setServer(latest);
      setBase((current) => ({ ...current, ...next, mode }));
      setDraft((current) => ({ ...current, ...next, mode: mode === null || current.mode === base.mode ? mode : current.mode }));
    } catch {
      // What the form shows stays as it is, and so does the message that sent us here.
    }
  }

  /** The password was set or removed by its own request: the card says so now, and the settings are read again. */
  function passwordChanged(isSet: boolean) {
    setServer((current) => ({ ...current, password_set: isSet }));
    void refresh();
  }

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      redirectToLogin();
      return;
    }
    // These answers say that what the screen shows is out of date (the event lost something, a text was withdrawn, the event was
    // archived): read it again, and let the answer be the truth.
    if (hasApiErrorCode(err, "sso_provider_changed")) void startAgain();
    else if (hasApiErrorCode(err, "registration_not_ready") || hasApiErrorCode(err, "consent_not_published") || hasApiErrorCode(err, "sso_provider_not_available")) void refresh();
    if (hasApiErrorCode(err, "event_archived")) eventArchived();
    // Only a 409 `registration_not_ready` carries `blockers`: the keys of the checks that are not met, which the screen words itself.
    const blockers = err instanceof ApiError ? err.blockers : undefined;
    if (blockers && blockers.length > 0) {
      // Registration stays as it was: the mode that was asked for is not on the form any more, and the person's other changes are.
      setDraft((current) => ({ ...current, mode: base.mode }));
      setProblem({ kind: "not_ready", blockers });
    } else setProblem({ kind: "message", text: operatorApiErrorMessage(err, "Could not save the registration settings.") });
  }

  async function save() {
    // The Save button is off while nothing has changed and busy while a save runs, so a click never gets here then.
    /* v8 ignore if */
    if (saving || !dirty) return;
    // The restriction goes with its name and its values: one that is half typed is told at the buttons, as the server would refuse it.
    if (("sso_claim_name" in technical || "sso_claim_values" in technical) && Object.keys(claimErrors(draft)).length > 0) {
      setProblem({ kind: "message", text: "Fix the restriction to one company before you save." });
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      // The provider the form was made from, not the one a later read found and not the one picked: a save made after somebody else
      // changed it is refused.
      const answer = await saveRegistrationSettings(eventId, Object.keys(technical).length > 0 ? { ...patch, expected_sso_provider_id: base.sso_provider_id } : patch);
      const next = draftFromSettings(answer);
      addToast("Registration settings saved.", "success");
      // A read that started before this answer is older than it.
      newestRead.current += 1;
      setServer(answer);
      setBase(next);
      setDraft(next);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }

  return { server, legalItems, base, draft, dirty, saving, problem, edit, reset, save: () => void save(), passwordChanged, eventArchived, refresh };
}
