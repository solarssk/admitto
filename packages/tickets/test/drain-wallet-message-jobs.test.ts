import { beforeEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

vi.mock("../src/claim-admin-job.js", () => ({
  claimNextAdminJob: vi.fn(),
}));
vi.mock("../src/send-wallet-message.js", () => ({
  loadWalletMessageTargets: vi.fn(),
  sendWalletMessage: vi.fn(),
}));
vi.mock("@admitto/wallet", () => ({
  resolveWalletProvider: vi.fn(),
}));

import { claimNextAdminJob } from "../src/claim-admin-job.js";
import { loadWalletMessageTargets, sendWalletMessage } from "../src/send-wallet-message.js";
import { resolveWalletProvider } from "@admitto/wallet";
import {
  drainWalletMessageJobs,
  parseWalletMessageJobStaleRunningMs,
  reclaimStaleWalletMessageJobs,
  STALE_WALLET_MESSAGE_PENDING_ERROR,
  WALLET_MESSAGE_JOB_BAD_REQUEST_ERROR,
  WALLET_MESSAGE_JOB_GENERIC_ERROR,
  WALLET_MESSAGE_JOB_NOT_CONFIGURED_ERROR,
} from "../src/drain-wallet-message-jobs.js";

const fakeProvider = { provider: "stub" };

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-wm-1",
    type: "wallet_message",
    status: "running",
    event_id: "evt-1",
    organization_id: "org-1",
    result_json: {
      request: { eventId: "evt-1", attendeeIds: ["att-1", "att-2"], text: "Welcome to the event!" },
    },
    ...overrides,
  };
}

