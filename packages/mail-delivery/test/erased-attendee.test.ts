/**
 * Mail for an erased attendee: nothing is queued for them, a send that races an erasure waits for
 * it and then queues nothing, and a mail that was already in flight does not write its outcome (a
 * provider message id, an error naming the address) back onto the emptied delivery.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { encryptToString } from "@admitto/crypto";
import { eraseAttendees, generateToken, hashToken, lockAttendeesForUpdate } from "@admitto/tickets";
import {
  claimInitialDelivery,
  createResendDelivery,
  drainPendingDeliveries,
  recordTicketViewed,
  retryDelivery,
  sendTicketEmails,
  type ClaimResult,
} from "../src/index.js";
import { applyBounceResult } from "../src/bounceIngest/applyBounceResult.js";
import { deliverPendingBatch } from "../src/send.js";
import { readDeliveriesBeforeSend } from "../src/sendable.js";
import type { MailerAdapter, MailMessage, SendResult } from "@admitto/mailer";
import { resetDb } from "./resetDb.js";
import { seedOrgAndEvent } from "./seedOrgAndEvent.js";

const prisma = createTestPrismaClient();
const ORG_ID = "org-mail-erased";
const EVENT_ID = "evt-mail-erased";
const ENV = { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" };
let seq = 0;

beforeAll(async () => {
  await resetDb();
  await seedOrgAndEvent(prisma, {
    orgId: ORG_ID,
    orgName: "Mail Erased Org",
    orgSlug: "mail-erased-org",
    eventId: EVENT_ID,
    eventTitle: "Mail Erased Event",
    eventSlug: "mail-erased-event",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createAttendee() {
  const n = ++seq;
  return prisma.attendee.create({
    data: {
      id: `mail-erased-att-${n}`,
      event_id: EVENT_ID,
      email: `mail${n}@example.com`,
      name: `Mail Person ${n}`,
      public_ref: generateToken(),
    },
  });
}

const erase = (ids: string[]) => prisma.$transaction((tx) => eraseAttendees(tx, { eventId: EVENT_ID, attendeeIds: ids }));

async function holdErasure(ids: string[], eventId = EVENT_ID) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let written!: () => void;
  const writtenPromise = new Promise<void>((resolve) => (written = resolve));
  const transaction = prisma.$transaction(async (tx) => {
    await eraseAttendees(tx, { eventId, attendeeIds: ids });
    written();
    await gate;
  });
  await writtenPromise;
  return { commit: () => (release(), transaction) };
}

async function staysPending(promise: Promise<unknown>, ms = 300): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return !settled;
}

const claimInput = (attendeeId: string) => ({
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  attendeeId,
  batchId: `batch-${attendeeId}`,
  hasWalletCta: false,
  provider: "export_only",
  recipientEmail: "someone@example.com",
  renderedSubject: "Your ticket",
  renderedHtml: "<p>Hello Someone</p>",
});

const deliveriesOf = (attendeeId: string) => prisma.emailDelivery.findMany({ where: { attendee_id: attendeeId } });

/** A claimed, queued delivery of `attendee`, addressed to `recipientEmail` (the resend override) when given. */
async function claimedFor(attendee: { id: string }, recipientEmail?: string) {
  const claim = await claimInitialDelivery({ ...claimInput(attendee.id), ...(recipientEmail ? { recipientEmail } : {}) }, prisma);
  if (claim.action !== "send") throw new Error("expected a claim");
  return claim;
}

/** What a synchronous batch holds for a claimed delivery: the frozen message and its address. */
async function pendingFor(attendee: { id: string }, recipientEmail?: string) {
  const claim = await claimedFor(attendee, recipientEmail);
  return {
    deliveryId: claim.deliveryId,
    attendeeId: attendee.id,
    to: claim.message.to,
    frozenSubject: claim.message.subject,
    frozenHtml: claim.message.html,
    links: { ticket_url: "https://tickets.example.com/t/abc", qr_image_url: "https://tickets.example.com/q/abc.png" },
    idempotencyKey: `${attendee.id}:initial`,
  };
}

