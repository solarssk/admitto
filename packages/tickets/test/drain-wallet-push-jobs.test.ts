import { beforeEach, describe, expect, it, vi } from "vitest";

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
  reclaimStaleWalletPushJobs,
  WALLET_PUSH_CONCURRENCY,
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
      data: { status: "failed", finished_at: expect.any(Date), error: "wallet_not_configured" },
    });
  });

  it("marks the job failed for a malformed request payload instead of throwing", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob({ result_json: { request: { kind: "nonsense" } } }) as never);

    const result = await drainWalletPushJobs(db as never);

    expect(result.failed).toBe(1);
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-wp-1" },
      data: { status: "failed", finished_at: expect.any(Date), error: "wallet_push_job_bad_request" },
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
});
