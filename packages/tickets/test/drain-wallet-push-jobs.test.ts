import { beforeEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

vi.mock("../src/claim-admin-job.js", () => ({
  claimNextAdminJob: vi.fn(),
}));
vi.mock("../src/reissue-wallet-pass.js", () => ({
  reissueOneWalletPass: vi.fn(),
}));
vi.mock("@admitto/wallet", () => ({
  resolveWalletProvider: vi.fn(),
}));

import { claimNextAdminJob } from "../src/claim-admin-job.js";
import { reissueOneWalletPass } from "../src/reissue-wallet-pass.js";
import { resolveWalletProvider } from "@admitto/wallet";
import {
  drainWalletPushJobs,
  parseWalletPushJobStaleRunningMs,
  reclaimStaleWalletPushJobs,
  STALE_WALLET_PUSH_PENDING_ERROR,
  WALLET_PUSH_CONCURRENCY,
  WALLET_PUSH_JOB_BAD_REQUEST_ERROR,
  WALLET_PUSH_JOB_GENERIC_ERROR,
  WALLET_PUSH_JOB_NOT_CONFIGURED_ERROR,
} from "../src/drain-wallet-push-jobs.js";

const fakeProvider = { provider: "stub" };

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-wp-1",
    type: "wallet_push",
    status: "running",
    event_id: "evt-1",
    organization_id: "org-1",
    actor_user_id: "user-1",
    session_id: "sess-1",
    client_timezone: "Europe/Warsaw",
    result_json: {
      request: { kind: "attendee_ids", eventId: "evt-1", attendeeIds: ["att-1", "att-2"] },
    },
    ...overrides,
  };
}