/** True as soon as the promise settles, false if it has not within `ms`. */
async function finishesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true, () => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A check that an open erasure must hold up can only finish after the commit, so a short watch is enough; one that it must not hold up gets a long one, so that a slow machine cannot fail it. */
const HELD_UP_MS = 300;
const NOT_HELD_UP_MS = 5_000;

/**
 * The last check of `deliveries` while the erasure of `erasedId` is open: whether it was still
 * waiting after `windowMs`, and what it finds once the erasure has committed. A plain read would
 * still show every delivery as it was before the erasure began.
 */
async function checkWhileErasing(
  deliveries: { deliveryId: string; attendeeId: string }[],
  erasedId: string,
  windowMs: number,
  eventId = EVENT_ID,
) {
  const held = await holdErasure([erasedId], eventId);
  const checking = readDeliveriesBeforeSend(prisma, deliveries);
  const waited = !(await finishesWithin(checking, windowMs));
  await held.commit();
  return { waited, found: await checking };
}

/** A mailer that accepts everything, and the spy on what it was handed. */
function acceptingMailer() {
  const send = vi.fn(async (message: MailMessage): Promise<SendResult> => ({
    status: "accepted",
    provider: "smtp",
    providerMessageId: "msg-1",
    idempotencyKey: message.idempotencyKey,
  }));
  const adapter = { provider: "smtp", send, close: vi.fn(async () => undefined) } as unknown as MailerAdapter;
  return { adapter, send };
}

describe("claiming and creating deliveries", () => {
  it("queues nothing for an erased attendee", async () => {
    const a = await createAttendee();
    await erase([a.id]);
    expect(await claimInitialDelivery(claimInput(a.id), prisma)).toEqual({ action: "skip", reason: "erased" });
    expect(await createResendDelivery(claimInput(a.id), prisma)).toBeNull();
    expect(await deliveriesOf(a.id)).toHaveLength(0);
  });

  it("waits for an open erasure, then queues nothing", async () => {
    const a = await createAttendee();
    const b = await createAttendee();
    const held = await holdErasure([a.id, b.id]);
    const claiming = claimInitialDelivery(claimInput(a.id), prisma);
    const resending = createResendDelivery(claimInput(b.id), prisma);
    expect(await staysPending(claiming)).toBe(true);
    expect(await staysPending(resending)).toBe(true);
    await held.commit();
    expect(await claiming).toEqual({ action: "skip", reason: "erased" });
    expect(await resending).toBeNull();
    expect(await deliveriesOf(a.id)).toHaveLength(0);
    expect(await deliveriesOf(b.id)).toHaveLength(0);
  });

  it("does not refill the cancelled, emptied delivery of an erased attendee", async () => {
    const a = await createAttendee();
    const first: ClaimResult = await claimInitialDelivery(claimInput(a.id), prisma);
    expect(first.action).toBe("send");
    await erase([a.id]);

    expect(await claimInitialDelivery(claimInput(a.id), prisma)).toEqual({ action: "skip", reason: "erased" });

    const [row] = await deliveriesOf(a.id);
    expect(row).toMatchObject({ status: "cancelled", recipient_email: null, rendered_subject: null, rendered_html: null });
  });

  it("a reclaim that starts while the erasure is open waits and leaves the row emptied", async () => {
    const a = await createAttendee();
    await claimInitialDelivery(claimInput(a.id), prisma);
    await prisma.emailDelivery.updateMany({ where: { attendee_id: a.id }, data: { status: "cancelled" } });
    const held = await holdErasure([a.id]);
    const reclaiming = claimInitialDelivery(claimInput(a.id), prisma);
    expect(await staysPending(reclaiming)).toBe(true);
    await held.commit();
    expect(await reclaiming).toEqual({ action: "skip", reason: "erased" });
    expect((await deliveriesOf(a.id))[0]).toMatchObject({ status: "cancelled", recipient_email: null });
  });

  it("still queues, reclaims and resends for a live attendee", async () => {
    const a = await createAttendee();
    expect((await claimInitialDelivery(claimInput(a.id), prisma)).action).toBe("send");
    await prisma.emailDelivery.updateMany({ where: { attendee_id: a.id }, data: { status: "cancelled" } });
    expect((await claimInitialDelivery(claimInput(a.id), prisma)).action).toBe("send");
    expect(await createResendDelivery(claimInput(a.id), prisma)).not.toBeNull();
    expect(await deliveriesOf(a.id)).toHaveLength(2);
  });
});

