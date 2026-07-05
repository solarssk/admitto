import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { writeAdminAuditLog } from "@admitto/tickets";
import { validateHttpUrl, InvalidHttpUrlError } from "@admitto/mail-templates";
import { assertEventManageAccess, adminAuditFromContext, requireEventId } from "./admin-helpers.js";

function requireParam(c: Context, name: string): string | Response {
  const val = c.req.param(name);
  if (!val) return c.json({ error: "missing_param" }, 400);
  return val;
}

async function requireEventOrgId(db: PrismaClient, eventId: string): Promise<string | null> {
  const ev = await db.event.findUnique({ where: { id: eventId }, select: { organization_id: true } });
  return ev?.organization_id ?? null;
}

// ── Pinned note ────────────────────────────────────────────────────────────

/** PATCH /api/admin/events/:eventId/note */
export async function handlePatchEventNote(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const body = await c.req.json<{ note: string | null }>();
  const note = typeof body.note === "string" ? body.note.trim() || null : null;
  const audit = adminAuditFromContext(c);

  const updated = await db.event.update({
    where: { id: eventId },
    data: { pinned_note: note },
    select: { organization_id: true },
  });

  await writeAdminAuditLog(db, {
    organizationId: updated.organization_id,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: note ? "event_pinned_note_set" : "event_pinned_note_cleared",
    metadata: { eventId },
  });

  return c.json({ ok: true });
}

// ── Key contacts ────────────────────────────────────────────────────────────

/** POST /api/admin/events/:eventId/contacts */
export async function handleCreateContact(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const body = await c.req.json<{
    name: string;
    role?: string | null;
    phone?: string | null;
    email?: string | null;
    note?: string | null;
    sort_order?: number;
  }>();

  if (!body.name?.trim()) return c.json({ error: "name_required" }, 400);

  const audit = adminAuditFromContext(c);
  const orgId = await requireEventOrgId(db, eventId);

  const contact = await db.eventContact.create({
    data: {
      event_id: eventId,
      name: body.name.trim(),
      role: body.role?.trim() || null,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      note: body.note?.trim() || null,
      sort_order: body.sort_order ?? 0,
    },
    select: { id: true, name: true, role: true, phone: true, email: true, note: true, sort_order: true },
  });

  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "event_contact_created",
    metadata: { eventId, contactId: contact.id, name: contact.name },
  });

  return c.json(contact, 201);
}

/** PUT /api/admin/events/:eventId/contacts/:contactId */
export async function handleUpdateContact(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const contactId = requireParam(c, "contactId");
  if (contactId instanceof Response) return contactId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await db.eventContact.findFirst({ where: { id: contactId, event_id: eventId } });
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{
    name?: string;
    role?: string | null;
    phone?: string | null;
    email?: string | null;
    note?: string | null;
    sort_order?: number;
  }>();

  if (body.name !== undefined && !body.name.trim()) return c.json({ error: "name_required" }, 400);

  const audit = adminAuditFromContext(c);
  const orgId = await requireEventOrgId(db, eventId);

  const contact = await db.eventContact.update({
    where: { id: contactId },
    data: {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.role !== undefined && { role: body.role?.trim() || null }),
      ...(body.phone !== undefined && { phone: body.phone?.trim() || null }),
      ...(body.email !== undefined && { email: body.email?.trim() || null }),
      ...(body.note !== undefined && { note: body.note?.trim() || null }),
      ...(body.sort_order !== undefined && { sort_order: body.sort_order }),
    },
    select: { id: true, name: true, role: true, phone: true, email: true, note: true, sort_order: true },
  });

  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "event_contact_updated",
    metadata: { eventId, contactId, name: contact.name },
  });

  return c.json(contact);
}

