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
  // Issuer URL shape. The server schema (identity-api-routes.ts) only enforces
  // non-empty/max-length, so this client check is UX-level, not OIDC-spec
  // enforcement: accept http(s):// deliberately (localhost dev providers), and
  // leave strict https-only / RFC 8414 conformance to the server/auth layer.
  } else if (!/^https?:\/\//i.test(trimmed(draft.issuer))) {
    errors.issuer = "Issuer must be a URL starting with http(s)://";
  }

  if (trimmed(draft.client_id).length < 1) {
    errors.client_id = "Client ID is required.";
  } else if (trimmed(draft.client_id).length > MAX_CLIENT_ID) {
    errors.client_id = `Keep it under ${MAX_CLIENT_ID} characters.`;
  }

  // client_secret: required on create. On edit, blank means "keep the stored
  // secret" (even after the field was touched and cleared), so only enforce a
  // length cap when the operator actually typed a new value.
  const secretValue = draft.client_secret;
  if (mode === "create") {
    if (secretValue.trim().length < 1) {
      errors.client_secret = "Client secret is required.";
    } else if (secretValue.length > MAX_SECRET) {
      errors.client_secret = `Keep it under ${MAX_SECRET} characters.`;
    }
  } else if (secretValue.trim().length > 0 && secretValue.length > MAX_SECRET) {
    errors.client_secret = `Keep it under ${MAX_SECRET} characters.`;
  }

  // OIDC endpoint fields: max length + a UX-level http(s):// shape check, the
  // same lightweight guard used for `issuer` above. The server/auth layer is the
  // source of truth for OIDC conformance (assertSafeOidcFetchUrl); this just
  // catches garbage typing before the operator has to wait for a handshake.
  for (const field of [
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
    "userinfo_endpoint",
  ] as const) {
    const value = draft[field];
    if (!value) continue;
    if (value.trim().length > MAX_ENDPOINT) {
      errors[field] = `Keep it under ${MAX_ENDPOINT} characters.`;
    } else if (!/^https?:\/\//i.test(value.trim())) {
      errors[field] = "Endpoint must be a URL starting with http(s)://";
    }
  }

  // Claim field names are not URLs — length only.
  for (const [field, max] of [
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
    // The secret is write-only, so compare via the touched flag once. Both
    // `client_secret` and `client_secret_touched` would otherwise return the
    // same boolean (baseline always has client_secret_touched=false), making
    // the default branch a redundant second detection.
    if (key === "client_secret" || key === "client_secret_touched") {
      return draft.client_secret_touched;
    }
    return draft[key] !== baseline[key];
  });
}

/** Empty draft for create mode. `client_secret_touched` starts false. New
 * providers default to disabled — the auth layer treats omitted `enabled` as
 * false, and the legacy HTML editor leaves the checkbox unchecked, so flipping
 * it on is a deliberate operator action after the provider is configured. */
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
    enabled: false,
    login_button_label: "",
  };
}

// --- Group → role mapping repeater (slice 3b) ---

export type MappingRole = "superadmin" | "admin" | "operator";
export type MappingScope = "instance" | "organization" | "event";

export const MAPPING_ROLES: MappingRole[] = ["superadmin", "admin", "operator"];
export const MAPPING_SCOPES: MappingScope[] = ["instance", "organization", "event"];

export interface MappingRow {
  group: string;
  role: MappingRole;
  scope_type: MappingScope;
  scope_id: string;
}

export interface MappingRowError {
  group?: string;
  role?: string;
  scope_type?: string;
  scope_id?: string;
}

const MAX_GROUP = 200;
const MAX_SCOPE_ID = 200;

export function emptyMappingRow(): MappingRow {
  return { group: "", role: "operator", scope_type: "instance", scope_id: "" };
}

/** Validate one mapping row. `scope_id` is required for organization/event scopes. */
export function validateMappingRow(row: MappingRow): MappingRowError {
  const errors: MappingRowError = {};
  if (row.group.trim().length < 1) {
    errors.group = "Group is required.";
  } else if (row.group.trim().length > MAX_GROUP) {
    errors.group = `Keep it under ${MAX_GROUP} characters.`;
  }
  if (!MAPPING_ROLES.includes(row.role)) {
    errors.role = "Pick a role.";
  }
  if (!MAPPING_SCOPES.includes(row.scope_type)) {
    errors.scope_type = "Pick a scope.";
  }
  if (row.scope_type !== "instance") {
    if (row.scope_id.trim().length < 1) {
      errors.scope_id = "Scope ID is required for this scope.";
    } else if (row.scope_id.trim().length > MAX_SCOPE_ID) {
      errors.scope_id = `Keep it under ${MAX_SCOPE_ID} characters.`;
    }
  }
  return errors;
}

/** Validate a full mapping list; returns an array aligned with `rows` (empty objects = valid). */
export function validateMappings(rows: MappingRow[]): MappingRowError[] {
  return rows.map(validateMappingRow);
}

/** True when every row validates. */
export function areMappingsValid(rows: MappingRow[]): boolean {
  return validateMappings(rows).every((e) => Object.keys(e).length === 0);
}