describe("a hard delete racing a send", () => {
  it("does not deadlock: the delete takes the attendee row before its children", async () => {
    const a = await createAttendee();
    await claimInitialDelivery(claimInput(a.id), prisma);
    // The delete transaction removes the delivery first (as the admin route does), then waits;
    // a claim that starts meanwhile must not hold the attendee while waiting for that delivery.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let deleted!: () => void;
    const deletedPromise = new Promise<void>((resolve) => (deleted = resolve));
    const deleting = prisma.$transaction(async (tx) => {
      await lockAttendeesForUpdate(tx, EVENT_ID, [a.id]);
      await tx.emailDelivery.deleteMany({ where: { attendee_id: a.id } });
      deleted();
      await gate;
      await tx.attendee.delete({ where: { id: a.id } });
    });
    await deletedPromise;
    const claiming = claimInitialDelivery(claimInput(a.id), prisma);
    expect(await staysPending(claiming)).toBe(true);
    release();
    await deleting;
    // The attendee is gone: the claim ends in the foreign-key error, not in a deadlock.
    const error = await claiming.then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/deadlock/i);
  });
});

describe("a send that started before the erasure", () => {
  const issuedAttendee = async () => {
    const n = ++seq;
    const token = generateToken();
    return prisma.attendee.create({
      data: {
        id: `mail-erased-issued-${n}`,
        event_id: EVENT_ID,
        email: `issued${n}@example.com`,
        name: `Issued Person ${n}`,
        token_hash: hashToken(token),
        token_enc: encryptToString(token),
      },
    });
  };

  it.each([["initial"], ["resend"]] as const)(
    "queues nothing for an attendee erased while a %s send waits to queue it, and reports it as skipped",
    async (purpose) => {
      const a = await issuedAttendee();
      const held = await holdErasure([a.id]);
      const sending = sendTicketEmails(EVENT_ID, { attendeeIds: [a.id], purpose }, prisma, ENV, { exportSink: () => undefined });
      expect(await staysPending(sending)).toBe(true);
      await held.commit();

      const result = await sending;

      expect(result.queued).toBe(0);
      expect(result.skipped).toEqual([expect.objectContaining({ attendeeId: a.id, reason: "erased" })]);
      expect(await deliveriesOf(a.id)).toHaveLength(0);
    },
  );
});

describe("sending to attendees", () => {
  it("skips an erased attendee on an initial and on a resend send, and queues the others", async () => {
    const erased = await createAttendee();
    const live = await createAttendee();
    await erase([erased.id]);

    const initial = await sendTicketEmails(EVENT_ID, { attendeeIds: [erased.id, live.id] }, prisma, ENV, { exportSink: () => undefined });
    const resend = await sendTicketEmails(EVENT_ID, { attendeeIds: [erased.id], purpose: "resend" }, prisma, ENV, { exportSink: () => undefined });

    expect(initial.queued).toBe(1);
    expect(initial.skipped).toEqual([expect.objectContaining({ attendeeId: erased.id, reason: "erased" })]);
    expect(resend.queued).toBe(0);
    expect(resend.skipped).toEqual([expect.objectContaining({ attendeeId: erased.id })]);
    expect(await deliveriesOf(erased.id)).toHaveLength(0);
    expect(await deliveriesOf(live.id)).toHaveLength(1);
  });
});