describe("drainWalletMessageJobs", () => {
  let db: {
    adminJob: {
      update: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    backgroundWorkerHeartbeat: { findUnique: ReturnType<typeof vi.fn> };
    event: { findUnique: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.mocked(claimNextAdminJob).mockReset();
    vi.mocked(loadWalletMessageTargets).mockReset();
    // Default: every target sends cleanly, reporting progress once with the full count - mirrors
    // the real implementation's happy path closely enough for tests that aren't specifically
    // exercising partial-failure/progress-callback behavior (those override with mockImplementationOnce).
    vi.mocked(sendWalletMessage)
      .mockReset()
      .mockImplementation(async (_provider, targets, _text, onProgress) => {
        await onProgress?.(targets.length);
        return { sent: targets.length, errored: 0, erroredAttendeeIds: [] };
      });
    vi.mocked(resolveWalletProvider).mockReset().mockReturnValue(fakeProvider as never);
    resetSystemLogBufferForTest();

    db = {
      adminJob: {
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      backgroundWorkerHeartbeat: {
        findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }),
      },
      event: {
        findUnique: vi.fn().mockResolvedValue({
          wallet_enabled: true,
          wallet_template_id: "tmpl-1",
          wallet_api_key_enc: "enc",
          wallet_field_mapping: null,
        }),
      },
    };
    vi.mocked(loadWalletMessageTargets).mockResolvedValue([
      { attendeeId: "att-1", providerPassId: "pc-1" },
      { attendeeId: "att-2", providerPassId: "pc-2" },
    ]);
  });

  it("does nothing when no job is pending", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null);

    const result = await drainWalletMessageJobs(db as never);

    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
    expect(sendWalletMessage).not.toHaveBeenCalled();
  });

  it("claims up to an explicitly provided limit, not just the default of one", async () => {
    vi.mocked(claimNextAdminJob)
      .mockResolvedValueOnce(baseJob({ id: "job-wm-1" }) as never)
      .mockResolvedValueOnce(baseJob({ id: "job-wm-2" }) as never);

    const result = await drainWalletMessageJobs(db as never, { limit: 2 });

    expect(result.claimed).toBe(2);
    expect(claimNextAdminJob).toHaveBeenCalledTimes(2);
  });

  it("resolves targets, sends the bulk message, and marks the job succeeded with sent/skipped counts", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);

    const result = await drainWalletMessageJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    expect(loadWalletMessageTargets).toHaveBeenCalledWith(db, "evt-1", ["att-1", "att-2"]);
    expect(sendWalletMessage).toHaveBeenCalledWith(
      fakeProvider,
      [
        { attendeeId: "att-1", providerPassId: "pc-1" },
        { attendeeId: "att-2", providerPassId: "pc-2" },
      ],
      "Welcome to the event!",
      expect.any(Function),
    );

    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wm-1" },
      data: { progress_total: 2, progress_done: 0 },
    });
    // Incremental progress from the onProgress callback (skipped + doneCount) - the mock's
    // default implementation reports the full batch done in one call.
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wm-1" },
      data: { progress_done: 2 },
    });

    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0]).toMatchObject({
      where: { id: "job-wm-1" },
      data: {
        status: "succeeded",
        progress_done: 2,
        result_json: {
          request: { eventId: "evt-1", attendeeIds: ["att-1", "att-2"], text: "Welcome to the event!" },
          sent: 2,
          skipped: 0,
          errored: 0,
          erroredAttendeeIds: [],
        },
        error: null,
      },
    });
  });

  it("counts an attendee with no resolvable wallet pass as skipped in progress_total/progress_done and the final tally", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(
      baseJob({
        result_json: { request: { eventId: "evt-1", attendeeIds: ["att-1", "att-gone"], text: "Hi" } },
      }) as never,
    );
    vi.mocked(loadWalletMessageTargets).mockResolvedValueOnce([{ attendeeId: "att-1", providerPassId: "pc-1" }]);

    await drainWalletMessageJobs(db as never);

    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wm-1" },
      data: { progress_total: 2, progress_done: 1 },
    });
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0].data.result_json).toMatchObject({ sent: 1, skipped: 1, errored: 0 });
  });

  it("still marks the job succeeded (not failed) when sendWalletMessage reports a partial batch failure, with an accurate errored count and the failed recipients' ids - a retry limited to erroredAttendeeIds would not re-message already-reached recipients", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(sendWalletMessage)
      .mockReset()
      .mockResolvedValueOnce({ sent: 1, errored: 1, erroredAttendeeIds: ["att-2"] });

    const result = await drainWalletMessageJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0].data.result_json).toMatchObject({
      sent: 1,
      skipped: 0,
      errored: 1,
      erroredAttendeeIds: ["att-2"],
    });
  });

  it("persists progress after each batch via the onProgress callback passed to sendWalletMessage", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(sendWalletMessage).mockReset().mockImplementationOnce(async (_p, _t, _x, onProgress) => {
      await onProgress?.(1);
      await onProgress?.(2);
      return { sent: 2, errored: 0, erroredAttendeeIds: [] };
    });

    await drainWalletMessageJobs(db as never);

    // skipped (0 here) + each reported doneCount.
    expect(db.adminJob.update).toHaveBeenCalledWith({ where: { id: "job-wm-1" }, data: { progress_done: 1 } });
    expect(db.adminJob.update).toHaveBeenCalledWith({ where: { id: "job-wm-1" }, data: { progress_done: 2 } });
  });

  it("marks the job failed (not succeeded) when the event has no usable wallet provider", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(resolveWalletProvider).mockReturnValueOnce(null);

    const result = await drainWalletMessageJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1, reclaimed: 0 });
    expect(sendWalletMessage).not.toHaveBeenCalled();
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wm-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: WALLET_MESSAGE_JOB_NOT_CONFIGURED_ERROR },
    });
    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({ level: "error", message: "wallet_message_job_failed", fields: { job_id: "job-wm-1" } });
  });

  it("marks the job failed when the event referenced by the request no longer exists", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    db.event.findUnique.mockResolvedValueOnce(null);

    const result = await drainWalletMessageJobs(db as never);

    expect(result.failed).toBe(1);
    expect(resolveWalletProvider).not.toHaveBeenCalled();
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wm-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: WALLET_MESSAGE_JOB_NOT_CONFIGURED_ERROR },
    });
  });

  it("sanitizes an unexpected sendWalletMessage rejection to the generic operator-safe message instead of leaking the raw exception text - defense in depth, the real implementation never throws (batch failures are caught internally and reported as `errored`), but an unexpected exception here must still fail safely rather than crash the drain loop or expose internals", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(sendWalletMessage).mockReset().mockRejectedValueOnce(new Error("provider down"));

    const result = await drainWalletMessageJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1, reclaimed: 0 });
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wm-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: WALLET_MESSAGE_JOB_GENERIC_ERROR },
    });
  });

  it.each([
    ["no request property at all", {}],
    ["a non-object request", { request: "not-an-object" }],
    ["an array request", { request: ["nope"] }],
    ["a non-string eventId", { request: { eventId: 123, attendeeIds: [], text: "hi" } }],
    ["an empty eventId", { request: { eventId: "", attendeeIds: [], text: "hi" } }],
    ["a non-array attendeeIds", { request: { eventId: "evt-1", attendeeIds: "att-1", text: "hi" } }],
    ["an attendeeIds entry that isn't a string", { request: { eventId: "evt-1", attendeeIds: [1], text: "hi" } }],
    ["a missing text", { request: { eventId: "evt-1", attendeeIds: ["att-1"] } }],
    ["a blank text", { request: { eventId: "evt-1", attendeeIds: ["att-1"], text: "   " } }],
    ["a non-string text", { request: { eventId: "evt-1", attendeeIds: ["att-1"], text: 5 } }],
    ["a null result_json", null],
    ["a non-object result_json", "not-an-object"],
    ["an array result_json", ["nope"]],
  ])("marks the job failed for %s instead of throwing", async (_label, resultJson) => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob({ result_json: resultJson }) as never);

    const result = await drainWalletMessageJobs(db as never);

    expect(result.failed).toBe(1);
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wm-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: WALLET_MESSAGE_JOB_BAD_REQUEST_ERROR },
    });
  });

  it("sanitizes a non-Error rejection to the generic operator-safe message instead of leaking it verbatim", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(sendWalletMessage).mockRejectedValueOnce("raw string failure");

    const result = await drainWalletMessageJobs(db as never);

    expect(result.failed).toBe(1);
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "failed",
    );
    expect(finalCall![0]).toMatchObject({ data: { error: WALLET_MESSAGE_JOB_GENERIC_ERROR } });
  });
});

