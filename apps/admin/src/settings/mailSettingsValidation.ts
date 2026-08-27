import type { MailProvider, MailSettingsFieldsDto, SaveMailSettingsBody } from "../api/types.js";
import { isKnownTld } from "./knownTlds.js";

export type MailDraft = {
  provider: MailProvider | "";
  fromAddress: string;
  fromName: string;
  replyTo: string;
  envelopeFrom: string;
  allowedFromDomain: string;
  host: string;
  port: string;
  secure: boolean;
  user: string;
  requireTls: boolean;
  tlsRejectUnauthorized: boolean;
  heloName: string;
  pool: boolean;
  maxConnections: string;
  maxMessages: string;
  rateLimitPerMinute: string;
  connectionTimeout: string;
  greetingTimeout: string;
  socketTimeout: string;
  mailbox: string;
  tenantId: string;
  clientId: string;
  saveToSentItems: boolean;
};

export type SecretEditMode = "idle" | "replace" | "clear";

export type SecretEdits = Record<
  "smtpPassword" | "graphClientSecret" | "powerAutomateUrl" | "powerAutomateKey",
  { mode: SecretEditMode; value: string }
>;

/** A single dot-separated domain label: non-empty, max 63 chars (RFC 1035), letters/digits/
 * hyphens only, no leading or trailing hyphen. Bounded, unambiguous character classes - not
 * the kind of pattern that backtracks on adversarial input. */
function isValidDomainLabel(label: string): boolean {
  if (label.length === 0 || label.length > 63) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label);
}

/** At least one label before a real IANA-delegated TLD (knownTlds.ts), and every label -
 * not just the TLD - must itself look like a valid domain label. Catches a typo'd or
 * reserved TLD ("example.con", "host.local") the same as before, plus a malformed domain
 * shape a TLD-only check would wave through ("example..com", "-example.com"). */
function isValidDomain(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every(isValidDomainLabel)) return false;
  return isKnownTld(labels.at(-1)!);
}

/** local@domain shape, no whitespace, exactly one "@". Plain string ops rather than a
 * regex for the "@" split - see this function's own re-export use in
 * mailTransportFormParts.tsx (isPlausibleEmail used to be a byte-for-byte second copy of
 * this) for why regex is avoided there. Exported so that caller reuses this instead of
 * re-implementing it. */
export function isValidEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  return isValidDomain(domain);
}

/** Mirrors the server's authoritative length limits (mail-settings-shared.ts's
 * putMailSettingsBodySchema) so a value the client accepts never gets rejected on save. */
const MAX_LENGTHS = {
  fromAddress: 254,
  fromName: 200,
  replyTo: 254,
  envelopeFrom: 254,
  allowedFromDomain: 253,
  host: 253,
  user: 254,
  heloName: 253,
  mailbox: 254,
  tenantId: 64,
  clientId: 64,
} as const;

export function emptyMailDraft(): MailDraft {
  return {
    provider: "",
    fromAddress: "",
    fromName: "",
    replyTo: "",
    envelopeFrom: "",
    allowedFromDomain: "",
    host: "",
    port: "",
    secure: false,
    requireTls: true,
    tlsRejectUnauthorized: true,
    heloName: "",
    pool: true,
    user: "",
    maxConnections: "",
    maxMessages: "",
    rateLimitPerMinute: "",
    connectionTimeout: "",
    greetingTimeout: "",
    socketTimeout: "",
    mailbox: "",
    tenantId: "",
    clientId: "",
    saveToSentItems: true,
  };
}

export function emptySecretEdits(): SecretEdits {
  return {
    smtpPassword: { mode: "idle", value: "" },
    graphClientSecret: { mode: "idle", value: "" },
    powerAutomateUrl: { mode: "idle", value: "" },
    powerAutomateKey: { mode: "idle", value: "" },
  };
}

function optionalEmail(value: string): string | undefined {
  const t = value.trim();
  if (!t) return undefined;
  return t;
}

