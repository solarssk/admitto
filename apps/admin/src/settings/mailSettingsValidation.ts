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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    pool: false,
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
  if (!Number.isInteger(n)) return NaN;
  return n;
}

export function validateMailDraft(draft: MailDraft): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (draft.provider) {
    const from = draft.fromAddress.trim();
    if (!from || !EMAIL_RE.test(from)) {
      errors.push("From address must be a valid email.");
    }
    const reply = draft.replyTo.trim();
    if (reply && !EMAIL_RE.test(reply)) {
      errors.push("Reply-to must be a valid email.");
    }
    const envelope = draft.envelopeFrom.trim();
    if (envelope && !EMAIL_RE.test(envelope)) {
      errors.push("Envelope from must be a valid email.");
    }
  }

  if (draft.provider === "smtp") {
    if (!draft.host.trim()) errors.push("SMTP host is required.");
    const port = optionalInt(draft.port);
    if (port === undefined || Number.isNaN(port) || port < 1 || port > 65535) {
      errors.push("SMTP port must be between 1 and 65535.");
    }
  }

  if (draft.provider === "graph") {
    if (!draft.tenantId.trim()) errors.push("Tenant ID is required.");
    if (!draft.clientId.trim()) errors.push("Client ID is required.");
  }

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

export function isMailSettingsDirty(
  draft: MailDraft,
  savedDraft: MailDraft,
  secrets: SecretEdits,
): boolean {
  if (JSON.stringify(draft) !== JSON.stringify(savedDraft)) return true;
  return Object.values(secrets).some((edit) => edit.mode !== "idle");
}

export function buildSaveMailSettingsBody(
  draft: MailDraft,
  secrets: SecretEdits,
  lockedKeys: ReadonlySet<keyof MailSettingsFieldsDto> = new Set(),
): SaveMailSettingsBody {
  const body: SaveMailSettingsBody = {};
  const unlocked = (key: keyof MailSettingsFieldsDto) => !lockedKeys.has(key);

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

  if (draft.provider === "smtp") {
    if (unlocked("host")) body.host = draft.host.trim();
    if (unlocked("port")) {
      const port = optionalInt(draft.port);
      if (port !== undefined && !Number.isNaN(port)) body.port = port;
    }
    if (unlocked("secure")) body.secure = draft.secure;
    if (unlocked("requireTls")) body.requireTls = draft.requireTls;
    if (unlocked("tlsRejectUnauthorized")) body.tlsRejectUnauthorized = draft.tlsRejectUnauthorized;
    if (unlocked("user")) setClearableString(body, "user", draft.user);
    if (unlocked("heloName")) setClearableString(body, "heloName", draft.heloName);
    if (unlocked("pool")) body.pool = draft.pool;
    if (unlocked("maxConnections")) {
      const maxConn = optionalInt(draft.maxConnections);
      if (maxConn !== undefined && !Number.isNaN(maxConn)) body.maxConnections = maxConn;
    }
    if (unlocked("maxMessages")) {
      const maxMsg = optionalInt(draft.maxMessages);
      if (maxMsg !== undefined && !Number.isNaN(maxMsg)) body.maxMessages = maxMsg;
    }
    if (unlocked("rateLimitPerMinute")) {
      const rate = optionalInt(draft.rateLimitPerMinute);
      if (rate !== undefined && !Number.isNaN(rate)) body.rateLimitPerMinute = rate;
    }
    if (unlocked("connectionTimeout")) {
      const connT = optionalInt(draft.connectionTimeout);
      if (connT !== undefined && !Number.isNaN(connT)) body.connectionTimeout = connT;
    }
    if (unlocked("greetingTimeout")) {
      const greetT = optionalInt(draft.greetingTimeout);
      if (greetT !== undefined && !Number.isNaN(greetT)) body.greetingTimeout = greetT;
    }
    if (unlocked("socketTimeout")) {
      const sockT = optionalInt(draft.socketTimeout);
      if (sockT !== undefined && !Number.isNaN(sockT)) body.socketTimeout = sockT;
    }
  }

  if (draft.provider === "graph") {
    if (unlocked("mailbox")) setClearableString(body, "mailbox", draft.mailbox);
    if (unlocked("tenantId")) body.tenantId = draft.tenantId.trim();
    if (unlocked("clientId")) body.clientId = draft.clientId.trim();
    if (unlocked("saveToSentItems")) body.saveToSentItems = draft.saveToSentItems;
  }

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

  return body;
}
