/**
 * Shared between org-scoped (mail-settings-routes.ts) and event-scoped
 * (event-mail-settings-routes.ts) mail settings routes: request validation and
 * the descriptor -> wire-shape serialization. Provider-agnostic — neither
 * schema nor serializer cares which scope the settings belong to.
 */
import { z } from "zod";
import type { ConfigDescriptor, FieldDescriptor, FieldSource, MailSettingsInput } from "@admitto/mailer-config";

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
  })
  .strict();

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
