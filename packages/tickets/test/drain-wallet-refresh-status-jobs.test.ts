import { beforeEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

vi.mock("../src/claim-admin-job.js", () => ({
  claimNextAdminJob: vi.fn(),
}));
vi.mock("@admitto/wallet", () => ({
  resolveWalletProvider: vi.fn(),
  refreshOneWalletPassStatus: vi.fn(),
}));

import { claimNextAdminJob } from "../src/claim-admin-job.js";
import { resolveWalletProvider, refreshOneWalletPassStatus } from "@admitto/wallet";
import {
  drainWalletRefreshStatusJobs,
  parseWalletRefreshStatusJobStaleRunningMs,
  reclaimStaleWalletRefreshStatusJobs,
  STALE_WALLET_REFRESH_STATUS_PENDING_ERROR,
  WALLET_REFRESH_STATUS_JOB_ALL_FAILED_ERROR,
  WALLET_REFRESH_STATUS_JOB_BAD_REQUEST_ERROR,
  WALLET_REFRESH_STATUS_JOB_GENERIC_ERROR,
  WALLET_REFRESH_STATUS_JOB_NOT_CONFIGURED_ERROR,
} from "../src/drain-wallet-refresh-status-jobs.js";

const fakeProvider = { provider: "stub" };

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-wrs-1",
    type: "wallet_refresh_status",
    status: "running",
    event_id: "evt-1",
    organization_id: "org-1",
    actor_user_id: null,
    session_id: null,
    client_timezone: null,
    result_json: { request: { eventId: "evt-1" } },
    ...overrides,
  };
}

const TARGETS = [
  { attendee_id: "att-1", provider_pass_id: "pc-1", user_provided_id: "admitto:evt-1:att-1" },
  { attendee_id: "att-2", provider_pass_id: "pc-2", user_provided_id: "admitto:evt-1:att-2" },
];

