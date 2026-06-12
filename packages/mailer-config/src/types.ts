export type MailScope =
  | { scopeType: "organization"; scopeId: string }
  | { scopeType: "event"; scopeId: string };

export type FieldSource = "env" | "event" | "organization" | "default";

export interface FieldDescriptor<T = unknown> {
  value: T;
  source: FieldSource;
  /** true when the field is set in env and cannot be changed from the UI */
  locked: boolean;
}

export type ConfigDescriptor = {
  provider: FieldDescriptor<string | null>;
  // shared sender
  fromAddress: FieldDescriptor<string | null>;
  fromName: FieldDescriptor<string | null>;
  replyTo: FieldDescriptor<string | null>;
  envelopeFrom: FieldDescriptor<string | null>;
  allowedFromDomain: FieldDescriptor<string | null>;
  // smtp non-secret
  host: FieldDescriptor<string | null>;
  port: FieldDescriptor<number | null>;
  secure: FieldDescriptor<boolean | null>;
  user: FieldDescriptor<string | null>;
  requireTls: FieldDescriptor<boolean | null>;
  tlsRejectUnauthorized: FieldDescriptor<boolean | null>;
  heloName: FieldDescriptor<string | null>;
  pool: FieldDescriptor<boolean | null>;
  maxConnections: FieldDescriptor<number | null>;
  maxMessages: FieldDescriptor<number | null>;
  rateLimitPerMinute: FieldDescriptor<number | null>;
  connectionTimeout: FieldDescriptor<number | null>;
  greetingTimeout: FieldDescriptor<number | null>;
  socketTimeout: FieldDescriptor<number | null>;
  // smtp secret (always masked)
  smtpPassword: FieldDescriptor<"••••" | null>;
  // graph non-secret
  mailbox: FieldDescriptor<string | null>;
  tenantId: FieldDescriptor<string | null>;
  clientId: FieldDescriptor<string | null>;
  saveToSentItems: FieldDescriptor<boolean | null>;
  // graph secret (always masked)
  graphClientSecret: FieldDescriptor<"••••" | null>;
  // power automate secrets (always masked)
  powerAutomateUrl: FieldDescriptor<"••••" | null>;
  powerAutomateKey: FieldDescriptor<"••••" | null>;
};

export interface MailSettingsInput {
  provider?: string;
  // shared sender (non-secret)
  fromAddress?: string;
  fromName?: string;
  replyTo?: string;
  envelopeFrom?: string;
  allowedFromDomain?: string;
  // smtp non-secret
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  requireTls?: boolean;
  tlsRejectUnauthorized?: boolean;
  heloName?: string;
  pool?: boolean;
  maxConnections?: number;
  maxMessages?: number;
  rateLimitPerMinute?: number;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
  // graph non-secret
  mailbox?: string;
  tenantId?: string;
  clientId?: string;
  saveToSentItems?: boolean;
  // secrets (plain input — will be encrypted before storage)
  smtpPassword?: string;
  graphClientSecret?: string;
  powerAutomateKey?: string;
  powerAutomateUrl?: string;
}

/** Raw env fields extracted individually — no Zod validation of the whole config. */
export interface RawMailFields {
  provider?: string;
  // smtp
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  requireTls?: boolean;
  tlsRejectUnauthorized?: boolean;
  heloName?: string;
  pool?: boolean;
  maxConnections?: number;
  maxMessages?: number;
  rateLimitPerMinute?: number;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
  smtpPassword?: string;
  // graph
  mailbox?: string;
  tenantId?: string;
  clientId?: string;
  saveToSentItems?: boolean;
  graphClientSecret?: string;
  // power automate
  powerAutomateUrl?: string;
  powerAutomateKey?: string;
  // shared sender
  fromAddress?: string;
  fromName?: string;
  replyTo?: string;
  envelopeFrom?: string;
  allowedFromDomain?: string;
}
