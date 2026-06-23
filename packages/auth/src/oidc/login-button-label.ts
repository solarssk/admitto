import {
  DEFAULT_SSO_LOGIN_BUTTON_LABEL,
  SSO_LOGIN_BUTTON_LABEL_MAX_LEN,
} from "./constants.js";

/** Resolve /login SSO button copy — blank/null uses product default. */
export function resolveSsoLoginButtonLabel(label: string | null | undefined): string {
  const trimmed = label?.trim();
  if (!trimmed) return DEFAULT_SSO_LOGIN_BUTTON_LABEL;
  return trimmed.slice(0, SSO_LOGIN_BUTTON_LABEL_MAX_LEN);
}

/** Normalize admin input for optional login_button_label (empty → null). */
export function normalizeSsoLoginButtonLabelInput(
  label: string | undefined,
): string | null {
  const trimmed = label?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, SSO_LOGIN_BUTTON_LABEL_MAX_LEN);
}