describe("mail already on its way", () => {
  it("does not write the outcome of a send back onto the delivery of an attendee erased meanwhile", async () => {
    // Only this attendee's delivery is waiting, so the drain holds exactly that one in flight.
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    expect((await deliveriesOf(a.id))[0]?.status).toBe("queued");

    // The mailer is inside its send call when the erasure commits.
    let inSink!: () => void;
    const sinkReached = new Promise<void>((resolve) => (inSink = resolve));
    let releaseSink!: () => void;
    const sinkGate = new Promise<void>((resolve) => (releaseSink = resolve));
    const draining = drainPendingDeliveries(
      prisma,
      ENV,
      {
        exportSink: async () => {
          inSink();
          await sinkGate;
        },
      },
      { eventId: EVENT_ID, baseUrl: ENV.BASE_URL },
    );
    await sinkReached;
    await erase([a.id]);
    releaseSink();
    const result = await draining;

    expect(result).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect((await deliveriesOf(a.id))[0]).toMatchObject({
      status: "cancelled",
      recipient_email: null,
      provider_message_id: null,
      error: null,
    });
  });

  it("does not send an emptied row, whatever its status", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    await erase([a.id]);
    await prisma.emailDelivery.updateMany({ where: { attendee_id: a.id }, data: { status: "queued" } });
    const sent: unknown[] = [];
    const result = await drainPendingDeliveries(prisma, ENV, { exportSink: (p) => sent.push(p) }, { eventId: EVENT_ID, baseUrl: ENV.BASE_URL });
    expect(result).toMatchObject({ claimed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("a retry of an emptied delivery does not send", async () => {
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    const [row] = await deliveriesOf(a.id);
    await prisma.emailDelivery.update({ where: { id: row!.id }, data: { status: "failed", retryable: true } });
    await erase([a.id]);
    await prisma.emailDelivery.update({ where: { id: row!.id }, data: { status: "failed", retryable: true } });
    const sent: unknown[] = [];
    expect(await retryDelivery(row!.id, prisma, ENV, { exportSink: (p) => sent.push(p) }, { baseUrl: ENV.BASE_URL })).toEqual({
      ok: false,
      reason: "missing_snapshot",
    });
    expect(sent).toHaveLength(0);
  });

  it("a retry re-reads the delivery right before sending, so one cancelled since the first read is not sent", async () => {
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    const [row] = await deliveriesOf(a.id);
    await prisma.emailDelivery.update({ where: { id: row!.id }, data: { status: "failed", retryable: true } });
    const stale = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row!.id } });
    // Cancelled (as an erasure does) after retryDelivery's first read, which still sees it failed.
    await prisma.emailDelivery.update({ where: { id: row!.id }, data: { status: "cancelled", recipient_email: null } });
    const spy = vi.spyOn(prisma.emailDelivery, "findUniqueOrThrow").mockResolvedValueOnce(stale);
    const sent: unknown[] = [];
    try {
      expect(await retryDelivery(row!.id, prisma, ENV, { exportSink: (p) => sent.push(p) }, { baseUrl: ENV.BASE_URL })).toEqual({
        ok: false,
        reason: "not_retryable",
      });
    } finally {
      spy.mockRestore();
    }
    expect(sent).toHaveLength(0);
  });

  it("a retry whose mail is in flight when the erasure commits does not write its outcome back", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    const [row] = await deliveriesOf(a.id);
    await prisma.emailDelivery.update({ where: { id: row!.id }, data: { status: "failed", retryable: true } });

    let inSink!: () => void;
    const sinkReached = new Promise<void>((resolve) => (inSink = resolve));
    let releaseSink!: () => void;
    const sinkGate = new Promise<void>((resolve) => (releaseSink = resolve));
    const retrying = retryDelivery(
      row!.id,
      prisma,
      ENV,
      {
        exportSink: async () => {
          inSink();
          await sinkGate;
        },
      },
      { baseUrl: ENV.BASE_URL },
    );
    await sinkReached;
    await erase([a.id]);
    releaseSink();
    await retrying;

    expect((await deliveriesOf(a.id))[0]).toMatchObject({
      status: "cancelled",
      recipient_email: null,
      provider_message_id: null,
      error: null,
    });
  });

  it("a late bounce does not change the delivery of an erased attendee", async () => {
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    await prisma.emailDelivery.updateMany({ where: { attendee_id: a.id }, data: { status: "accepted", recipient_email: "mail@example.com" } });
    const [before] = await deliveriesOf(a.id);
    await erase([a.id]);

    const outcome = await applyBounceResult(
      prisma,
      before!,
      { recipientEmail: "mail@example.com", smtpCode: "550", enhancedCode: "5.1.1", reason: "mailbox mail@example.com does not exist" },
      () => undefined,
    );

    expect(outcome).toBe("skipped");
    expect((await deliveriesOf(a.id))[0]).toMatchObject({ status: "accepted", error: null });
  });

  it("a retry whose last check starts while the erasure is open waits for it and then does not send", async () => {
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    const [row] = await deliveriesOf(a.id);
    await prisma.emailDelivery.update({ where: { id: row!.id }, data: { status: "failed", retryable: true } });
    const held = await holdErasure([a.id]);

    const sent: unknown[] = [];
    const retrying = retryDelivery(row!.id, prisma, ENV, { exportSink: (p) => sent.push(p) }, { baseUrl: ENV.BASE_URL });
    // A plain read would still show the failed row with its recipient and send it.
    expect(await staysPending(retrying)).toBe(true);
    await held.commit();

    expect(await retrying).toEqual({ ok: false, reason: "not_retryable" });
    expect(sent).toHaveLength(0);
  });

  it("the drain's last check starts while the erasure is open: it waits for it and then does not send", async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_ID } });
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    const held = await holdErasure([a.id]);

    const sent: unknown[] = [];
    const draining = drainPendingDeliveries(prisma, ENV, { exportSink: (p) => sent.push(p) }, { eventId: EVENT_ID, baseUrl: ENV.BASE_URL });
    expect(await staysPending(draining)).toBe(true);
    await held.commit();

    expect(await draining).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
    expect((await deliveriesOf(a.id))[0]).toMatchObject({ status: "cancelled", recipient_email: null });
  });

  it("a ticket view that starts while the erasure is open waits for it and records nothing", async () => {
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    await prisma.emailDelivery.updateMany({ where: { attendee_id: a.id }, data: { status: "accepted" } });
    const held = await holdErasure([a.id]);

    const viewing = recordTicketViewed(a.id, EVENT_ID, prisma);
    expect(await staysPending(viewing)).toBe(true);
    await held.commit();
    await viewing;

    expect((await deliveriesOf(a.id))[0]?.viewed_at).toBeNull();
  });

  it("records nothing, and does not fail, for an attendee with no successful delivery", async () => {
    const a = await createAttendee();
    await expect(recordTicketViewed(a.id, EVENT_ID, prisma)).resolves.toBeUndefined();
    expect(await deliveriesOf(a.id)).toHaveLength(0);
  });

  it("still records a ticket view for a live attendee", async () => {
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    await prisma.emailDelivery.updateMany({ where: { attendee_id: a.id }, data: { status: "accepted" } });
    await recordTicketViewed(a.id, EVENT_ID, prisma);
    expect((await deliveriesOf(a.id))[0]?.viewed_at).toBeInstanceOf(Date);
  });

  it("opening the ticket of an erased attendee records nothing on their delivery", async () => {
    const a = await createAttendee();
    await sendTicketEmails(EVENT_ID, { attendeeIds: [a.id] }, prisma, ENV, { exportSink: () => undefined });
    await prisma.emailDelivery.updateMany({ where: { attendee_id: a.id }, data: { status: "accepted" } });
    await erase([a.id]);
    await prisma.emailDelivery.updateMany({ where: { attendee_id: a.id }, data: { status: "accepted" } });
    await recordTicketViewed(a.id, EVENT_ID, prisma);
    expect((await deliveriesOf(a.id))[0]?.viewed_at).toBeNull();
  });
});