describe("drainWalletRefreshStatusJobs", () => {
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
    vi.mocked(refreshOneWalletPassStatus).mockReset().mockResolvedValue("refreshed" as never);
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
        findMany: vi.fn().mockResolvedValue(TARGETS),
      },
    };
  });

  it("claims and runs a pending job, refreshing every target and reporting progress", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);

    const result = await drainWalletRefreshStatusJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    expect(db.walletPass.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["active", "voided"] },
        provider_pass_id: { not: null },
        user_provided_id: { not: null },
        attendee: { event_id: "evt-1" },
      },
      select: { attendee_id: true, provider_pass_id: true, user_provided_id: true },
    });
    expect(refreshOneWalletPassStatus).toHaveBeenCalledTimes(2);
    expect(refreshOneWalletPassStatus).toHaveBeenCalledWith(
      db,
      { attendeeId: "att-1", providerPassId: "pc-1", userProvidedId: "admitto:evt-1:att-1" },
      fakeProvider,
    );
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0]).toMatchObject({
      where: { id: "job-wrs-1" },
      data: {
        status: "succeeded",
        result_json: { request: { eventId: "evt-1" }, refreshed: 2, skipped: 0, errored: 0 },
        error: null,
      },
    });
  });

  it("counts a 'conflict' outcome as skipped, not errored or refreshed", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(refreshOneWalletPassStatus)
      .mockResolvedValueOnce("refreshed" as never)
      .mockResolvedValueOnce("conflict" as never);

    await drainWalletRefreshStatusJobs(db as never);

    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0].data.result_json).toMatchObject({ refreshed: 1, skipped: 1, errored: 0 });
  });

  it("counts a rejected refresh (e.g. WalletStatusCheckInconclusiveError) as errored, without failing the whole batch when at least one target succeeds", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(refreshOneWalletPassStatus)
      .mockResolvedValueOnce("refreshed" as never)
      .mockRejectedValueOnce(new Error("wallet_status_check_inconclusive"));

    const result = await drainWalletRefreshStatusJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0].data.result_json).toMatchObject({ refreshed: 1, skipped: 0, errored: 1 });
  });

  it("marks the job failed when every target errors, with the 'all failed' message", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(refreshOneWalletPassStatus).mockRejectedValue(new Error("network down"));

    const result = await drainWalletRefreshStatusJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1, reclaimed: 0 });
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "failed",
    );
    expect(finalCall![0].data.error).toBe(WALLET_REFRESH_STATUS_JOB_ALL_FAILED_ERROR);
  });

  it("succeeds with an all-zero tally when the event has no wallet passes with a known device id", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    db.walletPass.findMany.mockResolvedValueOnce([]);

    const result = await drainWalletRefreshStatusJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    expect(refreshOneWalletPassStatus).not.toHaveBeenCalled();
    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "succeeded",
    );
    expect(finalCall![0].data.result_json).toMatchObject({ refreshed: 0, skipped: 0, errored: 0 });
  });

  it("fails the job with a bad-request message when result_json.request is malformed", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob({ result_json: { request: {} } }) as never);

    await drainWalletRefreshStatusJobs(db as never);

    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "failed",
    );
    expect(finalCall![0].data.error).toBe(WALLET_REFRESH_STATUS_JOB_BAD_REQUEST_ERROR);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("fails the job with a bad-request message when result_json itself is missing entirely", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob({ result_json: null }) as never);

    await drainWalletRefreshStatusJobs(db as never);

    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "failed",
    );
    expect(finalCall![0].data.error).toBe(WALLET_REFRESH_STATUS_JOB_BAD_REQUEST_ERROR);
  });

  it("fails the job with a bad-request message when result_json.request is present but not an object (e.g. a string)", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(
      baseJob({ result_json: { request: "not-an-object" } }) as never,
    );

    await drainWalletRefreshStatusJobs(db as never);

    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "failed",
    );
    expect(finalCall![0].data.error).toBe(WALLET_REFRESH_STATUS_JOB_BAD_REQUEST_ERROR);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("fails the job with a not-configured message when the event has no resolvable wallet provider", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    vi.mocked(resolveWalletProvider).mockReturnValueOnce(null as never);

    await drainWalletRefreshStatusJobs(db as never);

    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "failed",
    );
    expect(finalCall![0].data.error).toBe(WALLET_REFRESH_STATUS_JOB_NOT_CONFIGURED_ERROR);
  });

  it("maps an unexpected exception (e.g. a database error) to the generic error message and logs the real one server-side", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    db.walletPass.findMany.mockRejectedValueOnce(new Error("db exploded"));

    await drainWalletRefreshStatusJobs(db as never);

    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "failed",
    );
    expect(finalCall![0].data.error).toBe(WALLET_REFRESH_STATUS_JOB_GENERIC_ERROR);
    const [entry] = querySystemLogs({ source: "wallet", search: "wallet_refresh_status_job_failed" });
    expect(entry?.fields).toMatchObject({ job_id: "job-wrs-1", error: "db exploded" });
  });

  it("logs the raw value (not an Error instance) when something throws a non-Error, e.g. a plain string", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never);
    db.walletPass.findMany.mockRejectedValueOnce("plain string error");

    await drainWalletRefreshStatusJobs(db as never);

    const finalCall = db.adminJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "failed",
    );
    expect(finalCall![0].data.error).toBe(WALLET_REFRESH_STATUS_JOB_GENERIC_ERROR);
    const [entry] = querySystemLogs({ source: "wallet", search: "wallet_refresh_status_job_failed" });
    expect(entry?.fields).toMatchObject({ job_id: "job-wrs-1", error: "plain string error" });
  });

  it("claims up to the given limit in one drain call when options.limit is set", async () => {
    vi.mocked(claimNextAdminJob)
      .mockResolvedValueOnce(baseJob({ id: "job-wrs-1" }) as never)
      .mockResolvedValueOnce(baseJob({ id: "job-wrs-2" }) as never);

    const result = await drainWalletRefreshStatusJobs(db as never, { limit: 2 });

    expect(result).toEqual({ claimed: 2, succeeded: 2, failed: 0, reclaimed: 0 });
    expect(claimNextAdminJob).toHaveBeenCalledTimes(2);
  });

  it("does nothing when there's no pending job", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null);

    const result = await drainWalletRefreshStatusJobs(db as never);

    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
  });

  it("reclaims stale running/pending jobs via the shared reclaim helper, scoped to type=wallet_refresh_status", async () => {
    db.adminJob.findMany.mockResolvedValueOnce([{ id: "stale-1", status: "pending" }]);
    db.adminJob.updateMany.mockResolvedValueOnce({ count: 1 });
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null);

    const result = await drainWalletRefreshStatusJobs(db as never);

    expect(result.reclaimed).toBe(1);
    expect(db.adminJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "wallet_refresh_status" }) }),
    );
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "stale-1", status: "pending" },
      data: { status: "failed", error: STALE_WALLET_REFRESH_STATUS_PENDING_ERROR, finished_at: expect.any(Date) },
    });
  });

  it("reclaimStaleWalletRefreshStatusJobs and parseWalletRefreshStatusJobStaleRunningMs are independently usable (env override, fallback)", async () => {
    expect(parseWalletRefreshStatusJobStaleRunningMs({})).toBe(30 * 60 * 1000);
    expect(parseWalletRefreshStatusJobStaleRunningMs({ WALLET_REFRESH_STATUS_JOB_STALE_RUNNING_MS: "5000" })).toBe(
      5000,
    );
    expect(parseWalletRefreshStatusJobStaleRunningMs({ WALLET_REFRESH_STATUS_JOB_STALE_RUNNING_MS: "not-a-number" })).toBe(
      30 * 60 * 1000,
    );

    const result = await reclaimStaleWalletRefreshStatusJobs(db as never);
    expect(result).toEqual({ reclaimed: 0 });
  });
});
