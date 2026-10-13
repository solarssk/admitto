import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import { cancelBulkSendBatch, claimInitialDelivery, drainPendingDeliveries, retryDelivery } from "../src/index.js";
import { applyBounceResult } from "../src/bounceIngest/applyBounceResult.js";
import { nullifyDeliverySnapshots } from "../src/retention.js";
import { openWorkerLockClient } from "../../../apps/cli/src/commands/worker-locks.js";
import { resetDb } from "./resetDb.js";
import { seedOrgAndEvent } from "./seedOrgAndEvent.js";

const db = createTestPrismaClient();
let sequence = 0;
const eventId = "event-lifecycle";
function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { waiting, release };
}
beforeAll(async () => {
  await resetDb();
  await seedOrgAndEvent(db, { orgId: "org-lifecycle", orgName: "Synthetic", orgSlug: "lifecycle", eventId, eventTitle: "Synthetic", eventSlug: "lifecycle" });
});
beforeEach(async () => { await db.emailDelivery.deleteMany({ where: { event_id: eventId } }); });
afterAll(async () => { await db.$disconnect(); });
async function delivery(status: "queued" | "failed" | "cancelled", batch = "batch") {
  const id = `person-lifecycle-${++sequence}`;
  const token = generateToken();
  await db.attendee.create({ data: { id, event_id: eventId, name: "Synthetic", email: `${id}@example.com`, token_hash: hashToken(token), token_enc: encryptToString(token), public_ref: generateToken() } });
  return db.emailDelivery.create({ data: { organization_id: "org-lifecycle", event_id: eventId, attendee_id: id, batch_id: batch, purpose: "initial", provider: "export_only", status, retryable: true, recipient_email: `${id}@example.com`, rendered_subject: "Old snapshot", rendered_html: "<p>Synthetic</p>", queued_at: new Date(sequence * 1000), attempted_at: new Date(0), failed_at: new Date(0), updated_at: new Date(0) } });
}
function reclaim(row: { attendee_id: string }, subject = "New snapshot") {
  return claimInitialDelivery({ organizationId: "org-lifecycle", eventId, attendeeId: row.attendee_id, batchId: "fresh", provider: "export_only", hasWalletCta: false, recipientEmail: "fresh@example.com", renderedSubject: subject, renderedHtml: "<p>Fresh synthetic</p>" }, db);
}

function pauseRead(methodName: "findMany" | "findUniqueOrThrow", entered: ReturnType<typeof gate>, release: ReturnType<typeof gate>) {
  let pausedOnce = false;
  const delegate = new Proxy(db.emailDelivery, {
    get(target, key, receiver) {
    const method = Reflect.get(target, key, receiver);
    if (key === methodName) return async (...args: unknown[]) => {
      const rows = await Reflect.apply(method, target, args);
      if (!pausedOnce) { pausedOnce = true; entered.release(); await release.waiting; }
      return rows;
    };
    return typeof method === "function" ? method.bind(target) : method;
    },
  });
  const client = new Proxy(db, {
    get(target, key, receiver) {
    if (key === "emailDelivery") return delegate;
    const method = Reflect.get(target, key, receiver);
    return typeof method === "function" ? method.bind(target) : method;
    },
  });
  return client;
}

