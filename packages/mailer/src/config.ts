import { z } from "zod";

/**
 * Mailer configuration schemas. Discriminated union on `provider` —
 * the same shape is used by the UI Settings form and the backend,
 * making this the single source of validation truth.
 */

export const mailSenderSchema = z.object({
  fromAddress: z.string().email("fromAddress must be a valid email address"),
  fromName: z.string().min(1).optional(),
  replyTo: z.string().email("replyTo must be a valid email address").optional(),
  envelopeFrom: z.string().email("envelopeFrom must be a valid email address").optional(),
});

/** Sender fields with optional fromAddress (Graph derives default from mailbox). */
export const optionalFromSenderSchema = z.object({
  fromAddress: z.string().email("fromAddress must be a valid email address").optional(),
  fromName: z.string().min(1).optional(),
  replyTo: z.string().email("replyTo must be a valid email address").optional(),
  envelopeFrom: z.string().email("envelopeFrom must be a valid email address").optional(),
});

export const graphConfigSchema = z
  .object({
    provider: z.literal("graph"),
    /** Mailbox identity for /users/{mailbox}/sendMail (Application Access Policy). */
    mailbox: z.string().email("mailbox must be a valid email address"),
    tenantId: z.string().min(1, "tenantId is required"),
    clientId: z.string().min(1, "clientId is required"),
    clientSecret: z.string().min(1, "clientSecret is required"),
    saveToSentItems: z.boolean().default(true),
  })
  .merge(optionalFromSenderSchema);

export const smtpConfigSchema = z
  .object({
    provider: z.literal("smtp"),
    host: z.string().min(1),
    port: z.number().int().positive().default(587),
    /** false => STARTTLS (port 587), true => TLS (port 465). */
    secure: z.boolean().default(false),
    user: z.string().min(1),
    password: z.string().min(1),
    requireTLS: z.boolean().default(true),
    tlsRejectUnauthorized: z.boolean().default(true),
    heloName: z.string().min(1).optional(),
    pool: z.boolean().default(true),
    maxConnections: z.number().int().positive().default(3),
    maxMessages: z.number().int().positive().default(100),
    /** Max messages per minute (mapped to nodemailer rateLimit + rateDelta). */
    rateLimitPerMinute: z.number().int().positive().default(30),
    connectionTimeout: z.number().int().positive().default(30_000),
    greetingTimeout: z.number().int().positive().default(30_000),
    socketTimeout: z.number().int().positive().default(60_000),
  })
  .merge(mailSenderSchema);

export const powerAutomateConfigSchema = z
  .object({
    provider: z.literal("powerautomate"),
    /** HTTP flow trigger URL (secret — contains sig token). */
    url: z.string().url("url must be a valid flow URL"),
    /** Optional key sent in x-admitto-key header (endpoint protection). */
    key: z.string().optional(),
  })
  .merge(mailSenderSchema);

export const exportOnlyConfigSchema = z
  .object({
    provider: z.literal("export_only"),
  })
  .merge(mailSenderSchema);

export const mailerConfigSchema = z.discriminatedUnion("provider", [
  graphConfigSchema,
  smtpConfigSchema,
  powerAutomateConfigSchema,
  exportOnlyConfigSchema,
]);

export type MailSenderConfig = z.infer<typeof mailSenderSchema>;
export type GraphConfig = z.infer<typeof graphConfigSchema>;
export type SmtpConfig = z.infer<typeof smtpConfigSchema>;
export type PowerAutomateConfig = z.infer<typeof powerAutomateConfigSchema>;
export type ExportOnlyConfig = z.infer<typeof exportOnlyConfigSchema>;
export type MailerConfig = z.infer<typeof mailerConfigSchema>;

export type MailerConfigInput = z.input<typeof mailerConfigSchema>;

/**
 * Validates a raw object (e.g. from a UI form or env) and returns a typed config.
 * Throws ZodError with readable messages — the UI can map them to field errors.
 */
export function parseMailerConfig(raw: unknown): MailerConfig {
  return mailerConfigSchema.parse(raw);
}

/** Safe variant — returns a result object instead of throwing. */
export function safeParseMailerConfig(raw: unknown) {
  return mailerConfigSchema.safeParse(raw);
}
