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

const ROW_BATCH_SIZE = 10;

/** Runs `fn` over `items` in sequential batches (at most `size` at once), keeping order; recursion, not a loop, so no await sits inside one. */
async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const head = await Promise.all(items.slice(0, size).map(fn));
  return [...head, ...(await inBatches(items.slice(size), size, fn))];
}

type RowOutcome = "rewritten" | "alreadyBound" | "failed";

async function rebindRow(prisma: PrismaClient, column: Column, row: Row, dryRun: boolean): Promise<RowOutcome> {
  try {
    const { value, changed } = rebindToContext(row.value, column.context);
    if (!changed) return "alreadyBound";
    // A row rotated since it was read already holds a bound value: nothing to rewrite.
    if (!dryRun && (await column.write(prisma, row.id, row.value, value)).count === 0) return "alreadyBound";
    return "rewritten";
  } catch {
    return "failed";
  }
}

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
  return inBatches(COLUMNS, 1, async (column): Promise<RebindResult> => {
    const outcomes = await inBatches(await column.read(prisma), ROW_BATCH_SIZE, (row) => rebindRow(prisma, column, row, dryRun));
    const count = (outcome: RowOutcome) => outcomes.filter((o) => o === outcome).length;
    return { column: column.name, rewritten: count("rewritten"), alreadyBound: count("alreadyBound"), failed: count("failed") };
  });
}
