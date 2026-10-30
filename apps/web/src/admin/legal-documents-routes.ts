/**
 * Organiser API for the legal texts of one event (D-F2): the privacy notice, the terms and the extra
 * consents. Every route is under `/api/admin/events/:eventId/legal-documents`, and every one checks
 * on the server that the caller manages that event (an organisation admin or a superadmin, like the
 * other event routes); an operator gets 403. The routes that change anything are also refused for an
 * archived event.
 *
 * A text is named by its ref (`privacy-notice`, `event-terms`, `consent-<key>`, see
 * legal/legal-documents.ts). There is one current text per ref and no history (D-F1): saving
 * replaces it, and a published text changes on its public page at once. Publishing is a separate
 * step, so a text can be written and read through before a guest can see it.
 *
 * The HTML is cleaned here, on save (legal/sanitize-legal-html.ts), and the cleaned HTML is what
 * every answer returns, so an editor can show what was kept. Audit entries carry the event, the
 * kind and the key, never the text.
 */
import type { Context } from "hono";
import { z } from "zod";
import { Prisma, LEGAL_DOCUMENT_KIND, type LegalDocumentKind, type PrismaClient } from "@admitto/db";
import { writeAdminAuditLog, type OpsAuditContext } from "@admitto/tickets";
import { assertEventManageAccess, requireAuditActor, requireEventId } from "./admin-helpers.js";
import {
  MAX_CONSENT_DOCUMENTS_PER_EVENT,
  MAX_LEGAL_CONTENT_CHARS,
  MAX_LEGAL_TITLE_CHARS,
  legalDocumentPath,
  legalDocumentRef,
  normalizeLegalTitle,
  parseLegalDocumentRef,
  type LegalDocumentRef,
} from "../legal/legal-documents.js";
import {
  acquireEventLegalDocumentsLock,
  evaluateLegalGate,
  legalDocumentRefDto,
  registrationNeedsLegalDocument,
} from "../legal/registration-gate.js";
import { legalHtmlHasVisibleText, sanitizeLegalHtml } from "../legal/sanitize-legal-html.js";

/** Admin API shape of one legal text, without its HTML. */
export type LegalDocumentDto = {
  id: string;
  /** Names the text in URLs: `privacy-notice`, `event-terms` or `consent-<key>`. */
  ref: string;
  kind: LegalDocumentKind;
  /** The consent key; null for the privacy notice and the terms. */
  key: string | null;
  title: string;
  published: boolean;
  published_at: string | null;
  updated_at: string;
  /** The page a guest reads. It answers 404 until the text is published. */
  public_path: string;
  /** True for the privacy notice, the terms, and a consent the event asks for (`consent_keys`). */
  required: boolean;
};

export type LegalDocumentWithContentDto = LegalDocumentDto & {
  /** The cleaned HTML, which can differ from what was sent. */
  content_html: string;
};

/** Read from `GET …/legal-documents`: the limits an editor should respect before it sends a text. */
export type LegalDocumentLimitsDto = { title_chars: number; content_chars: number; consents: number };

type StoredSummary = { id: string; kind: string; key: string; title: string; published_at: Date | null; updated_at: Date };
type StoredDocument = StoredSummary & { content_html: string };

const SUMMARY_SELECT = {
  id: true,
  kind: true,
  key: true,
  title: true,
  published_at: true,
  updated_at: true,
} as const;

const AUDIT_ACTION = {
  saved: "legal_document_saved",
  published: "legal_document_published",
  unpublished: "legal_document_unpublished",
  deleted: "legal_document_deleted",
} as const;

const saveBodySchema = z
  .object({
    title: z.string().max(MAX_LEGAL_TITLE_CHARS),
    content_html: z.string().max(MAX_LEGAL_CONTENT_CHARS),
  })
  .strict();

/** What the routes need to know about the event around a text. */
type EventLegalContext = { organizationId: string; slug: string; consentKeys: string[] };

async function loadEventLegalContext(db: PrismaClient, eventId: string): Promise<EventLegalContext | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { organization_id: true, slug: true, registration_settings: { select: { consent_keys: true } } },
  });
  if (!event) return null;
  return {
    organizationId: event.organization_id,
    slug: event.slug,
    consentKeys: event.registration_settings?.consent_keys ?? [],
  };
}

function uniqueKey(eventId: string, doc: LegalDocumentRef) {
  return { event_id_kind_key: { event_id: eventId, kind: doc.kind, key: doc.key } };
}

function serialize(row: StoredSummary, ctx: EventLegalContext): LegalDocumentDto {
  const doc: LegalDocumentRef = { kind: row.kind as LegalDocumentKind, key: row.key };
  return {
    id: row.id,
    ref: legalDocumentRef(doc),
    kind: doc.kind,
    key: row.key === "" ? null : row.key,
    title: row.title,
    published: row.published_at !== null,
    published_at: row.published_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
    public_path: legalDocumentPath(ctx.slug, doc),
    required: doc.kind !== "consent" || ctx.consentKeys.includes(row.key),
  };
}