describe("drainWalletPushJobs", () => {
  let db: {
    adminJob: {
      update: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    backgroundWorkerHeartbeat: { findUnique: ReturnType<typeof vi.fn> };
    event: { findUnique: ReturnType<typeof vi.fn> };
    walletPass: { findMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.mocked(claimNextAdminJob).mockReset();
    vi.mocked(reissueOneWalletPass).mockReset();
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
      walletPass: {
        findMany: vi.fn().mockResolvedValue([
          { attendee_id: "att-1", provider_pass_id: "pc-1" },
          { attendee_id: "att-2", provider_pass_id: "pc-2" },
        ]),
      },
    };
  });

  it("does nothing when no job is pending", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null);

    const result = await drainWalletPushJobs(db as never);

    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
    expect(reissueOneWalletPass).not.toHaveBeenCalled();
  });

  it("claims up to an explicitly provided limit, not just the default of one", async () => {
    vi.mocked(claimNextAdminJob)
      .mockResolvedValueOnce(baseJob({ id: "job-wp-1" }) as never)
      .mockResolvedValueOnce(baseJob({ id: "job-wp-2" }) as never);
    vi.mocked(reissueOneWalletPass).mockResolvedValue("reissued");

    const result = await drainWalletPushJobs(db as never, { limit: 2 });

    // Exactly `limit` claims, even though a 3rd could theoretically still be pending - the loop
    // bound itself caps it, it doesn't need a trailing null claim to know to stop.
    expect(result.claimed).toBe(2);
    expect(claimNextAdminJob).toHaveBeenCalledTimes(2);
  });

  it("pushes every resolvable target, tallies the result, and marks the job succeeded", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never).mockResolvedValueOnce(null);
    vi.mocked(reissueOneWalletPass).mockResolvedValueOnce("reissued").mockResolvedValueOnce("skipped");

    const result = await drainWalletPushJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    expect(reissueOneWalletPass).toHaveBeenCalledTimes(2);
    expect(reissueOneWalletPass).toHaveBeenCalledWith(
      db,
      "evt-1",
      { attendeeId: "att-1", providerPassId: "pc-1" },
      fakeProvider,
      { operator: "user-1", sessionId: "sess-1", timezone: "Europe/Warsaw" },
    );

    // Progress: set once up front (total known, done=0), then updated after the single chunk.
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { progress_total: 2, progress_done: 0 },
    });
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { progress_done: 2 },
    });

    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0]).toMatchObject({
      where: { id: "job-wp-1" },
      data: {
        status: "succeeded",
        result_json: {
          request: { kind: "attendee_ids", eventId: "evt-1", attendeeIds: ["att-1", "att-2"] },
          reissued: 1,
          skipped: 1,
          errored: 0,
        },
        error: null,
      },
    });
  });

  it("counts a target with no resolvable WalletPass row as skipped, without calling reissueOneWalletPass for it", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(
      baseJob({ result_json: { request: { kind: "attendee_ids", eventId: "evt-1", attendeeIds: ["att-1", "att-gone"] } } }) as never,
    );
    db.walletPass.findMany.mockResolvedValueOnce([{ attendee_id: "att-1", provider_pass_id: "pc-1" }]);
    vi.mocked(reissueOneWalletPass).mockResolvedValueOnce("reissued");

    await drainWalletPushJobs(db as never);

    expect(reissueOneWalletPass).toHaveBeenCalledTimes(1);
    // progress_total/progress_done both count the full original selection (2), not just the 1
    // resolvable target - a no-pass row is already known-skipped up front, not left uncounted
    // until the final tally (bot review).
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { progress_total: 2, progress_done: 1 },
    });
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { progress_done: 2 },
    });
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0].data.result_json).toMatchObject({ reissued: 1, skipped: 1, errored: 0 });
  });

  it("counts a rejected push as errored without aborting the rest of the batch", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(reissueOneWalletPass)
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce("reissued");

    const result = await drainWalletPushJobs(db as never);

    expect(result.succeeded).toBe(1); // the job itself still completes/succeeds - errored is per-target, not fatal
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0].data.result_json).toMatchObject({ reissued: 1, skipped: 0, errored: 1 });
  });

  it("marks the job failed (not succeeded) when the event has no usable wallet provider", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(resolveWalletProvider).mockReturnValueOnce(null);

    const result = await drainWalletPushJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1, reclaimed: 0 });
    expect(reissueOneWalletPass).not.toHaveBeenCalled();
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: WALLET_PUSH_JOB_NOT_CONFIGURED_ERROR },
    });
    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({ level: "error", message: "wallet_push_job_failed", fields: { job_id: "job-wp-1" } });
  });

  it("marks the job failed for a malformed request payload instead of throwing", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob({ result_json: { request: { kind: "nonsense" } } }) as never);

    const result = await drainWalletPushJobs(db as never);

    expect(result.failed).toBe(1);
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: WALLET_PUSH_JOB_BAD_REQUEST_ERROR },
    });
  });

  it.each([
    ["no request property at all", {}],
    ["a non-object request", { request: "not-an-object" }],
    ["an array request", { request: ["nope"] }],
    // A valid eventId but neither recognized kind - distinct from the "nonsense" test above,
    // which has no eventId at all and so never reaches this specific check (bot review: Codecov
    // flagged the kind!=="attendee_ids" branch as only ever exercised in one direction).
    ["a valid eventId with an unrecognized kind", { request: { kind: "nonsense", eventId: "evt-1", attendeeIds: [] } }],
    ["a non-string eventId", { request: { kind: "attendee_ids", eventId: 123, attendeeIds: [] } }],
    ["an empty eventId", { request: { kind: "attendee_ids", eventId: "", attendeeIds: [] } }],
    ["a non-array attendeeIds", { request: { kind: "attendee_ids", eventId: "evt-1", attendeeIds: "att-1" } }],
    ["an attendeeIds entry that isn't a string", { request: { kind: "attendee_ids", eventId: "evt-1", attendeeIds: [1] } }],
  ])("marks the job failed for %s instead of throwing", async (_label, resultJson) => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob({ result_json: resultJson }) as never);

    const result = await drainWalletPushJobs(db as never);

    expect(result.failed).toBe(1);
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: WALLET_PUSH_JOB_BAD_REQUEST_ERROR },
    });
  });

  it("marks the job failed when the event referenced by the request no longer exists", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    db.event.findUnique.mockResolvedValueOnce(null);

    const result = await drainWalletPushJobs(db as never);

    expect(result.failed).toBe(1);
    expect(resolveWalletProvider).not.toHaveBeenCalled();
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: WALLET_PUSH_JOB_NOT_CONFIGURED_ERROR },
    });
  });

  it("passes undefined (not null) audit fields to reissueOneWalletPass when the job has none recorded", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(
      baseJob({ actor_user_id: null, session_id: null, client_timezone: null }) as never,
    );
    vi.mocked(reissueOneWalletPass).mockResolvedValueOnce("reissued").mockResolvedValueOnce("skipped");

    await drainWalletPushJobs(db as never);

    expect(reissueOneWalletPass).toHaveBeenCalledWith(
      db,
      "evt-1",
      expect.anything(),
      fakeProvider,
      { operator: undefined, sessionId: undefined, timezone: undefined },
    );
  });

  it("maps a non-Error rejection to the generic fixed message instead of crashing when marking the job failed", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    db.adminJob.update.mockRejectedValueOnce("raw string failure");

    const result = await drainWalletPushJobs(db as never);

    expect(result.failed).toBe(1);
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "failed",
    );
    expect(finalCall![0]).toMatchObject({ data: { error: WALLET_PUSH_JOB_GENERIC_ERROR } });
  });

  it.each([
    ["a null result_json", null],
    ["a non-object result_json", "not-an-object"],
    ["an array result_json", ["nope"]],
  ])("marks the job failed for %s instead of throwing", async (_label, resultJson) => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob({ result_json: resultJson }) as never);

    const result = await drainWalletPushJobs(db as never);

    expect(result.failed).toBe(1);
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: WALLET_PUSH_JOB_BAD_REQUEST_ERROR },
    });
  });

  it("chunks at WALLET_PUSH_CONCURRENCY, not all at once", async () => {
    const attendeeIds = Array.from({ length: WALLET_PUSH_CONCURRENCY + 3 }, (_, i) => `att-${i}`);
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(
      baseJob({ result_json: { request: { kind: "attendee_ids", eventId: "evt-1", attendeeIds } } }) as never,
    );
    db.walletPass.findMany.mockResolvedValueOnce(
      attendeeIds.map((id) => ({ attendee_id: id, provider_pass_id: `pc-${id}` })),
    );
    let concurrent = 0;
    let maxConcurrent = 0;
    vi.mocked(reissueOneWalletPass).mockImplementation(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
      return "reissued";
    });

    await drainWalletPushJobs(db as never);

    expect(maxConcurrent).toBeLessThanOrEqual(WALLET_PUSH_CONCURRENCY);
    expect(reissueOneWalletPass).toHaveBeenCalledTimes(attendeeIds.length);
  });

  describe("event_wide requests", () => {
    it("loads every active pass under the event, without a predetermined id list to diff against", async () => {
      vi.mocked(claimNextAdminJob).mockResolvedValueOnce(
        baseJob({ result_json: { request: { kind: "event_wide", eventId: "evt-1" } } }) as never,
      );
      vi.mocked(reissueOneWalletPass).mockResolvedValueOnce("reissued").mockResolvedValueOnce("skipped");

      const result = await drainWalletPushJobs(db as never);

      expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
      // status: "active" is deliberate here (unlike loadTargets for attendee_ids requests) -
      // matches the pre-job-system best-effort push's own behaviour of excluding voided passes.
      expect(db.walletPass.findMany).toHaveBeenCalledWith({
        where: { status: "active", provider_pass_id: { not: null }, attendee: { event_id: "evt-1" } },
        select: { attendee_id: true, provider_pass_id: true },
      });
      expect(reissueOneWalletPass).toHaveBeenCalledTimes(2);

      // No skippedNoPass concept for event_wide - the query result *is* the full selection, so
      // progress_total is just the resolved target count, not some separate requested count.
      expect(db.adminJob.update).toHaveBeenCalledWith({
        where: { id: "job-wp-1" },
        data: { progress_total: 2, progress_done: 0 },
      });

      const finalCall = db.adminJob.update.mock.calls.find(
        (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
      );
      expect(finalCall![0]).toMatchObject({
        where: { id: "job-wp-1" },
        data: {
          status: "succeeded",
          result_json: {
            request: { kind: "event_wide", eventId: "evt-1" },
            reissued: 1,
            skipped: 1,
            errored: 0,
          },
          error: null,
        },
      });
    });

    it("preserves the trigger reason through the success write-back, not just the initial insert", async () => {
      vi.mocked(claimNextAdminJob).mockResolvedValueOnce(
        baseJob({
          result_json: { request: { kind: "event_wide", eventId: "evt-1", reason: "location" } },
        }) as never,
      );
      vi.mocked(reissueOneWalletPass).mockResolvedValueOnce("reissued");

      await drainWalletPushJobs(db as never);

      const finalCall = db.adminJob.update.mock.calls.find(
        (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
      );
      // The finished job's own result_json.request is what the history endpoint reads back out -
      // readWalletPushRequest must round-trip reason unchanged, not silently drop it while
      // reconstructing the validated request object.
      expect(finalCall![0].data.result_json).toMatchObject({
        request: { kind: "event_wide", eventId: "evt-1", reason: "location" },
      });
    });

    it("still succeeds with an all-zero tally when the event has no active wallet passes at all", async () => {
      vi.mocked(claimNextAdminJob).mockResolvedValueOnce(
        baseJob({ result_json: { request: { kind: "event_wide", eventId: "evt-1" } } }) as never,
      );
      db.walletPass.findMany.mockResolvedValueOnce([]);

      const result = await drainWalletPushJobs(db as never);

      expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
      expect(reissueOneWalletPass).not.toHaveBeenCalled();
      const finalCall = db.adminJob.update.mock.calls.find(
        (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
      );
      expect(finalCall![0].data.result_json).toMatchObject({ reissued: 0, skipped: 0, errored: 0 });
    });
  });
});

describe("parseWalletPushJobStaleRunningMs", () => {
  it("uses the env value when it's a valid positive integer", () => {
    expect(parseWalletPushJobStaleRunningMs({ WALLET_PUSH_JOB_STALE_RUNNING_MS: "600000" })).toBe(600000);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseWalletPushJobStaleRunningMs({ WALLET_PUSH_JOB_STALE_RUNNING_MS: "  900000  " })).toBe(900000);
  });

  it.each([
    ["unset", {}],
    ["blank", { WALLET_PUSH_JOB_STALE_RUNNING_MS: "   " }],
    ["not a number", { WALLET_PUSH_JOB_STALE_RUNNING_MS: "soon" }],
    ["zero", { WALLET_PUSH_JOB_STALE_RUNNING_MS: "0" }],
    ["negative", { WALLET_PUSH_JOB_STALE_RUNNING_MS: "-5" }],
  ])("falls back to the 30-minute default when %s", (_label, env) => {
    expect(parseWalletPushJobStaleRunningMs(env)).toBe(30 * 60 * 1000);
  });
});

