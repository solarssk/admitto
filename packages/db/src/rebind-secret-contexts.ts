import { rebindToContext, SECRET_CONTEXTS } from "@admitto/crypto";
import type { PrismaClient } from "./generated/prisma/client.js";

export type RebindResult = { column: string; rewritten: number; alreadyBound: number; failed: number };

type Row = { id: string; value: string };
type Column = {
  name: string;
  context: string;
  read: (prisma: PrismaClient) => Promise<Row[]>;
  // Conditional on the column still holding `from`, so a rotation saved meanwhile is never overwritten.
  write: (prisma: PrismaClient, id: string, from: string, to: string) => Promise<{ count: number }>;
};

const mailColumn = (
  key: "smtpPassword" | "graphClientSecret" | "powerAutomateKey" | "powerAutomateUrl",
  col: "smtp_password_enc" | "graph_client_secret_enc" | "power_automate_key_enc" | "power_automate_url_enc",
): Column => ({
  name: `MailSettings.${col}`,
  // key is one of four literal names, never caller input.
  // eslint-disable-next-line security/detect-object-injection
  context: SECRET_CONTEXTS[key],
  read: async (prisma) => {
    const rows: Array<Record<string, unknown>> = await prisma.mailSettings.findMany({ where: { [col]: { not: null } } });
    // col is one of four literal column names, never caller input.
    // eslint-disable-next-line security/detect-object-injection
    return rows.map((r) => ({ id: String(r["id"]), value: String(r[col]) }));
  },
  write: (prisma, id, from, to) =>
    prisma.mailSettings.updateMany({ where: { id, [col]: from }, data: { [col]: to } }),
});

const COLUMNS: Column[] = [
  mailColumn("smtpPassword", "smtp_password_enc"),
  mailColumn("graphClientSecret", "graph_client_secret_enc"),
  mailColumn("powerAutomateKey", "power_automate_key_enc"),
  mailColumn("powerAutomateUrl", "power_automate_url_enc"),
  {
    name: "Event.wallet_api_key_enc",
    context: SECRET_CONTEXTS.walletApiKey,
    // The queries below exclude null, so the cast only narrows the type.
    read: async (prisma) =>
      (await prisma.event.findMany({ where: { wallet_api_key_enc: { not: null } }, select: { id: true, wallet_api_key_enc: true } }))
        .map((r) => ({ id: r.id, value: r.wallet_api_key_enc as string })),
    write: (prisma, id, from, to) =>
      prisma.event.updateMany({ where: { id, wallet_api_key_enc: from }, data: { wallet_api_key_enc: to } }),
  },
  {
    name: "BounceIngestSettings.imap_password_enc",
    context: SECRET_CONTEXTS.imapPassword,
    read: async (prisma) =>
      (await prisma.bounceIngestSettings.findMany({ where: { imap_password_enc: { not: null } }, select: { id: true, imap_password_enc: true } }))
        .map((r) => ({ id: r.id, value: r.imap_password_enc as string })),
    write: (prisma, id, from, to) =>
      prisma.bounceIngestSettings.updateMany({ where: { id, imap_password_enc: from }, data: { imap_password_enc: to } }),
  },
  {
    name: "NotificationSettings.webhook_url_enc",
    context: SECRET_CONTEXTS.notificationWebhookUrl,
    read: async (prisma) =>
      (await prisma.notificationSettings.findMany({ where: { webhook_url_enc: { not: null } }, select: { id: true, webhook_url_enc: true } }))
        .map((r) => ({ id: r.id, value: r.webhook_url_enc as string })),
    write: (prisma, id, from, to) =>
      prisma.notificationSettings.updateMany({ where: { id, webhook_url_enc: from }, data: { webhook_url_enc: to } }),
  },
];

/**
 * Rewrites legacy (keyVersion 1) secret columns as context-bound (keyVersion 2) values, so a
 * ciphertext copied into another column no longer decrypts there. Manual ops step, never part of
 * `db:migrate`: it is not reversible (a build older than the context-bound writers cannot read
 * keyVersion 2). Idempotent; a value that cannot be decrypted is counted as failed and left
 * untouched. `Attendee.token_enc`, the weather API key and TOTP/IdP secrets are not covered.
 */
export async function rebindSecretContexts(
  prisma: PrismaClient,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<RebindResult[]> {
  const results: RebindResult[] = [];
  for (const column of COLUMNS) {
    const result: RebindResult = { column: column.name, rewritten: 0, alreadyBound: 0, failed: 0 };
    for (const row of await column.read(prisma)) {
      try {
        const { value, changed } = rebindToContext(row.value, column.context);
        // A row rotated since it was read already holds a bound value: nothing to rewrite.
        const written = changed && !dryRun ? (await column.write(prisma, row.id, row.value, value)).count : 1;
        if (changed && written > 0) result.rewritten += 1;
        else result.alreadyBound += 1;
      } catch {
        result.failed += 1;
      }
    }
    results.push(result);
  }
  return results;
}