function serializeWithContent(row: StoredDocument, ctx: EventLegalContext): LegalDocumentWithContentDto {
  return { ...serialize(row, ctx), content_html: row.content_html };
}

/** The privacy notice, then the terms, then the consents by key. */
function compareDocuments(a: StoredSummary, b: StoredSummary): number {
  const byKind =
    LEGAL_DOCUMENT_KIND.indexOf(a.kind as LegalDocumentKind) - LEGAL_DOCUMENT_KIND.indexOf(b.kind as LegalDocumentKind);
  return byKind !== 0 ? byKind : a.key.localeCompare(b.key);
}

/** The event and the text a request names, after the access check; or the answer to send. */
type Target = { eventId: string; doc: LegalDocumentRef; ctx: EventLegalContext };

type Actor = OpsAuditContext & { operator: string };

async function resolveTarget(c: Context, db: PrismaClient): Promise<Target | Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;
  const doc = parseLegalDocumentRef(c.req.param("ref") ?? "");
  if (!doc) return c.json({ error: "not_found" }, 404);
  const ctx = await loadEventLegalContext(db, eventId);
  if (!ctx) return c.json({ error: "not_found" }, 404);
  return { eventId, doc, ctx };
}

async function writeLegalAudit(
  tx: Prisma.TransactionClient,
  target: Target,
  actor: Actor,
  actionType: (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION],
): Promise<void> {
  await writeAdminAuditLog(tx, {
    organizationId: target.ctx.organizationId,
    actorUserId: actor.operator,
    sessionId: actor.sessionId,
    ip: actor.ip,
    timezone: actor.timezone,
    actionType,
    metadata: { eventId: target.eventId, kind: target.doc.kind, key: target.doc.key },
  });
}

/** The text a write names and who writes it, after the access check; or the answer to send. */
async function resolveWriteTarget(c: Context, db: PrismaClient): Promise<{ target: Target; actor: Actor } | Response> {
  const target = await resolveTarget(c, db);
  if (target instanceof Response) return target;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;
  return { target, actor };
}

/** Runs `change` in a transaction that holds the event's lock, with the stored text (null when there is
 * none) read under it. Everything that publishes, withdraws, saves or deletes goes through here. */
function runLocked<T>(
  db: PrismaClient,
  target: Target,
  change: (tx: Prisma.TransactionClient, existing: StoredDocument | null) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await acquireEventLegalDocumentsLock(tx, target.eventId);
    const existing = await tx.legalDocument.findUnique({ where: uniqueKey(target.eventId, target.doc) });
    return change(tx, existing);
  });
}

/** 409 for a text that registration needs while registration is on. */
function inUse(c: Context): Response {
  return c.json({ error: "legal_document_in_use" }, 409);
}

/** GET /api/admin/events/:eventId/legal-documents */
export async function handleListLegalDocuments(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;
  const ctx = await loadEventLegalContext(db, eventId);
  if (!ctx) return c.json({ error: "not_found" }, 404);

  const rows = await db.legalDocument.findMany({ where: { event_id: eventId }, select: SUMMARY_SELECT });
  const limits: LegalDocumentLimitsDto = {
    title_chars: MAX_LEGAL_TITLE_CHARS,
    content_chars: MAX_LEGAL_CONTENT_CHARS,
    consents: MAX_CONSENT_DOCUMENTS_PER_EVENT,
  };
  return c.json({
    items: rows.sort(compareDocuments).map((row) => serialize(row, ctx)),
    // What registration still lacks before it can be turned on (see legal/registration-gate.ts).
    missing: evaluateLegalGate(rows, ctx.consentKeys).missing.map(legalDocumentRefDto),
    limits,
  });
}

/** GET /api/admin/events/:eventId/legal-documents/:ref */
export async function handleGetLegalDocument(c: Context, db: PrismaClient): Promise<Response> {
  const target = await resolveTarget(c, db);
  if (target instanceof Response) return target;
  const row = await db.legalDocument.findUnique({ where: uniqueKey(target.eventId, target.doc) });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(serializeWithContent(row, target.ctx));
}

type SaveOutcome = { kind: "limit_reached" } | { kind: "saved"; row: StoredDocument; created: boolean };

/** The body of a save, checked and cleaned; or the answer to send when it cannot be saved. */
async function readSaveBody(c: Context): Promise<{ title: string; contentHtml: string } | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = saveBodySchema.safeParse(body);
  const title = parsed.success ? normalizeLegalTitle(parsed.data.title) : "";
  if (!parsed.success || title === "") return c.json({ error: "validation_failed" }, 400);

  const contentHtml = sanitizeLegalHtml(parsed.data.content_html);
  if (contentHtml === null) return c.json({ error: "legal_document_unsupported" }, 422);
  if (!legalHtmlHasVisibleText(contentHtml)) return c.json({ error: "legal_document_empty" }, 422);
  return { title, contentHtml };
}

