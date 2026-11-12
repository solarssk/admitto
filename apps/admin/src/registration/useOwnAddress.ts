import { useState } from "react";
import { useToast } from "@admitto/ui";
import { ApiError, checkCustomDomain, saveCustomDomain } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { CustomDomainDto, RegistrationOwnAddressDto } from "../api/types.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { judgeAddressInput } from "./ownAddress.js";

export interface OwnAddressInput {
  eventId: string;
  /** The address as saved, and the host of the instance (an own address cannot be that). */
  saved: RegistrationOwnAddressDto | null;
  instanceHost: string | null;
  /** An answer of the server changed the state: the page takes it and reads the settings again (the link for guests may have moved). */
  onChanged: (state: CustomDomainDto) => void;
  /** A request was refused because the event is archived: the page reads the event again. */
  onArchived: () => void;
}

/**
 * What a superadmin does with the event's own address: type it, save it, remove it and ask for a check. One busy flag for each of the
 * three requests; a failure is a sentence at the field (never the text the server sent), and a request that cannot work for want of a
 * session sends the person to the sign-in.
 */
export function useOwnAddress({ eventId, saved, instanceHost, onChanged, onArchived }: OwnAddressInput) {
  const { addToast } = useToast();
  const [typed, setTyped] = useState(saved?.domain ?? "");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const judged = judgeAddressInput(typed, instanceHost);
  // Nothing typed is no mistake until the person tries to save; a name is judged as soon as there is one and the field was left.
  const fieldError = touched && typed.trim() !== "" && !judged.ok ? judged.message : undefined;
  const unchanged = judged.ok && judged.domain === saved?.domain;

  /** The answer of a request that worked, or a sentence at the field for one that did not. */
  async function run(request: () => Promise<CustomDomainDto>, fallback: string): Promise<CustomDomainDto | null> {
    setError(null);
    try {
      return await request();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) redirectToLogin();
      else {
        setError(operatorApiErrorMessage(err, fallback));
        if (hasApiErrorCode(err, "event_archived")) onArchived();
      }
      return null;
    }
  }

  async function save() {
    setTouched(true);
    // The button is busy while a request runs and off for an address that is already saved; for one that is wrong it says why, at the field.
    if (!judged.ok) return;
    setSaving(true);
    const state = await run(() => saveCustomDomain(eventId, judged.domain), "Could not save the address.");
    setSaving(false);
    if (state === null) return;
    setTyped(state.custom_domain ?? "");
    addToast("Address saved. Check it once IT has set it up.", "success");
    onChanged(state);
  }

  async function remove(): Promise<boolean> {
    /* v8 ignore if */
    if (removing) return false;
    setRemoving(true);
    const state = await run(() => saveCustomDomain(eventId, null), "Could not remove the address.");
    setRemoving(false);
    if (state === null) return false;
    setTyped("");
    setTouched(false);
    addToast("Address removed. Guests get links on the main address.", "success");
    onChanged(state);
    return true;
  }

  async function check() {
    /* v8 ignore if */
    if (checking) return;
    setChecking(true);
    const state = await run(() => checkCustomDomain(eventId), "Could not check the address.");
    setChecking(false);
    if (state !== null) onChanged(state);
  }

  return {
    typed,
    edit: (value: string) => {
      setTyped(value);
      setError(null);
    },
    leave: () => setTouched(true),
    fieldError,
    unchanged,
    saving,
    removing,
    checking,
    error,
    save: () => void save(),
    remove,
    check: () => void check(),
  };
}
