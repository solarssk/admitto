/**
 * Shared between org-scoped (mail-settings-routes.ts) and event-scoped
 * (event-mail-settings-routes.ts) mail settings routes: request validation and
 * the descriptor -> wire-shape serialization. Provider-agnostic — neither
 * schema nor serializer cares which scope the settings belong to.
 */
import { z } from "zod";
import type { Context } from "hono";
import type { ConfigDescriptor, FieldDescriptor, FieldSource, MailSettingsInput } from "@admitto/mailer-config";
import {
  isSendSuccess,
  MailDestinationError,
  probeMailTransport,
  type MailerConfig,
  type MailerProvider,
  type MailProbeResult,
  type SendResult,
} from "@admitto/mailer";
import { transportTestErrorForAdmin } from "@admitto/mail-delivery";
import { emitSystemLog } from "@admitto/shared/system-log";

/** Injectable probe for org/event POST /mail-settings/probe (tests). */
export type MailSmtpProbeDeps = {
  probeMail?: (config: unknown) => Promise<MailProbeResult>;
};

/** Max JSON body for mail-settings PUT routes (includes secret fields). */
export const MAX_MAIL_SETTINGS_BODY_BYTES = 65_536;

const MAIL_PROVIDER = z.enum(["graph", "smtp", "powerautomate", "export_only"]);

const optionalEmail = z
  .union([z.string().trim().email().max(254), z.literal("")])
  .optional();

/** Trimmed non-empty string, or explicit "" to clear a stored value. */
const optionalTrimmedNonEmpty = (max: number) =>
  z.union([z.string().trim().min(1).max(max), z.literal("")]).optional();

const optionalPositiveInt = z.union([z.number().int().min(1), z.null()]).optional();

export const putMailSettingsBodySchema = z
  .object({
    provider: z.union([MAIL_PROVIDER, z.literal("")]).optional(),
    fromAddress: optionalEmail,
    fromName: optionalTrimmedNonEmpty(200),
    replyTo: optionalEmail,
    envelopeFrom: optionalEmail,
    allowedFromDomain: optionalTrimmedNonEmpty(253),
    host: optionalTrimmedNonEmpty(253),
    port: z.union([z.number().int().min(1).max(65535), z.null()]).optional(),
    secure: z.boolean().optional(),
    user: optionalTrimmedNonEmpty(254),
    requireTls: z.boolean().optional(),
    tlsRejectUnauthorized: z.boolean().optional(),
    heloName: optionalTrimmedNonEmpty(253),
    pool: z.boolean().optional(),
    maxConnections: optionalPositiveInt,
    maxMessages: optionalPositiveInt,
    rateLimitPerMinute: optionalPositiveInt,
    connectionTimeout: optionalPositiveInt,
    greetingTimeout: optionalPositiveInt,
    socketTimeout: optionalPositiveInt,
    mailbox: optionalEmail,
    tenantId: optionalTrimmedNonEmpty(64),
    clientId: optionalTrimmedNonEmpty(64),
    saveToSentItems: z.boolean().optional(),
    smtpPassword: z.string().optional(),
    graphClientSecret: z.string().optional(),
    powerAutomateKey: z.string().optional(),
    powerAutomateUrl: z.string().optional(),
  })
  .strict();

export const testMailTransportBodySchema = z
  .object({
    to: z
      .string()
      .trim()
      .email()
      .max(254)
      .refine((v) => !/[\r\n]/.test(v), "invalid email"),
    /** Event Send test only: after send, wait for bounce ingest to mark a probe delivery. */
    verifyBounce: z.boolean().optional(),
  })
  .strict();

/** Parse Send-test body; distinguish bad recipient from other schema failures (e.g. unknown keys). */
export function parseTestMailTransportBody(json: unknown):
  | { ok: true; data: z.infer<typeof testMailTransportBodySchema> }
  | { ok: false; detail: string } {
  const parsed = testMailTransportBodySchema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  const toIssue = parsed.error.issues.some((issue) => issue.path[0] === "to");
  return {
    ok: false,
    detail: toIssue ? "Enter a valid email address." : "Invalid test request.",
  };
}