describe("reclaimStaleWalletPushJobs", () => {
  it("fails a stale running job with the running-specific error", async () => {
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([{ id: "job-1", status: "running" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };

    const result = await reclaimStaleWalletPushJobs(db as never, { now: new Date("2026-08-13T12:00:00Z") });

    expect(result).toEqual({ reclaimed: 1 });
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "failed",
        error: "Wallet push job abandoned (worker stopped while running). Start it again.",
        finished_at: new Date("2026-08-13T12:00:00Z"),
      },
    });
  });

  it("does not count a job as reclaimed when the CAS update finds it already changed status (race with a legitimate finish)", async () => {
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([{ id: "job-1", status: "running" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };

    const result = await reclaimStaleWalletPushJobs(db as never, { now: new Date("2026-08-13T12:00:00Z") });

    expect(result).toEqual({ reclaimed: 0 });
  });

  it("leaves a pending job alone while the worker heartbeat is fresh", async () => {
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };

    const result = await reclaimStaleWalletPushJobs(db as never, { now: new Date("2026-08-13T12:00:00Z") });

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
        findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date("2026-08-13T00:00:00Z") }),
      },
    };

    const result = await reclaimStaleWalletPushJobs(db as never, { now: new Date("2026-08-13T12:00:00Z") });

    expect(result).toEqual({ reclaimed: 1 });
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-2", status: "pending" },
      data: {
        status: "failed",
        error: STALE_WALLET_PUSH_PENDING_ERROR,
        finished_at: new Date("2026-08-13T12:00:00Z"),
      },
    });
  });
});