/** DELETE /api/admin/events/:eventId/contacts/:contactId */
export async function handleDeleteContact(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const contactId = requireParam(c, "contactId");
  if (contactId instanceof Response) return contactId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await db.eventContact.findFirst({
    where: { id: contactId, event_id: eventId },
    select: { id: true, name: true, event: { select: { organization_id: true } } },
  });
  if (!existing) return c.json({ error: "not_found" }, 404);

  const audit = adminAuditFromContext(c);

  await db.eventContact.delete({ where: { id: contactId } });

  await writeAdminAuditLog(db, {
    organizationId: existing.event.organization_id,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "event_contact_deleted",
    metadata: { eventId, contactId, name: existing.name },
  });

  return c.json({ ok: true });
}

// ── Important links & files ─────────────────────────────────────────────────

/** POST /api/admin/events/:eventId/resources */
export async function handleCreateResource(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const body = await c.req.json<{
    title: string;
    type?: "link" | "file";
    url: string;
    description?: string | null;
    sort_order?: number;
  }>();

  if (!body.title?.trim()) return c.json({ error: "title_required" }, 400);
  if (!body.url?.trim()) return c.json({ error: "url_required" }, 400);
  if (body.type && body.type !== "link" && body.type !== "file") {
    return c.json({ error: "invalid_type" }, 400);
  }
  try { validateHttpUrl("url", body.url.trim()); } catch (e) {
    if (e instanceof InvalidHttpUrlError) return c.json({ error: "invalid_url" }, 400);
    throw e;
  }

  const audit = adminAuditFromContext(c);
  const orgId = await requireEventOrgId(db, eventId);

  const resource = await db.eventResource.create({
    data: {
      event_id: eventId,
      title: body.title.trim(),
      type: body.type ?? "link",
      url: body.url.trim(),
      description: body.description?.trim() || null,
      sort_order: body.sort_order ?? 0,
    },
    select: { id: true, title: true, type: true, url: true, description: true, sort_order: true },
  });

  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "event_resource_created",
    metadata: { eventId, resourceId: resource.id, title: resource.title, type: resource.type },
  });

  return c.json(resource, 201);
}

/** PUT /api/admin/events/:eventId/resources/:resourceId */
export async function handleUpdateResource(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const resourceId = requireParam(c, "resourceId");
  if (resourceId instanceof Response) return resourceId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await db.eventResource.findFirst({ where: { id: resourceId, event_id: eventId } });
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{
    title?: string;
    type?: "link" | "file";
    url?: string;
    description?: string | null;
    sort_order?: number;
  }>();

  if (body.type && body.type !== "link" && body.type !== "file") {
    return c.json({ error: "invalid_type" }, 400);
  }
  if (body.url !== undefined) {
    try { validateHttpUrl("url", body.url.trim()); } catch (e) {
      if (e instanceof InvalidHttpUrlError) return c.json({ error: "invalid_url" }, 400);
      throw e;
    }
  }

  const audit = adminAuditFromContext(c);
  const orgId = await requireEventOrgId(db, eventId);

  const resource = await db.eventResource.update({
    where: { id: resourceId },
    data: {
      ...(body.title !== undefined && { title: body.title.trim() }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.url !== undefined && { url: body.url.trim() }),
      ...(body.description !== undefined && { description: body.description?.trim() || null }),
      ...(body.sort_order !== undefined && { sort_order: body.sort_order }),
    },
    select: { id: true, title: true, type: true, url: true, description: true, sort_order: true },
  });

  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "event_resource_updated",
    metadata: { eventId, resourceId, title: resource.title },
  });

  return c.json(resource);
}

/** DELETE /api/admin/events/:eventId/resources/:resourceId */
export async function handleDeleteResource(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const resourceId = requireParam(c, "resourceId");
  if (resourceId instanceof Response) return resourceId;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await db.eventResource.findFirst({
    where: { id: resourceId, event_id: eventId },
    select: { id: true, title: true, event: { select: { organization_id: true } } },
  });
  if (!existing) return c.json({ error: "not_found" }, 404);

  const audit = adminAuditFromContext(c);

  await db.eventResource.delete({ where: { id: resourceId } });

  await writeAdminAuditLog(db, {
    organizationId: existing.event.organization_id,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    actionType: "event_resource_deleted",
    metadata: { eventId, resourceId, title: existing.title },
  });

  return c.json({ ok: true });
}