describe("delivery lifecycle ownership", () => {
  it("prevents a worker and CLI retry sending one failed snapshot concurrently", async () => {
    const row = await delivery("failed");
    const entered = gate(); const release = gate(); let sends = 0;
    const sink = async () => { sends++; entered.release(); await release.waiting; };
    const workerLock = await openWorkerLockClient(process.env.DATABASE_URL!);
    expect(await workerLock.tryAcquire("mail_delivery")).toBe(true);
    const retry = retryDelivery(row.id, db, process.env, { exportSink: sink });
    await entered.waiting;
    const drain = drainPendingDeliveries(db, process.env, { exportSink: sink }, { eventId });
    try {
      await Promise.race([drain, new Promise((resolve) => setTimeout(resolve, 150))]);
      expect(sends).toBe(1);
    } finally { release.release(); await Promise.all([retry, drain]); await workerLock.close(); }
  });

  it("does not send a cached row after cancel and reclaim", async () => {
    const first = await delivery("queued", "cached"); const second = await delivery("queued", "cached");
    const entered = gate(); const release = gate(); const subjects: string[] = [];
    const sink = async (payload: { message: { subject: string; to: string } }) => {
      subjects.push(payload.message.subject);
      if (payload.message.to === first.recipient_email) { entered.release(); await release.waiting; }
    };
    const drain = drainPendingDeliveries(db, process.env, { exportSink: sink }, { eventId, includeRetryableFailed: false });
    await entered.waiting;
    try {
      await cancelBulkSendBatch(db, eventId, "cached"); await reclaim(second);
      release.release(); await drain;
      expect(subjects).toHaveLength(1);
      expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("queued");
      expect((await drainPendingDeliveries(db, process.env, { exportSink: sink }, { eventId })).sent).toBe(1);
      expect(subjects).toEqual(["Old snapshot", "New snapshot"]);
    } finally { release.release(); await drain; }
  });

  it("retention rechecks stale selection after a fresh claim", async () => {
    const row = await delivery("cancelled"); const entered = gate(); const release = gate();
    const paused = pauseRead("findMany", entered, release);
    const retention = nullifyDeliverySnapshots(paused, { now: new Date("2026-10-14"), batchSize: 100 });
    await entered.waiting;
    try {
      await reclaim(row); release.release(); const result = await retention;
      expect(result.deliveries).toBe(0);
      expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "queued", rendered_subject: "New snapshot", rendered_html: "<p>Fresh synthetic</p>" });
    } finally { release.release(); await retention; }
  });
  it("same-millisecond reclaim fences a stale successful outcome", async () => {
    const row = await delivery("queued", "same-clock");
    const entered = gate(); const release = gate(); let sends = 0;
    const sink = async () => { sends++; if (sends === 1) { entered.release(); await release.waiting; } };
    const drain = drainPendingDeliveries(db, process.env, { exportSink: sink }, { eventId });
    await entered.waiting;
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(row.queued_at);
    try {
      await cancelBulkSendBatch(db, eventId, "same-clock"); await reclaim(row);
      const fresh = await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
      expect(fresh.queued_at.getTime()).toBe(row.queued_at.getTime() + 1);
      release.release(); await drain;
      expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "queued", rendered_subject: "New snapshot", provider_message_id: null });
    } finally { vi.useRealTimers(); release.release(); await drain; }
    expect((await drainPendingDeliveries(db, process.env, { exportSink: sink }, { eventId })).sent).toBe(1);
    expect(sends).toBe(2);
  });

  it.each(["cancelled", "failed"] as const)("clears a stale %s snapshot and its retryability", async (status) => {
    const row = await delivery(status);
    expect((await nullifyDeliverySnapshots(db, { now: new Date("2026-10-14") })).deliveries).toBe(1);
    expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ rendered_subject: null, rendered_html: null, retryable: false });
  });

  it("keeps a healthy queued snapshot through retention and sends it once", async () => {
    const row = await delivery("queued");
    expect((await nullifyDeliverySnapshots(db)).deliveries).toBe(0);
    let sends = 0;
    expect((await drainPendingDeliveries(db, process.env, { exportSink: () => { sends++; } }, { eventId })).sent).toBe(1);
    expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("accepted");
    expect((await drainPendingDeliveries(db, process.env, { exportSink: () => { sends++; } }, { eventId })).sent).toBe(0);
    expect(sends).toBe(1);
  });

  it("does not send or restore retryability after retention cleared a cached failed snapshot", async () => {
    const row = await delivery("failed"); const entered = gate(); const release = gate(); let sends = 0;
    const paused = pauseRead("findUniqueOrThrow", entered, release);
    const retry = retryDelivery(row.id, paused, process.env, { exportSink: () => { sends++; } });
    await entered.waiting;
    try {
      expect((await nullifyDeliverySnapshots(db)).deliveries).toBe(1);
      release.release(); expect((await retry).ok).toBe(false);
      expect(sends).toBe(0);
      expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ rendered_subject: null, rendered_html: null, retryable: false });
    } finally { release.release(); await retry; }
  });

  it("ignores a cached bounce outcome after the delivery has been reclaimed", async () => {
    const row = await delivery("queued", "bounce-revision");
    await cancelBulkSendBatch(db, eventId, "bounce-revision"); await reclaim(row);
    expect(await applyBounceResult(db, row, { recipientEmail: row.recipient_email!, smtpCode: "550", reason: "Synthetic bounce" }, () => undefined)).toBe("skipped");
    expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("queued");
  });

});
