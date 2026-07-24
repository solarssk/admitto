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
