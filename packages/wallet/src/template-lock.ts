import { Prisma } from "@admitto/db";

/** Stable Postgres advisory-lock key serializing wallet-pass issuance against an admin's Template
 * ID change, for one event. Without it, the "any pass issued yet" recheck each side does and the
 * write that follows it (the admin's own event.update, or issuance's own WalletPass persist) are
 * two separate, unsynchronized database operations - a request on the other side can still land in
 * the gap between them, letting a pass get created under a template Admitto no longer records
 * using anywhere (CodeRabbit review). */
export function walletTemplateLockKey(eventId: string): string {
  return `event-wallet-template:${eventId}`;
}

/** Acquire as the very first statement inside the transaction that does the recheck + write, on
 * both sides of the race (event-settings-routes.ts's own event.update transaction, and
 * app.ts's markActive) - whichever request starts first then fully commits before the other
 * side's own recheck can run, so it always sees that commit's result rather than stale state. */
export async function acquireWalletTemplateLock(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${walletTemplateLockKey(eventId)}))`);
}
