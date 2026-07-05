/**
 * Client-side validation for the OIDC provider editor, mirroring the server Zod
 * schema in `identity-api-routes.ts` (slice 1, #294). Kept in a separate module
 * so the editor component stays readable and the rules are unit-testable.
 *
 * Slice 3a covers the simple text/boolean fields (Basics, Endpoints, Claims,
 * login button label). The group→role mapping repeater is validated in slice 3b.
 */

export interface ProviderDraft {
  display_name: string;
  issuer: string;
  client_id: string;
  /** Empty on create; on edit, empty means "keep the stored secret". */
  client_secret: string;
  client_secret_touched: boolean;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
  claim_email: string;
  claim_name: string;
  claim_groups: string;
  enabled: boolean;
  login_button_label: string;
}

export type EditorMode = "create" | "edit";

export type FieldErrors = Partial<Record<keyof ProviderDraft, string>>;

const MAX_NAME = 200;
const MAX_ISSUER = 2000;
const MAX_CLIENT_ID = 500;
const MAX_SECRET = 2000;
const MAX_ENDPOINT = 2000;
const MAX_CLAIM = 200;
const MAX_LABEL = 120;

function trimmed(value: string): string {
  return value.trim();
}

/** Validate the slice-3a fields. Returns a map of field → message (empty when valid). */
export function validateProviderDraft(draft: ProviderDraft, mode: EditorMode): FieldErrors {
  const errors: FieldErrors = {};

  if (trimmed(draft.display_name).length < 1) {
    errors.display_name = "Display name is required.";
  } else if (trimmed(draft.display_name).length > MAX_NAME) {
    errors.display_name = `Keep it under ${MAX_NAME} characters.`;
  }

  if (trimmed(draft.issuer).length < 1) {
    errors.issuer = "Issuer URL is required.";
  } else if (trimmed(draft.issuer).length > MAX_ISSUER) {
    errors.issuer = `Keep it under ${MAX_ISSUER} characters.`;
  } else if (!/^https?:\/\//i.test(trimmed(draft.issuer))) {
    errors.issuer = "Issuer must be a URL starting with http(s)://";
  }

  if (trimmed(draft.client_id).length < 1) {
    errors.client_id = "Client ID is required.";
  } else if (trimmed(draft.client_id).length > MAX_CLIENT_ID) {
    errors.client_id = `Keep it under ${MAX_CLIENT_ID} characters.`;
  }

  // client_secret: required on create; on edit only when the user typed a new value.
  const secretValue = draft.client_secret;
  if (mode === "create" || draft.client_secret_touched) {
    if (secretValue.trim().length < 1) {
      errors.client_secret = "Client secret is required.";
    } else if (secretValue.length > MAX_SECRET) {
      errors.client_secret = `Keep it under ${MAX_SECRET} characters.`;
    }
  }

  for (const [field, max] of [
    ["authorization_endpoint", MAX_ENDPOINT],
    ["token_endpoint", MAX_ENDPOINT],
    ["jwks_uri", MAX_ENDPOINT],
    ["userinfo_endpoint", MAX_ENDPOINT],
    ["claim_email", MAX_CLAIM],
    ["claim_name", MAX_CLAIM],
    ["claim_groups", MAX_CLAIM],
  ] as const) {
    const value = draft[field];
    if (value && value.trim().length > max) {
      errors[field] = `Keep it under ${max} characters.`;
    }
  }

  if (draft.login_button_label && draft.login_button_label.trim().length > MAX_LABEL) {
    errors.login_button_label = `Keep it under ${MAX_LABEL} characters.`;
  }

  return errors;
}

/** True when any field differs from the snapshot taken after load (edit) or from the create empty state. */
export function isDraftDirty(draft: ProviderDraft, baseline: ProviderDraft): boolean {
  return (Object.keys(draft) as Array<keyof ProviderDraft>).some((key) => {
    if (key === "client_secret") {
      // On edit, a touched (non-empty) secret counts as dirty; untouched never does.
      return draft.client_secret_touched;
    }
    return draft[key] !== baseline[key];
  });
}

/** Empty draft for create mode. `client_secret_touched` starts false. */
export function emptyProviderDraft(): ProviderDraft {
  return {
    display_name: "",
    issuer: "",
    client_id: "",
    client_secret: "",
    client_secret_touched: false,
    authorization_endpoint: "",
    token_endpoint: "",
    jwks_uri: "",
    userinfo_endpoint: "",
    claim_email: "",
    claim_name: "",
    claim_groups: "",
    enabled: true,
    login_button_label: "",
  };
}