function optionalInt(value: string): number | undefined {
  const t = value.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isInteger(n)) return Number.NaN;
  return n;
}

/** Field → message. One message per field - later checks below don't overwrite a field
 * that an earlier, more fundamental check already flagged. */
export type MailFieldErrors = Partial<Record<keyof MailDraft, string>>;

function validateEmailFields(draft: MailDraft, errors: MailFieldErrors): void {
  if (!draft.provider) return;

  const fromName = draft.fromName.trim();
  if (fromName.length > MAX_LENGTHS.fromName) {
    errors.fromName = `Keep it under ${MAX_LENGTHS.fromName} characters.`;
  }
  const reply = draft.replyTo.trim();
  if (reply && !isValidEmail(reply)) {
    errors.replyTo = "Reply-to must be a valid email.";
  } else if (reply.length > MAX_LENGTHS.replyTo) {
    errors.replyTo = `Keep it under ${MAX_LENGTHS.replyTo} characters.`;
  }
  const envelope = draft.envelopeFrom.trim();
  if (envelope && !isValidEmail(envelope)) {
    errors.envelopeFrom = "Envelope from must be a valid email.";
  } else if (envelope.length > MAX_LENGTHS.envelopeFrom) {
    errors.envelopeFrom = `Keep it under ${MAX_LENGTHS.envelopeFrom} characters.`;
  }
  const from = draft.fromAddress.trim();
  if (from && !isValidEmail(from)) {
    errors.fromAddress = "From address must be a valid email.";
  } else if (from.length > MAX_LENGTHS.fromAddress) {
    errors.fromAddress = `Keep it under ${MAX_LENGTHS.fromAddress} characters.`;
  }
}

function validateFromAddressRequired(draft: MailDraft, errors: MailFieldErrors): void {
  const requiresFrom =
    draft.provider === "smtp" ||
    draft.provider === "powerautomate" ||
    draft.provider === "export_only";
  if (!requiresFrom || errors.fromAddress) return;

  if (!draft.fromAddress.trim()) errors.fromAddress = "From address must be a valid email.";
}

function validateSmtpFields(draft: MailDraft, errors: MailFieldErrors): void {
  if (draft.provider !== "smtp") return;

  const host = draft.host.trim();
  if (!host) errors.host = "SMTP host is required.";
  else if (host.length > MAX_LENGTHS.host) errors.host = `Keep it under ${MAX_LENGTHS.host} characters.`;

  const port = optionalInt(draft.port);
  if (port === undefined || Number.isNaN(port) || port < 1 || port > 65535) {
    errors.port = "SMTP port must be between 1 and 65535.";
  }

  const user = draft.user.trim();
  if (user.length > MAX_LENGTHS.user) errors.user = `Keep it under ${MAX_LENGTHS.user} characters.`;

  const helo = draft.heloName.trim();
  if (helo.length > MAX_LENGTHS.heloName) {
    errors.heloName = `Keep it under ${MAX_LENGTHS.heloName} characters.`;
  } else if (/\s/.test(helo)) {
    errors.heloName = "Must not contain spaces.";
  }
}

const TUNING_FIELD_KEYS = [
  "maxConnections",
  "maxMessages",
  "rateLimitPerMinute",
  "connectionTimeout",
  "greetingTimeout",
  "socketTimeout",
] as const satisfies ReadonlyArray<keyof MailDraft>;

const TUNING_FIELD_LABELS: Record<(typeof TUNING_FIELD_KEYS)[number], string> = {
  maxConnections: "Max connections",
  maxMessages: "Max messages per connection",
  rateLimitPerMinute: "Rate limit",
  connectionTimeout: "Connection timeout",
  greetingTimeout: "Greeting timeout",
  socketTimeout: "Socket timeout",
};

/** Every field validated inside SmtpConnectionCard's collapsed "Advanced tuning"
 * `<details>` - the single source of truth for which fields must force that section open
 * on error, so a future addition to TUNING_FIELD_KEYS can't be forgotten there. */
