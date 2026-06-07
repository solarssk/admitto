import { z } from "zod";

/**
 * Mailer configuration schemas. Discriminated union on `provider` —
 * the same shape is used by the UI Settings form and the backend,
 * making this the single source of validation truth.
 */

export const graphConfigSchema = z.object({
  provider: z.literal("graph"),
  /** Tenant GUID or directory domain name. */
  tenantId: z.string().min(1, "tenantId is required"),
  clientId: z.string().min(1, "clientId is required"),
  clientSecret: z.string().min(1, "clientSecret is required"),
  /** Mailbox to send from (e.g. events@your-domain.com). Uses Application Access Policy for send-as. */
  sender: z.string().email("sender must be a valid email address"),
  saveToSentItems: z.boolean().default(true),
});

export const smtpConfigSchema = z.object({
  provider: z.literal("smtp"),
  host: z.string().min(1),
  port: z.number().int().positive().default(587),
  /** false => STARTTLS (port 587), true => TLS (port 465). */
  secure: z.boolean().default(false),
  user: z.string().min(1),
  password: z.string().min(1),
  /** Address in the From field (can be a shared mailbox with send-as). */
  from: z.string().email("from must be a valid email address"),
});

export const powerAutomateConfigSchema = z.object({
  provider: z.literal("powerautomate"),
  /** HTTP flow trigger URL (secret — contains sig token). */
  url: z.string().url("url must be a valid flow URL"),
  /** Optional key sent in x-admitto-key header (endpoint protection). */
  key: z.string().optional(),
});

export const mailerConfigSchema = z.discriminatedUnion("provider", [
  graphConfigSchema,
  smtpConfigSchema,
  powerAutomateConfigSchema,
]);

export type GraphConfig = z.infer<typeof graphConfigSchema>;
export type SmtpConfig = z.infer<typeof smtpConfigSchema>;
export type PowerAutomateConfig = z.infer<typeof powerAutomateConfigSchema>;
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
