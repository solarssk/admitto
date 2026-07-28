import type { PrismaClient } from "@prisma/client";
import { MAX_ATTENDEE_NOTE_LENGTH } from "@admitto/db/status";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";

export { MAX_ATTENDEE_NOTE_LENGTH };

export class NoteTooLongError extends Error {
  constructor() {
    super("Note too long");
    this.name = "NoteTooLongError";
  }
}

export class OperatorRequiredError extends Error {
  constructor() {
    super("Operator required to add note");
    this.name = "OperatorRequiredError";
  }
}

export class AttendeeNotFoundError extends Error {
  constructor() {
    super("Attendee not found");
    this.name = "AttendeeNotFoundError";
  }
}

export class NoteNotFoundError extends Error {
  constructor() {
    super("Note not found");
    this.name = "NoteNotFoundError";
  }
}

export class NoteForbiddenError extends Error {
  constructor() {
    super("Not allowed to modify this note");
    this.name = "NoteForbiddenError";
  }
}

export async function addAttendeeNote(
  params: {
    attendeeId: string;
    eventId: string;
    body: string;
    audit: OpsAuditContext;
  },
  prisma: PrismaClient,
): Promise<{ id: string; created_at: Date }> {
  const body = params.body.trim();
  if (!body) throw new Error("Note body required");
  const operator = params.audit.operator;
  if (!operator) throw new OperatorRequiredError();
  if (body.length > MAX_ATTENDEE_NOTE_LENGTH) throw new NoteTooLongError();

  return prisma.$transaction(async (tx) => {
    const attendee = await tx.attendee.findFirst({
      where: { id: params.attendeeId, event_id: params.eventId },
      select: { id: true },
    });
    if (!attendee) throw new AttendeeNotFoundError();

    const note = await tx.attendeeNote.create({
      data: {
        attendee_id: params.attendeeId,
        event_id: params.eventId,
        author_user_id: operator,
        body,
      },
    });

    await writeActionLog(tx, {
      event_id: params.eventId,
      attendee_id: params.attendeeId,
      action_type: "note_added",
      audit: params.audit,
      metadata: { note_id: note.id },
    });

    return { id: note.id, created_at: note.created_at };
  });
}

/** Edits a note's body - author only, regardless of role (an admin cannot edit someone else's
 * note, only their own; see deleteAttendeeNote for the wider delete permission). Logs
 * `note_updated` with just the note id, matching note_added's minimalism - the body itself is
 * never duplicated into AttendeeActionLog.metadata (DATA-PROTECTION.md: a note can carry Art. 9
 * special-category data, so it must not be copied into a second table with its own retention/
 * erasure story). */
export async function updateAttendeeNote(
  params: {
    attendeeId: string;
    eventId: string;
    noteId: string;
    body: string;
    audit: OpsAuditContext;
  },
  prisma: PrismaClient,
): Promise<{ id: string; body: string; created_at: Date }> {
  const body = params.body.trim();
  if (!body) throw new Error("Note body required");
  const operator = params.audit.operator;
  if (!operator) throw new OperatorRequiredError();
  if (body.length > MAX_ATTENDEE_NOTE_LENGTH) throw new NoteTooLongError();

  return prisma.$transaction(async (tx) => {
    const note = await tx.attendeeNote.findFirst({
      where: { id: params.noteId, attendee_id: params.attendeeId, event_id: params.eventId },
      select: { id: true, author_user_id: true },
    });
    if (!note) throw new NoteNotFoundError();
    if (note.author_user_id !== operator) throw new NoteForbiddenError();

    const updated = await tx.attendeeNote.update({ where: { id: note.id }, data: { body } });

    await writeActionLog(tx, {
      event_id: params.eventId,
      attendee_id: params.attendeeId,
      action_type: "note_updated",
      audit: params.audit,
      metadata: { note_id: note.id },
    });

    return { id: updated.id, body: updated.body, created_at: updated.created_at };
  });
}

/** Deletes a note. `canDeleteAnyNote` is resolved by the caller (attendees-api-routes.ts, which
 * already has the RBAC context to know actor/author roles): true for a superadmin (deletes
 * anyone's note) or an admin deleting an operator's note; false otherwise, in which case only
 * the note's own author may delete it. Logs `note_deleted` with the note id and its
 * author_user_id (accountability for "who deleted whose note"), never the body - same
 * data-minimisation reasoning as updateAttendeeNote above. */
export async function deleteAttendeeNote(
  params: {
    attendeeId: string;
    eventId: string;
    noteId: string;
    canDeleteAnyNote: boolean;
    audit: OpsAuditContext;
  },
  prisma: PrismaClient,
): Promise<void> {
  const operator = params.audit.operator;
  if (!operator) throw new OperatorRequiredError();

  await prisma.$transaction(async (tx) => {
    const note = await tx.attendeeNote.findFirst({
      where: { id: params.noteId, attendee_id: params.attendeeId, event_id: params.eventId },
      select: { id: true, author_user_id: true },
    });
    if (!note) throw new NoteNotFoundError();
    if (note.author_user_id !== operator && !params.canDeleteAnyNote) throw new NoteForbiddenError();

    await tx.attendeeNote.delete({ where: { id: note.id } });

    await writeActionLog(tx, {
      event_id: params.eventId,
      attendee_id: params.attendeeId,
      action_type: "note_deleted",
      audit: params.audit,
      metadata: { note_id: note.id, author_user_id: note.author_user_id },
    });
  });
}