export const ADVANCED_TUNING_FIELD_KEYS = [
  "heloName",
  ...TUNING_FIELD_KEYS,
] as const satisfies ReadonlyArray<keyof MailDraft>;

/** Each of these is optional (blank = provider default) but, when set, is sent to the
 * server as a positive integer - an invalid value here previously failed silently: the
 * save-body builder's own int guard just dropped it, so the operator's edit vanished with
 * no feedback at all. */
function validateTuningFields(draft: MailDraft, errors: MailFieldErrors): void {
  if (draft.provider !== "smtp") return;

  for (const key of TUNING_FIELD_KEYS) {
    if (!draft[key].trim()) continue;
    const n = optionalInt(draft[key]);
    if (n === undefined || Number.isNaN(n) || n < 1) {
      errors[key] = `${TUNING_FIELD_LABELS[key]} must be a positive whole number.`;
    }
  }
}

function validateGraphFields(draft: MailDraft, errors: MailFieldErrors): void {
  if (draft.provider !== "graph") return;

  const tenantId = draft.tenantId.trim();
  if (!tenantId) errors.tenantId = "Tenant ID is required.";
  else if (tenantId.length > MAX_LENGTHS.tenantId) {
    errors.tenantId = `Keep it under ${MAX_LENGTHS.tenantId} characters.`;
  }

  const clientId = draft.clientId.trim();
  if (!clientId) errors.clientId = "Client ID is required.";
  else if (clientId.length > MAX_LENGTHS.clientId) {
    errors.clientId = `Keep it under ${MAX_LENGTHS.clientId} characters.`;
  }

  const mailbox = draft.mailbox.trim();
  const from = draft.fromAddress.trim();
  if (!mailbox && !from) {
    errors.mailbox = "Mailbox or from address is required.";
  } else if (mailbox && !isValidEmail(mailbox)) {
    errors.mailbox = "Mailbox must be a valid email.";
  } else if (mailbox.length > MAX_LENGTHS.mailbox) {
    errors.mailbox = `Keep it under ${MAX_LENGTHS.mailbox} characters.`;
  }
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

/** A bare hostname shape - no scheme, no "@", no port, every label valid (isValidDomain)
 * ending in a real TLD (knownTlds.ts). The server itself only enforces length here
 * (mail-settings-shared.ts), so this is a client-side plausibility check only, same spirit
 * as isValidEmail above. Rejects any ":" (not just "://") so "http:example.com" - missing
 * the double slash but still not a bare domain - doesn't slip through. */
function isPlausibleDomain(value: string): boolean {
  if (/\s/.test(value) || value.includes("@") || value.includes(":")) return false;
  return isValidDomain(value);
}

/** Format/length check on the Allowed from domain field itself. Runs before the
 * cross-field mismatch check below, which needs a well-formed domain to compare against. */
function validateAllowedDomainField(draft: MailDraft, errors: MailFieldErrors): void {
  const raw = draft.allowedFromDomain.trim();
  if (!raw) return;

  if (raw.length > MAX_LENGTHS.allowedFromDomain) {
    errors.allowedFromDomain = `Keep it under ${MAX_LENGTHS.allowedFromDomain} characters.`;
    return;
  }
  if (!isPlausibleDomain(normalizeDomain(raw))) {
    errors.allowedFromDomain = "Enter a bare domain, e.g. example.com.";
  }
}

/** The allowed-domain restriction checks whichever field actually supplies the sending
 * address - From address normally, or the Graph mailbox when From address is blank - and
 * flags that same field, so the red border lands on the field the operator needs to fix.
 * Exception: when that sender field is env-locked, the operator can't act on an error
 * placed there (validateMailDraft strips locked-field errors entirely) - the mismatch is
 * just as real, so it's redirected onto the editable Allowed from domain field instead of
 * silently disappearing. */
function validateAllowedDomain(
  draft: MailDraft,
  errors: MailFieldErrors,
  fieldLocked?: (key: keyof MailDraft) => boolean,
): void {
  if (errors.allowedFromDomain) return;
  const allowedDomain = normalizeDomain(draft.allowedFromDomain);
  if (!allowedDomain || !draft.provider) return;

  let effectiveField: "fromAddress" | "mailbox" = "fromAddress";
  let effectiveFrom = draft.fromAddress.trim();
  if (draft.provider === "graph" && !effectiveFrom) {
    effectiveFrom = draft.mailbox.trim();
    effectiveField = "mailbox";
  }
  if (!effectiveFrom || errors[effectiveField]) return;

  const domain = effectiveFrom.split("@")[1]?.toLowerCase();
  if (!domain || domain !== allowedDomain) {
    const fieldLabel = effectiveField === "mailbox" ? "Mailbox" : "From address";
    if (fieldLocked?.(effectiveField) && !fieldLocked("allowedFromDomain")) {
      errors.allowedFromDomain = `Allowed from domain must match the ${fieldLabel.toLowerCase()} domain (${domain}).`;
    } else {
      errors[effectiveField] = `${fieldLabel} must use the allowed domain (${allowedDomain}).`;
    }
  }
}

/** `fieldLocked` is env-managed fields (rendered as disabled inputs the operator cannot
 * edit - see fieldLocked in MailTransportPanel/EventMailSettingsCard/WizardStep2Mail).
 * Errors on those fields are dropped: an operator can't fix a value that isn't theirs to
 * edit, and buildSaveMailSettingsBody already excludes locked fields from what gets saved,
 * so a bad env value there would otherwise permanently block Save on every other field too. */
export function validateMailDraft(
  draft: MailDraft,
  fieldLocked?: (key: keyof MailDraft) => boolean,
): MailFieldErrors {
  const errors: MailFieldErrors = {};
  validateEmailFields(draft, errors);
  validateFromAddressRequired(draft, errors);
  validateSmtpFields(draft, errors);
  validateTuningFields(draft, errors);
  validateGraphFields(draft, errors);
  validateAllowedDomainField(draft, errors);
  validateAllowedDomain(draft, errors, fieldLocked);
  if (fieldLocked) {
    for (const key of Object.keys(errors) as Array<keyof MailFieldErrors>) {
      if (fieldLocked(key)) delete errors[key];
    }
  }
  return errors;
}

function setClearableString(
  body: SaveMailSettingsBody,
  key: keyof SaveMailSettingsBody,
  value: string,
): void {
  const trimmed = value.trim();
  if (trimmed) {
    (body as Record<string, string>)[key] = trimmed;
  } else {
    (body as Record<string, string>)[key] = "";
  }
}

type ClearableIntKey =
  | "port"
  | "maxConnections"
  | "maxMessages"
  | "rateLimitPerMinute"
  | "connectionTimeout"
  | "greetingTimeout"
  | "socketTimeout";

function setClearableInt(body: SaveMailSettingsBody, key: ClearableIntKey, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) {
    body[key] = null;
    return;
  }
  const n = Number(trimmed);
  if (Number.isInteger(n)) {
    body[key] = n;
  }
}

