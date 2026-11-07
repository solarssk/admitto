/**
 * The publication gate of guest registration (D-F2). An event may have registration on only while
 * its privacy notice, its terms and every extra consent it asks for are published. The same list
 * answers three questions:
 *
 * - May registration be turned on, or a consent added while it is on? The save of the event's registration
 *   settings (PR 99a, admin/event-registration-settings.ts) takes the lock and reads the texts with
 *   {@link lockAndLoadLegalGateRows} inside the transaction that writes them, and judges them with
 *   {@link evaluateLegalGate} for the consent keys it is about to save. It reports what is missing as one
 *   blocker among the others of the readiness list, so it does not use the guard's own answer below.
 * - Is the public form open? The form (94b) and the submit route (95c) call
 *   {@link loadRequiredLegalDocuments} and treat a non-empty `missing` as closed, whatever the
 *   settings say, so a text that is withdrawn later closes the form instead of leaving it open.
 * - May this text be withdrawn? Unpublishing or deleting a text that registration needs is refused
 *   while registration is on ({@link registrationNeedsLegalDocument}).
 *
 * The first and the third must not interleave: both read the texts and the settings, and each is
 * correct only if the other has finished. They serialise on {@link acquireEventLegalDocumentsLock}.
 * The guard and {@link lockAndLoadLegalGateRows} take that lock themselves, which is why they take a
 * transaction: a transaction that writes `mode` (or `consent_keys` while `mode` is set) goes through one
 * of them before the write.
 */
import type { Context } from "hono";
import { Prisma, type LegalDocumentKind, type PrismaClient } from "@admitto/db";
import { legalDocumentRef, requiredLegalDocuments, type LegalDocumentRef } from "./legal-documents.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** A published text, as a form needs it. */
export type PublishedLegalDocument = LegalDocumentRef & { title: string };

export type RequiredLegalDocuments = {
  /** The required texts that are published, in the order of `requiredLegalDocuments`. */
  published: PublishedLegalDocument[];
  /** The required texts that are not published: they do not exist, or they are drafts. */
  missing: LegalDocumentRef[];
};

/** What the gate needs to know about a stored text. */
export type LegalGateRow = { kind: string; key: string; title: string; published_at: Date | null };

function rowId(doc: { kind: string; key: string }): string {
  return `${doc.kind}:${doc.key}`;
}

/** The gate over texts that are already loaded (no query). */
export function evaluateLegalGate(rows: readonly LegalGateRow[], consentKeys: readonly string[]): RequiredLegalDocuments {
  const published = new Map(
    rows.filter((row) => row.published_at !== null).map((row): [string, string] => [rowId(row), row.title]),
  );
  const result: RequiredLegalDocuments = { published: [], missing: [] };
  for (const doc of requiredLegalDocuments(consentKeys)) {
    const title = published.get(rowId(doc));
    if (title === undefined) result.missing.push(doc);
    else result.published.push({ ...doc, title });
  }
  return result;
}

/** The texts an event has, with what the gate needs to know about each and none of the content. */
export function loadLegalGateRows(db: DbClient, eventId: string): Promise<LegalGateRow[]> {
  // At most 2 + MAX_CONSENT_DOCUMENTS_PER_EVENT rows, and no content.
  return db.legalDocument.findMany({
    where: { event_id: eventId },
    select: { kind: true, key: true, title: true, published_at: true },
  });
}

/** The gate for an event: which of the texts its registration needs are published and which are not.
 * `consentKeys` are the extra consents the event asks for (`EventRegistrationSettings.consent_keys`). */
export async function loadRequiredLegalDocuments(
  db: DbClient,
  eventId: string,
  consentKeys: readonly string[],
): Promise<RequiredLegalDocuments> {
  return evaluateLegalGate(await loadLegalGateRows(db, eventId), consentKeys);
}

/** The keys of the extra consents the event has published: the ones its registration may ask for. */
export function publishedConsentKeys(rows: readonly LegalGateRow[]): string[] {
  return rows.filter((row) => row.kind === "consent" && row.published_at !== null).map((row) => row.key);
}

/**
 * Takes the event's lock (held until the transaction ends) and reads its texts under it, so that no text can be
 * withdrawn between this read and the commit of the transaction that relies on it. Writes nothing.
 */
export async function lockAndLoadLegalGateRows(tx: Prisma.TransactionClient, eventId: string): Promise<LegalGateRow[]> {
  await acquireEventLegalDocumentsLock(tx, eventId);
  return loadLegalGateRows(tx, eventId);
}

/** The shape of a missing text in an answer: the ref that names it, its kind and its consent key. */
export function legalDocumentRefDto(doc: LegalDocumentRef): { ref: string; kind: LegalDocumentKind; key: string | null } {
  return { ref: legalDocumentRef(doc), kind: doc.kind, key: doc.key === "" ? null : doc.key };
}

/**
 * Null when the event may have registration on, otherwise the answer to send:
 * `409 { error: "legal_documents_missing", missing: [{ ref, kind, key }] }`. Call it in the
 * transaction that saves the settings, before the write: it takes the event's lock (held until that
 * transaction ends), so no text can be withdrawn between this check and the commit. Writes nothing.
 */
export async function guardRegistrationLegalGate(
  c: Context,
  tx: Prisma.TransactionClient,
  eventId: string,
  consentKeys: readonly string[],
): Promise<Response | null> {
  const { missing } = evaluateLegalGate(await lockAndLoadLegalGateRows(tx, eventId), consentKeys);
  if (missing.length === 0) return null;
  return c.json({ error: "legal_documents_missing", missing: missing.map(legalDocumentRefDto) }, 409);
}

/** True while the event's registration is on and needs this text. A text registration does not ask
 * for (an extra consent that is not in `consent_keys`, or any text while registration is off) can be
 * withdrawn freely. */
export async function registrationNeedsLegalDocument(
  db: DbClient,
  eventId: string,
  doc: LegalDocumentRef,
): Promise<boolean> {
  const settings = await db.eventRegistrationSettings.findUnique({
    where: { event_id: eventId },
    select: { mode: true, consent_keys: true },
  });
  if (!settings || settings.mode === null) return false;
  return requiredLegalDocuments(settings.consent_keys).some((required) => rowId(required) === rowId(doc));
}

/** Serialises everything that publishes, withdraws or deletes an event's legal texts, and (through
 * guardRegistrationLegalGate) the transaction that turns registration on. Held until the transaction
 * ends. */
export async function acquireEventLegalDocumentsLock(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const lockKey = `event-legal-documents:${eventId}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}
