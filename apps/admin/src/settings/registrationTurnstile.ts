import type { RegistrationTurnstileDto, SaveRegistrationTurnstileBody } from "../api/types.js";
import type { SecretEditMode } from "./mailSettingsValidation.js";

/** The edit state of the Turnstile card in External services. The secret key is write-only: it is
 * never loaded into the draft, so `idle` means "keep what is saved". */
export interface TurnstileDraft {
  siteKey: string;
  secret: { mode: SecretEditMode; value: string };
}

/** Same shapes the server accepts. The server checks them again; these only spare a round trip. */
const SITE_KEY_PATTERN = /^[0-9A-Za-z_-]{1,128}$/;
const SECRET_KEY_PATTERN = /^[\x21-\x7E]{1,512}$/;

export const TURNSTILE_SITE_KEY_ERROR =
  "The site key can only contain letters, digits, hyphens and underscores.";
export const TURNSTILE_SECRET_KEY_ERROR = "Enter the secret key without spaces.";
export const TURNSTILE_SECRET_KEY_EMPTY_ERROR = "Enter the secret key, or choose Cancel to keep the saved one.";

export function turnstileDraftFrom(dto: RegistrationTurnstileDto): TurnstileDraft {
  return { siteKey: dto.site_key ?? "", secret: { mode: "idle", value: "" } };
}

export function turnstileDirty(draft: TurnstileDraft, saved: TurnstileDraft): boolean {
  return draft.siteKey.trim() !== saved.siteKey.trim() || draft.secret.mode !== "idle";
}

/** Messages for what would be refused. Empty when the draft can be saved (or has nothing to save). */
export function turnstileValidationErrors(draft: TurnstileDraft): string[] {
  const errors: string[] = [];
  const siteKey = draft.siteKey.trim();
  if (siteKey !== "" && !SITE_KEY_PATTERN.test(siteKey)) errors.push(TURNSTILE_SITE_KEY_ERROR);
  if (draft.secret.mode === "replace") {
    const typed = draft.secret.value.trim();
    if (typed.length === 0) errors.push(TURNSTILE_SECRET_KEY_EMPTY_ERROR);
    else if (!SECRET_KEY_PATTERN.test(typed)) errors.push(TURNSTILE_SECRET_KEY_ERROR);
  }
  return errors;
}

/** What to PUT, or null when nothing changed. A site key that was emptied is cleared. */
export function buildTurnstileSaveBody(
  draft: TurnstileDraft,
  saved: TurnstileDraft,
): SaveRegistrationTurnstileBody | null {
  const body: SaveRegistrationTurnstileBody = {};
  const siteKey = draft.siteKey.trim();
  if (siteKey !== saved.siteKey.trim()) body.site_key = siteKey === "" ? null : siteKey;
  if (draft.secret.mode === "replace") body.secret_key = draft.secret.value.trim();
  if (draft.secret.mode === "clear") body.secret_key = null;
  return Object.keys(body).length > 0 ? body : null;
}