describe("parseWalletMessageJobStaleRunningMs", () => {
  it("uses the env value when it's a valid positive integer", () => {
    expect(parseWalletMessageJobStaleRunningMs({ WALLET_MESSAGE_JOB_STALE_RUNNING_MS: "600000" })).toBe(600000);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseWalletMessageJobStaleRunningMs({ WALLET_MESSAGE_JOB_STALE_RUNNING_MS: "  900000  " })).toBe(
      900000,
    );
  });

  it.each([
    ["unset", {}],
    ["blank", { WALLET_MESSAGE_JOB_STALE_RUNNING_MS: "   " }],
    ["not a number", { WALLET_MESSAGE_JOB_STALE_RUNNING_MS: "soon" }],
    ["zero", { WALLET_MESSAGE_JOB_STALE_RUNNING_MS: "0" }],
    ["negative", { WALLET_MESSAGE_JOB_STALE_RUNNING_MS: "-5" }],
  ])("falls back to the 30-minute default when %s", (_label, env) => {
    expect(parseWalletMessageJobStaleRunningMs(env)).toBe(30 * 60 * 1000);
  });
});

describe("reclaimStaleWalletMessageJobs", () => {
  it("fails a stale running job with the running-specific error", async () => {
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([{ id: "job-1", status: "running" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };

    const result = await reclaimStaleWalletMessageJobs(db as never, { now: new Date("2026-08-14T12:00:00Z") });

    expect(result).toEqual({ reclaimed: 1 });
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "failed",
        error: "Wallet message job abandoned (worker stopped while running). Start it again.",
        finished_at: new Date("2026-08-14T12:00:00Z"),
      },
    });
  });

  it("does not count a job as reclaimed when the CAS update finds it already changed status", async () => {
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([{ id: "job-1", status: "running" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };

    const result = await reclaimStaleWalletMessageJobs(db as never, { now: new Date("2026-08-14T12:00:00Z") });

    expect(result).toEqual({ reclaimed: 0 });
  });

  it("leaves a pending job alone while the worker heartbeat is fresh", async () => {
    const db = {
      adminJob: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };

    const result = await reclaimStaleWalletMessageJobs(db as never, { now: new Date("2026-08-14T12:00:00Z") });

    expect(result).toEqual({ reclaimed: 0 });
    expect(db.adminJob.updateMany).not.toHaveBeenCalled();
  });

  it("fails a pending job with the pending-specific error once the worker heartbeat itself is stale", async () => {
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([{ id: "job-2", status: "pending" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      backgroundWorkerHeartbeat: {
        findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date("2026-08-14T00:00:00Z") }),
      },
    };

    const result = await reclaimStaleWalletMessageJobs(db as never, { now: new Date("2026-08-14T12:00:00Z") });

    expect(result).toEqual({ reclaimed: 1 });
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-2", status: "pending" },
      data: {
        status: "failed",
        error: STALE_WALLET_MESSAGE_PENDING_ERROR,
        finished_at: new Date("2026-08-14T12:00:00Z"),
      },
    });
  });
});
