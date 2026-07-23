import type { MailProvider, MailSettingsFieldsDto, SaveMailSettingsBody } from "../api/types.js";

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

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

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

function validateEmailFields(draft: MailDraft): string[] {
  if (!draft.provider) return [];

  const errors: string[] = [];
  const reply = draft.replyTo.trim();
  if (reply && !EMAIL_RE.test(reply)) {
    errors.push("Reply-to must be a valid email.");
  }
  const envelope = draft.envelopeFrom.trim();
  if (envelope && !EMAIL_RE.test(envelope)) {
    errors.push("Envelope from must be a valid email.");
  }
  const from = draft.fromAddress.trim();
  if (from && !EMAIL_RE.test(from)) {
    errors.push("From address must be a valid email.");
  }
  return errors;
}

function validateFromAddressRequired(draft: MailDraft): string[] {
  const requiresFrom =
    draft.provider === "smtp" ||
    draft.provider === "powerautomate" ||
    draft.provider === "export_only";
  if (!requiresFrom) return [];

  return draft.fromAddress.trim() ? [] : ["From address must be a valid email."];
}

function validateSmtpFields(draft: MailDraft): string[] {
  if (draft.provider !== "smtp") return [];

  const errors: string[] = [];
  if (!draft.host.trim()) errors.push("SMTP host is required.");
  const port = optionalInt(draft.port);
  if (port === undefined || Number.isNaN(port) || port < 1 || port > 65535) {
    errors.push("SMTP port must be between 1 and 65535.");
  }
  return errors;
}

function validateGraphFields(draft: MailDraft): string[] {
  if (draft.provider !== "graph") return [];

  const errors: string[] = [];
  if (!draft.tenantId.trim()) errors.push("Tenant ID is required.");
  if (!draft.clientId.trim()) errors.push("Client ID is required.");
  const mailbox = draft.mailbox.trim();
  const from = draft.fromAddress.trim();
  if (!mailbox && !from) {
    errors.push("Mailbox or from address is required.");
  }
  if (mailbox && !EMAIL_RE.test(mailbox)) {
    errors.push("Mailbox must be a valid email.");
  }
  return errors;
}

function validateAllowedDomain(draft: MailDraft): string[] {
  const allowedDomain = draft.allowedFromDomain.trim().toLowerCase().replace(/^@/, "");
  if (!allowedDomain || !draft.provider) return [];

  let effectiveFrom = draft.fromAddress.trim();
  if (draft.provider === "graph" && !effectiveFrom) {
    effectiveFrom = draft.mailbox.trim();
  }
  if (!effectiveFrom) return [];

  const domain = effectiveFrom.split("@")[1]?.toLowerCase();
  if (!domain || domain !== allowedDomain) {
    return [`From address must use the allowed domain (${allowedDomain}).`];
  }
  return [];
}

export function validateMailDraft(draft: MailDraft): { valid: boolean; errors: string[] } {
  const errors: string[] = [
    ...validateEmailFields(draft),
    ...validateFromAddressRequired(draft),
    ...validateSmtpFields(draft),
    ...validateGraphFields(draft),
    ...validateAllowedDomain(draft),
  ];

  return { valid: errors.length === 0, errors };
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
