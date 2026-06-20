import type { MailProvider, SaveMailSettingsBody } from "../api/types.js";

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

  if (draft.provider && draft.provider !== "export_only") {
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

export function buildSaveMailSettingsBody(
  draft: MailDraft,
  secrets: SecretEdits,
): SaveMailSettingsBody {
  const body: SaveMailSettingsBody = {};

  if (draft.provider) body.provider = draft.provider;
  if (draft.fromAddress.trim()) body.fromAddress = draft.fromAddress.trim();
  else if (draft.fromAddress === "") body.fromAddress = "";
  if (draft.fromName.trim()) body.fromName = draft.fromName.trim();
  if (draft.replyTo.trim()) body.replyTo = draft.replyTo.trim();
  if (draft.envelopeFrom.trim()) body.envelopeFrom = draft.envelopeFrom.trim();
  if (draft.allowedFromDomain.trim()) body.allowedFromDomain = draft.allowedFromDomain.trim();

  if (draft.provider === "smtp") {
    body.host = draft.host.trim();
    const port = optionalInt(draft.port);
    if (port !== undefined && !Number.isNaN(port)) body.port = port;
    body.secure = draft.secure;
    body.requireTls = draft.requireTls;
    body.tlsRejectUnauthorized = draft.tlsRejectUnauthorized;
    if (draft.user.trim()) body.user = draft.user.trim();
    if (draft.heloName.trim()) body.heloName = draft.heloName.trim();
    body.pool = draft.pool;
    const maxConn = optionalInt(draft.maxConnections);
    if (maxConn !== undefined && !Number.isNaN(maxConn)) body.maxConnections = maxConn;
    const maxMsg = optionalInt(draft.maxMessages);
    if (maxMsg !== undefined && !Number.isNaN(maxMsg)) body.maxMessages = maxMsg;
    const rate = optionalInt(draft.rateLimitPerMinute);
    if (rate !== undefined && !Number.isNaN(rate)) body.rateLimitPerMinute = rate;
    const connT = optionalInt(draft.connectionTimeout);
    if (connT !== undefined && !Number.isNaN(connT)) body.connectionTimeout = connT;
    const greetT = optionalInt(draft.greetingTimeout);
    if (greetT !== undefined && !Number.isNaN(greetT)) body.greetingTimeout = greetT;
    const sockT = optionalInt(draft.socketTimeout);
    if (sockT !== undefined && !Number.isNaN(sockT)) body.socketTimeout = sockT;
  }

  if (draft.provider === "graph") {
    if (draft.mailbox.trim()) body.mailbox = draft.mailbox.trim();
    body.tenantId = draft.tenantId.trim();
    body.clientId = draft.clientId.trim();
    body.saveToSentItems = draft.saveToSentItems;
  }

  for (const key of [
    "smtpPassword",
    "graphClientSecret",
    "powerAutomateUrl",
    "powerAutomateKey",
  ] as const) {
    const edit = secrets[key];
    if (edit.mode === "replace" && edit.value) {
      body[key] = edit.value;
    } else if (edit.mode === "clear") {
      body[key] = "";
    }
  }

  return body;
}