describe("a synchronous batch that was claimed earlier", () => {
  it("does not hand the mailer the message of an attendee erased since its delivery was claimed", async () => {
    const erased = await createAttendee();
    const live = await createAttendee();
    const pending = [await pendingFor(erased), await pendingFor(live)];
    await erase([erased.id]);
    const { adapter, send } = acceptingMailer();

    expect(await deliverPendingBatch(adapter, pending, prisma)).toBe(1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `${live.id}:initial` }));
    expect((await deliveriesOf(erased.id))[0]).toMatchObject({ status: "cancelled", recipient_email: null });
    expect((await deliveriesOf(live.id))[0]).toMatchObject({ status: "accepted" });
  });

  it("does not hand the mailer a message to the address of someone being erased, though the delivery is another attendee's", async () => {
    const erased = await createAttendee();
    const owner = await createAttendee();
    const live = await createAttendee();
    const pending = [await pendingFor(owner, erased.email), await pendingFor(live)];
    const held = await holdErasure([erased.id]);
    const { adapter, send } = acceptingMailer();

    const delivering = deliverPendingBatch(adapter, pending, prisma);
    try {
      // Its owner is not being erased, so a plain read would still show the message as sendable.
      expect(await staysPending(delivering)).toBe(true);
    } finally {
      await held.commit();
    }

    expect(await delivering).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `${live.id}:initial` }));
    expect((await deliveriesOf(owner.id))[0]).toMatchObject({ status: "cancelled", recipient_email: null });
  });
});