/** SMTP boolean defaults aligned with @admitto/mailer schema defaults. */
export function smtpProviderDraftDefaults(): Pick<
  MailDraft,
  "pool" | "requireTls" | "tlsRejectUnauthorized" | "secure"
> {
  return {
    pool: true,
    requireTls: true,
    tlsRejectUnauthorized: true,
    secure: false,
  };
}

export function isMailSettingsDirty(
  draft: MailDraft,
  savedDraft: MailDraft,
  secrets: SecretEdits,
): boolean {
  if (JSON.stringify(draft) !== JSON.stringify(savedDraft)) return true;
  return Object.values(secrets).some((edit) => edit.mode !== "idle");
}

type UnlockedCheck = (key: keyof MailSettingsFieldsDto) => boolean;

function applyBaseFields(body: SaveMailSettingsBody, draft: MailDraft, unlocked: UnlockedCheck): void {
  if (unlocked("provider")) {
    body.provider = draft.provider || "";
  }
  if (unlocked("fromAddress")) setClearableString(body, "fromAddress", draft.fromAddress);
  if (unlocked("fromName")) setClearableString(body, "fromName", draft.fromName);
  if (unlocked("replyTo")) setClearableString(body, "replyTo", draft.replyTo);
  if (unlocked("envelopeFrom")) setClearableString(body, "envelopeFrom", draft.envelopeFrom);
  if (unlocked("allowedFromDomain")) {
    setClearableString(body, "allowedFromDomain", draft.allowedFromDomain);
  }
}