export const SECRET_KEYS = [
  "smtpPassword",
  "graphClientSecret",
  "powerAutomateKey",
  "powerAutomateUrl",
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

export function isSecretKey(key: string): key is SecretKey {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

export type ApiFieldSource = "env" | "db" | "default";

export function toApiSource(source: FieldSource): ApiFieldSource {
  if (source === "organization" || source === "event") return "db";
  return source;
}

function serializePlainField<T>(fd: FieldDescriptor<T>) {
  return {
    value: fd.value,
    source: toApiSource(fd.source),
    locked: fd.locked,
  };
}

function serializeSecretField(fd: FieldDescriptor<"••••" | null>) {
  return {
    set: fd.value === "••••",
    masked: fd.value,
    source: toApiSource(fd.source),
    locked: fd.locked,
  };
}

export function serializeDescriptor(desc: ConfigDescriptor) {
  return {
    provider: serializePlainField(desc.provider),
    fromAddress: serializePlainField(desc.fromAddress),
    fromName: serializePlainField(desc.fromName),
    replyTo: serializePlainField(desc.replyTo),
    envelopeFrom: serializePlainField(desc.envelopeFrom),
    allowedFromDomain: serializePlainField(desc.allowedFromDomain),
    host: serializePlainField(desc.host),
    port: serializePlainField(desc.port),
    secure: serializePlainField(desc.secure),
    user: serializePlainField(desc.user),
    requireTls: serializePlainField(desc.requireTls),
    tlsRejectUnauthorized: serializePlainField(desc.tlsRejectUnauthorized),
    heloName: serializePlainField(desc.heloName),
    pool: serializePlainField(desc.pool),
    maxConnections: serializePlainField(desc.maxConnections),
    maxMessages: serializePlainField(desc.maxMessages),
    rateLimitPerMinute: serializePlainField(desc.rateLimitPerMinute),
    connectionTimeout: serializePlainField(desc.connectionTimeout),
    greetingTimeout: serializePlainField(desc.greetingTimeout),
    socketTimeout: serializePlainField(desc.socketTimeout),
    smtpPassword: serializeSecretField(desc.smtpPassword),
    mailbox: serializePlainField(desc.mailbox),
    tenantId: serializePlainField(desc.tenantId),
    clientId: serializePlainField(desc.clientId),
    saveToSentItems: serializePlainField(desc.saveToSentItems),
    graphClientSecret: serializeSecretField(desc.graphClientSecret),
    powerAutomateUrl: serializeSecretField(desc.powerAutomateUrl),
    powerAutomateKey: serializeSecretField(desc.powerAutomateKey),
  };
}

export function descriptorForKey(
  desc: ConfigDescriptor,
  key: keyof MailSettingsInput,
): FieldDescriptor<unknown> {
  return desc[key as keyof ConfigDescriptor] as FieldDescriptor<unknown>;
}

export function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

export const MAIL_PROVIDER_UNCONFIGURED = "Cannot resolve mail provider";

/** Maps a `resolveMailConfig()` "no provider configured" error to a 422 JSON response;
 * returns null for any other error so the caller can rethrow it unchanged. */
export function mailNotConfiguredResponse(c: Context, err: unknown): Response | null {
  const message = err instanceof Error ? err.message : undefined;
  if (message?.includes(MAIL_PROVIDER_UNCONFIGURED)) {
    return c.json({ error: "mail_not_configured" }, 422);
  }
  return null;
}

/**
 * Maps mail transport setup failures that happen before a delivery row is created
 * (missing provider, blocked/unresolvable SMTP or webhook host) to 422 JSON.
 * Returns null for unrelated errors so the caller can rethrow.
 */
export function mailTransportSetupErrorResponse(c: Context, err: unknown): Response | null {
  const notConfigured = mailNotConfiguredResponse(c, err);
  if (notConfigured) return notConfigured;
  if (err instanceof MailDestinationError) {
    return c.json({ error: err.code }, 422);
  }
  return null;
}

/** Splits a PUT body into what changed for the audit log: plain fields vs. which secrets
 * were rotated (non-empty value) vs. cleared (explicit ""). Shared by org and event PUT. */
export function classifyMailSettingsFields(body: Record<string, unknown>): {
  fieldsChanged: string[];
  secretsRotated: string[];
  secretsCleared: string[];
} {
  const fieldsChanged: string[] = [];
  const secretsRotated: string[] = [];
  const secretsCleared: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (isSecretKey(key)) {
      if (value === "") secretsCleared.push(key);
      else if (typeof value === "string" && value.length > 0) secretsRotated.push(key);
    } else {
      fieldsChanged.push(key);
    }
  }

  return { fieldsChanged, secretsRotated, secretsCleared };
}

/** Outcome of a transport test-send, in the shape both the org and event POST /test
 * routes build their JSON response from. */
export interface TransportTestOutcome {
  resultStatus: "sent" | "failed";
  errorMessage?: string;
  resultProvider?: MailerProvider;
  resultProviderMessageId?: string;
  resultRetryable?: boolean;
  /** Present when event Send test ran with verifyBounce. */
  bounceProbe?: {
    status: "ok" | "timeout" | "failed";
    message: string;
    smtpCode?: string | null;
  };
}

/** Runs one transport test-send: calls `send()`, maps a thrown/returned error to
 * operator-facing text, and logs with `logPrefix`. Shared by org and event POST /test —
 * only the send call itself (org- vs event-scoped config resolution) differs per caller. */
export async function runTransportTest(
  send: () => Promise<SendResult>,
  logPrefix: string,
): Promise<TransportTestOutcome> {
  let resultStatus: "sent" | "failed" = "failed";
  let errorMessage: string | undefined;
  let resultProvider: MailerProvider | undefined;
  let resultProviderMessageId: string | undefined;
  let resultRetryable: boolean | undefined;

  try {
    const result = await send();
    resultProvider = result.provider;

    if (!isSendSuccess(result.status) || result.error) {
      if (result.error) {
        // Never log the raw provider error — it can include the rejected recipient
        // address or transport details (coding guidelines: no unnecessary PII in logs).
        console.error(`${logPrefix} failed`);
      }
      errorMessage = transportTestErrorForAdmin(result.error);
      resultRetryable = result.retryable;
      // errorMessage is already the sanitized, operator-safe text above — safe to surface
      // in the live System logs tail too, unlike the raw result.error.
      emitSystemLog("mail", "error", "mail_test_failed", {
        context: logPrefix,
        provider: result.provider,
        error: errorMessage,
      });
    } else {
      resultStatus = "sent";
      resultProviderMessageId = result.providerMessageId;
    }
  } catch (err) {
    // A thrown error here means send() never returned a result at all — most often
    // SmtpAdapter.create()'s DNS/SSRF-guard check on the configured host failing before any
    // adapter instance exists, so SmtpAdapter.send()'s own emitSystemLog calls are never
    // reached for this failure mode. Logging it here is the only place this class of
    // misconfiguration (bad host, unresolvable hostname) becomes visible in System logs.
    const message = err instanceof Error ? err.message : undefined;
    if (message) {
      console.error(`${logPrefix} failed`);
    }
    if (message?.includes(MAIL_PROVIDER_UNCONFIGURED)) {
      errorMessage = "mail transport not configured";
    } else {
      errorMessage = transportTestErrorForAdmin(message);
    }
    emitSystemLog("mail", "error", "mail_test_failed", { context: logPrefix, error: errorMessage });
  }

  return { resultStatus, errorMessage, resultProvider, resultProviderMessageId, resultRetryable };
}

/** Shapes a TransportTestOutcome into the POST /test JSON response. Shared by org and
 * event routes — the response shape never depends on which scope was tested. */
export function transportTestResponse(c: Context, outcome: TransportTestOutcome): Response {
  const {
    resultStatus,
    resultProvider,
    resultProviderMessageId,
    errorMessage,
    resultRetryable,
    bounceProbe,
  } = outcome;

  if (resultStatus === "sent") {
    // resultProvider is always set alongside resultStatus = "sent".
    return c.json({
      status: "sent",
      provider: resultProvider!,
      ...(resultProviderMessageId ? { providerMessageId: resultProviderMessageId } : {}),
      ...(bounceProbe ? { bounceProbe } : {}),
    });
  }

  return c.json({
    status: "failed",
    error: errorMessage ?? "send failed",
    ...(resultProvider ? { provider: resultProvider } : {}),
    ...(resultRetryable !== undefined ? { retryable: resultRetryable } : {}),
    ...(bounceProbe ? { bounceProbe } : {}),
  });
}

export const SMTP_PROBE_SUCCESS_MESSAGE = "Connected. SMTP account verified.";
export const SMTP_PROBE_NOT_SMTP_MESSAGE =
  "SMTP connection test is only available when the saved transport is SMTP.";

/** Probes a resolved SMTP config without sending mail. Caller must already gate on provider. */
export async function runSmtpConnectionProbe(
  config: MailerConfig,
  logPrefix: string,
  deps: MailSmtpProbeDeps = {},
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const probe = deps.probeMail ?? probeMailTransport;
  let result: MailProbeResult;
  try {
    result = await probe(config);
  } catch (err) {
    const errorMessage = transportTestErrorForAdmin(
      err instanceof Error ? err.message : undefined,
    );
    console.error(`${logPrefix} failed`);
    emitSystemLog("mail", "error", "mail_smtp_probe_failed", {
      context: logPrefix,
      error: errorMessage,
    });
    return { ok: false, error: errorMessage };
  }

  if (result.ok && !result.skipped) {
    emitSystemLog("mail", "info", "mail_smtp_probe_ok", { context: logPrefix });
    return { ok: true, message: SMTP_PROBE_SUCCESS_MESSAGE };
  }

  const errorMessage = result.ok
    ? "SMTP connection could not be verified."
    : transportTestErrorForAdmin(result.error);
  console.error(`${logPrefix} failed`);
  emitSystemLog("mail", "error", "mail_smtp_probe_failed", {
    context: logPrefix,
    error: errorMessage,
  });
  return { ok: false, error: errorMessage };
}
