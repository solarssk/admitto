import type { PrismaClient } from "@admitto/db";
import {
  describeMailConfig,
  type ConfigDescriptor,
  type FieldDescriptor,
  type FieldSource,
} from "@admitto/mailer-config";

const SECRET_FIELD_KEYS = [
  "smtpPassword",
  "graphClientSecret",
  "powerAutomateUrl",
  "powerAutomateKey",
] as const satisfies readonly (keyof ConfigDescriptor)[];

export interface SecretPresenceField {
  /** True when a secret is configured at env/event/org (value is never emitted). */
  configured: boolean;
  source: FieldSource;
  locked: boolean;
}

export type CliConfigDescriptor = {
  [K in keyof ConfigDescriptor]: K extends (typeof SECRET_FIELD_KEYS)[number]
    ? SecretPresenceField
    : ConfigDescriptor[K];
};

/** Map a masked secret field to CLI-safe presence metadata (no value). */
function secretPresenceField(field: FieldDescriptor<"••••" | null>): SecretPresenceField {
  return {
    // Presence only — never read field.value (CodeQL / no secret material in CLI output).
    configured: field.source !== "default",
    source: field.source,
    locked: field.locked,
  };
}

/**
 * JSON-safe config for terminal output. Secret fields expose presence/source only.
 */
export function serializeConfigDescriptionForCli(desc: ConfigDescriptor): string {
  const out: Record<string, FieldDescriptor | SecretPresenceField> = {};

  for (const key of Object.keys(desc) as (keyof ConfigDescriptor)[]) {
    const field = Object.getOwnPropertyDescriptor(desc, key)?.value;
    if (!field) continue;
    const value = (SECRET_FIELD_KEYS as readonly string[]).includes(key as string)
      ? secretPresenceField(field as FieldDescriptor<"••••" | null>)
      : (field as FieldDescriptor);
    Object.defineProperty(out, key, { value, enumerable: true, configurable: true, writable: true });
  }

  return JSON.stringify(out, null, 2);
}

/**
 * Read-only masked mail config for an event (secrets never decrypted).
 * Thin passthrough for future admin UI — same semantics as describeMailConfig.
 */
export async function getMailConfigDescription(
  eventId: string,
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConfigDescriptor> {
  return describeMailConfig(eventId, prisma, env);
}