/** Only call when draft.provider === "smtp". */
function applySmtpFields(body: SaveMailSettingsBody, draft: MailDraft, unlocked: UnlockedCheck): void {
  if (unlocked("host")) body.host = draft.host.trim();
  if (unlocked("port")) setClearableInt(body, "port", draft.port);
  if (unlocked("secure")) body.secure = draft.secure;
  if (unlocked("requireTls")) body.requireTls = draft.requireTls;
  if (unlocked("tlsRejectUnauthorized")) body.tlsRejectUnauthorized = draft.tlsRejectUnauthorized;
  if (unlocked("user")) setClearableString(body, "user", draft.user);
  if (unlocked("heloName")) setClearableString(body, "heloName", draft.heloName);
  if (unlocked("pool")) body.pool = draft.pool;
  if (unlocked("maxConnections")) setClearableInt(body, "maxConnections", draft.maxConnections);
  if (unlocked("maxMessages")) setClearableInt(body, "maxMessages", draft.maxMessages);
  if (unlocked("rateLimitPerMinute")) {
    setClearableInt(body, "rateLimitPerMinute", draft.rateLimitPerMinute);
  }
  if (unlocked("connectionTimeout")) {
    setClearableInt(body, "connectionTimeout", draft.connectionTimeout);
  }
  if (unlocked("greetingTimeout")) setClearableInt(body, "greetingTimeout", draft.greetingTimeout);
  if (unlocked("socketTimeout")) setClearableInt(body, "socketTimeout", draft.socketTimeout);
}

/** Only call when draft.provider === "graph". */
function applyGraphFields(body: SaveMailSettingsBody, draft: MailDraft, unlocked: UnlockedCheck): void {
  if (unlocked("mailbox")) setClearableString(body, "mailbox", draft.mailbox);
  if (unlocked("tenantId")) body.tenantId = draft.tenantId.trim();
  if (unlocked("clientId")) body.clientId = draft.clientId.trim();
  if (unlocked("saveToSentItems")) body.saveToSentItems = draft.saveToSentItems;
}

function applySecretFields(
  body: SaveMailSettingsBody,
  secrets: SecretEdits,
  unlocked: UnlockedCheck,
): void {
  for (const key of [
    "smtpPassword",
    "graphClientSecret",
    "powerAutomateUrl",
    "powerAutomateKey",
  ] as const) {
    if (!unlocked(key)) continue;
    const edit = secrets[key];
    if (edit.mode === "replace" && edit.value) {
      body[key] = edit.value;
    } else if (edit.mode === "clear") {
      body[key] = "";
    }
  }
}

export function buildSaveMailSettingsBody(
  draft: MailDraft,
  secrets: SecretEdits,
  lockedKeys: ReadonlySet<keyof MailSettingsFieldsDto> = new Set(),
): SaveMailSettingsBody {
  const body: SaveMailSettingsBody = {};
  const unlocked: UnlockedCheck = (key) => !lockedKeys.has(key);

  applyBaseFields(body, draft, unlocked);
  if (draft.provider === "smtp") applySmtpFields(body, draft, unlocked);
  if (draft.provider === "graph") applyGraphFields(body, draft, unlocked);
  applySecretFields(body, secrets, unlocked);

  return body;
}