/** PUT /api/admin/events/:eventId/legal-documents/:ref
 *  Body `{ title, content_html }`. Creates the text or replaces it; publication is not touched. */
export async function handlePutLegalDocument(c: Context, db: PrismaClient): Promise<Response> {
  const write = await resolveWriteTarget(c, db);
  if (write instanceof Response) return write;
  const { target, actor } = write;
  const body = await readSaveBody(c);
  if (body instanceof Response) return body;

  try {
    const outcome = await runLocked(db, target, async (tx, existing): Promise<SaveOutcome> => {
      if (!existing && target.doc.kind === "consent") {
        const consents = await tx.legalDocument.count({ where: { event_id: target.eventId, kind: "consent" } });
        if (consents >= MAX_CONSENT_DOCUMENTS_PER_EVENT) return { kind: "limit_reached" };
      }
      const row = await tx.legalDocument.upsert({
        where: uniqueKey(target.eventId, target.doc),
        create: {
          event_id: target.eventId,
          kind: target.doc.kind,
          key: target.doc.key,
          title: body.title,
          content_html: body.contentHtml,
          updated_by: actor.operator,
        },
        update: { title: body.title, content_html: body.contentHtml, updated_by: actor.operator },
      });
      await writeLegalAudit(tx, target, actor, AUDIT_ACTION.saved);
      return { kind: "saved", row, created: existing === null };
    });
    if (outcome.kind === "limit_reached") return c.json({ error: "legal_document_limit_reached" }, 422);
    return c.json(serializeWithContent(outcome.row, target.ctx), outcome.created ? 201 : 200);
  } catch (err) {
    // The event was deleted between the access check and the write.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return c.json({ error: "not_found" }, 404);
    }
    throw err;
  }
}

/** POST /api/admin/events/:eventId/legal-documents/:ref/publish
 *  Idempotent: a text that is already published keeps its publication date. */
export async function handlePublishLegalDocument(c: Context, db: PrismaClient): Promise<Response> {
  const write = await resolveWriteTarget(c, db);
  if (write instanceof Response) return write;
  const { target, actor } = write;

  const row = await runLocked(db, target, async (tx, existing) => {
    if (existing?.published_at !== null) return existing;
    const published = await tx.legalDocument.update({
      where: { id: existing.id },
      data: { published_at: new Date(), updated_by: actor.operator },
    });
    await writeLegalAudit(tx, target, actor, AUDIT_ACTION.published);
    return published;
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(serialize(row, target.ctx));
}

/** POST /api/admin/events/:eventId/legal-documents/:ref/unpublish
 *  Idempotent. Refused (409 `legal_document_in_use`) while registration is on and needs the text. */
export async function handleUnpublishLegalDocument(c: Context, db: PrismaClient): Promise<Response> {
  const write = await resolveWriteTarget(c, db);
  if (write instanceof Response) return write;
  const { target, actor } = write;

  const outcome = await runLocked(db, target, async (tx, existing) => {
    if (!existing?.published_at) return { kind: "done" as const, row: existing };
    if (await registrationNeedsLegalDocument(tx, target.eventId, target.doc)) return { kind: "in_use" as const };
    const draft = await tx.legalDocument.update({
      where: { id: existing.id },
      data: { published_at: null, updated_by: actor.operator },
    });
    await writeLegalAudit(tx, target, actor, AUDIT_ACTION.unpublished);
    return { kind: "done" as const, row: draft };
  });
  if (outcome.kind === "in_use") return inUse(c);
  if (!outcome.row) return c.json({ error: "not_found" }, 404);
  return c.json(serialize(outcome.row, target.ctx));
}

/** DELETE /api/admin/events/:eventId/legal-documents/:ref
 *  Refused (409 `legal_document_in_use`) while registration is on and needs the text. */
export async function handleDeleteLegalDocument(c: Context, db: PrismaClient): Promise<Response> {
  const write = await resolveWriteTarget(c, db);
  if (write instanceof Response) return write;
  const { target, actor } = write;

  const outcome = await runLocked(db, target, async (tx, existing) => {
    if (!existing) return "not_found" as const;
    if (await registrationNeedsLegalDocument(tx, target.eventId, target.doc)) return "in_use" as const;
    await tx.legalDocument.delete({ where: { id: existing.id } });
    await writeLegalAudit(tx, target, actor, AUDIT_ACTION.deleted);
    return "deleted" as const;
  });
  if (outcome === "in_use") return inUse(c);
  if (outcome === "not_found") return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
}