describe("the last check for a delivery sent to another attendee's address (the resend override)", () => {
  it("waits for the erasure of the person who holds the address, then finds the delivery cancelled and emptied", async () => {
    const erased = await createAttendee();
    const owner = await createAttendee();
    const { deliveryId } = await claimedFor(owner, erased.email);

    const { waited, found } = await checkWhileErasing([{ deliveryId, attendeeId: owner.id }], erased.id, HELD_UP_MS);

    expect(waited).toBe(true);
    expect(found.get(deliveryId)).toEqual({ status: "cancelled", recipient_email: null });
  });

  it("finds that person by the address however the delivery writes it", async () => {
    const erased = await createAttendee();
    const owner = await createAttendee();
    const { deliveryId } = await claimedFor(owner, erased.email);
    await prisma.emailDelivery.update({ where: { id: deliveryId }, data: { recipient_email: `  ${erased.email.toUpperCase()} ` } });

    const { waited, found } = await checkWhileErasing([{ deliveryId, attendeeId: owner.id }], erased.id, HELD_UP_MS);

    expect(waited).toBe(true);
    expect(found.get(deliveryId)).toEqual({ status: "cancelled", recipient_email: null });
  });

  it("does not wait for an erasure that does not concern the address", async () => {
    const erased = await createAttendee();
    const holder = await createAttendee();
    const ownerOfLive = await createAttendee();
    const ownerOfOutside = await createAttendee();
    const toLive = await claimedFor(ownerOfLive, holder.email);
    const toOutside = await claimedFor(ownerOfOutside, "outside@example.org");

    const { waited, found } = await checkWhileErasing(
      [
        { deliveryId: toLive.deliveryId, attendeeId: ownerOfLive.id },
        { deliveryId: toOutside.deliveryId, attendeeId: ownerOfOutside.id },
      ],
      erased.id,
      NOT_HELD_UP_MS,
    );

    expect(waited).toBe(false);
    expect(found.get(toLive.deliveryId)).toEqual({ status: "queued", recipient_email: holder.email });
    expect(found.get(toOutside.deliveryId)).toEqual({ status: "queued", recipient_email: "outside@example.org" });
  });

  it("does not wait for the erasure of a person in another event who has the same address", async () => {
    const otherEventId = "evt-mail-erased-other";
    await prisma.event.create({
      data: { id: otherEventId, organization_id: ORG_ID, title: "Other Event", slug: "mail-erased-other-event", date: new Date("2026-09-02") },
    });
    const owner = await createAttendee();
    const namesake = await prisma.attendee.create({
      data: { id: "mail-erased-namesake", event_id: otherEventId, email: "namesake@example.com", name: "Namesake", public_ref: generateToken() },
    });
    const { deliveryId } = await claimedFor(owner, namesake.email);

    // The erasure cancels only the deliveries of its own event, so this one stays as it is and is not waited for.
    const { waited, found } = await checkWhileErasing([{ deliveryId, attendeeId: owner.id }], namesake.id, NOT_HELD_UP_MS, otherEventId);

    expect(waited).toBe(false);
    expect(found.get(deliveryId)).toEqual({ status: "queued", recipient_email: namesake.email });
  });
});
