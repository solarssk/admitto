import { beforeEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

vi.mock("../src/claim-admin-job.js", () => ({ claimNextAdminJob: vi.fn() }));
vi.mock("../src/void-wallet-pass-at-provider.js", () => ({ voidOneWalletPassAtProvider: vi.fn() }));
vi.mock("../src/remove-wallet-pass-from-provider.js", () => ({ removeOneWalletPassFromProvider: vi.fn() }));
vi.mock("@admitto/wallet", () => ({ resolveWalletProvider: vi.fn(), resolveConfiguredWalletProvider: vi.fn() }));

import { resolveConfiguredWalletProvider, resolveWalletProvider } from "@admitto/wallet";
import { claimNextAdminJob } from "../src/claim-admin-job.js";
import {
  drainWalletCleanupJobs,
  reclaimStaleWalletCleanupJobs,
  STALE_WALLET_CLEANUP_JOB_ERROR,
  STALE_WALLET_CLEANUP_PENDING_ERROR,
  WALLET_CLEANUP_JOB_ALL_FAILED_ERROR,
  WALLET_CLEANUP_JOB_BAD_REQUEST_ERROR,
  WALLET_CLEANUP_JOB_GENERIC_ERROR,
  WALLET_CLEANUP_JOB_NOT_CONFIGURED_ERROR,
  WALLET_REMOVE_INACTIVE_GRACE_MS,
} from "../src/drain-wallet-cleanup-jobs.js";
import { removeOneWalletPassFromProvider } from "../src/remove-wallet-pass-from-provider.js";
import { voidOneWalletPassAtProvider } from "../src/void-wallet-pass-at-provider.js";

const provider = { provider: "stub" };

const removeJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-remove-1",
  type: "wallet_remove_inactive",
  status: "running",
  event_id: "evt-1",
  organization_id: "org-1",
  actor_user_id: "user-1",
  session_id: "sess-1",
  client_timezone: "Europe/Warsaw",
  result_json: { request: { eventId: "evt-1" } },
  ...overrides,
});

/** A voided WalletPass row past its grace period, as loadGracedInactivePassTargets selects it. */
const votedRow = (n: number, overrides: Record<string, unknown> = {}) => ({
  attendee_id: `att-${n}`,
  provider_pass_id: `pc-${n}`,
  user_provided_id: `admitto:evt-1:att-${n}`,
  status: "voided",
  provider_commanded_at: null,
  provider_removed_at: null,
  ...overrides,
});

const voidJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  type: "wallet_void_active",
  status: "running",
  event_id: "evt-1",
  organization_id: "org-1",
  actor_user_id: "user-1",
  session_id: "sess-1",
  client_timezone: "Europe/Warsaw",
  result_json: { request: { eventId: "evt-1" } },
  ...overrides,
});

const passRow = (n: number) => ({
  attendee_id: `att-${n}`,
  provider_pass_id: `pc-${n}`,
  user_provided_id: `admitto:evt-1:att-${n}`,
  status: "active",
  provider_commanded_at: null,
  provider_removed_at: null,
});

describe("drainWalletCleanupJobs", () => {
  const db = {
    adminJob: { update: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    backgroundWorkerHeartbeat: { findUnique: vi.fn() },
    walletPass: { findMany: vi.fn(), findFirst: vi.fn() },
    event: { findUnique: vi.fn() },
  };

  /** The single terminal write of a job (status is only ever set to succeeded/failed once). */
  const terminalWrite = () =>
    [...db.adminJob.update.mock.calls, ...db.adminJob.updateMany.mock.calls]
      .map((call) => (call[0] as { data: Record<string, unknown> }).data)
      .find((data) => data.status === "succeeded" || data.status === "failed");

  beforeEach(() => {
    vi.mocked(claimNextAdminJob).mockReset().mockResolvedValue(null);
    vi.mocked(voidOneWalletPassAtProvider).mockReset().mockResolvedValue("voided");
    vi.mocked(removeOneWalletPassFromProvider).mockReset().mockResolvedValue("removed");
    vi.mocked(resolveConfiguredWalletProvider).mockReset().mockReturnValue(provider as never);
    vi.mocked(resolveWalletProvider).mockReset().mockReturnValue(provider as never);
    db.adminJob.update.mockReset().mockResolvedValue({});
    db.adminJob.findMany.mockReset().mockResolvedValue([]);
    db.adminJob.updateMany.mockReset().mockResolvedValue({ count: 1 });
    db.backgroundWorkerHeartbeat.findUnique.mockReset().mockResolvedValue({ last_beat_at: new Date() });
    db.walletPass.findMany.mockReset().mockResolvedValue([passRow(1), passRow(2), passRow(3)]);
    db.walletPass.findFirst.mockReset().mockResolvedValue({
      status: "voided",
      provider_removed_at: null,
      provider_commanded_at: null,
      user_provided_id: "admitto:evt-1:att-1",
    });
    db.event.findUnique.mockReset().mockResolvedValue({
      wallet_enabled: false,
      wallet_template_id: "tmpl-1",
      wallet_api_key_enc: "enc",
      wallet_field_mapping: null,
      wallet_provider_timezone: null,
    });
    resetSystemLogBufferForTest();
  });

  it("voids every active pass of the event, reports progress, and records the actor from the job", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob() as never);

    const result = await drainWalletCleanupJobs(db as never);

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, reclaimed: 0 });
    expect(claimNextAdminJob).toHaveBeenCalledWith(db, "wallet_void_active");
    expect(db.walletPass.findMany.mock.calls[0]![0].where).toEqual({
      status: "active",
      provider_pass_id: { not: null },
      provider_removed_at: null,
      attendee: { event_id: "evt-1" },
    });
    expect(voidOneWalletPassAtProvider).toHaveBeenCalledTimes(3);
    expect(voidOneWalletPassAtProvider).toHaveBeenCalledWith(
      db,
      "evt-1",
      expect.objectContaining({ attendeeId: "att-1", providerPassId: "pc-1", status: "active" }),
      provider,
      { operator: "user-1", sessionId: "sess-1", timezone: "Europe/Warsaw" },
      { eventWide: true },
    );
    expect(db.adminJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { progress_total: 3, progress_done: 0 },
    });
    expect(terminalWrite()).toMatchObject({
      status: "succeeded",
      result_json: { request: { eventId: "evt-1" }, done: 3, skipped: 0, errored: 0 },
      error: null,
    });
  });

  it("finalizes only a job that is still running, and leaves one that was reclaimed meanwhile as it is", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob() as never);
    db.adminJob.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await drainWalletCleanupJobs(db as never);

    expect(db.adminJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", status: "running" } }),
    );
    expect(result).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
  });

  it("runs a job that has no recorded actor, with an empty audit context", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(
      voidJob({ actor_user_id: null, session_id: null, client_timezone: null }) as never,
    );

    await drainWalletCleanupJobs(db as never);

    expect(voidOneWalletPassAtProvider).toHaveBeenCalledWith(
      db,
      "evt-1",
      expect.anything(),
      provider,
      { operator: undefined, sessionId: undefined, timezone: undefined },
      { eventWide: true },
    );
  });

  it("resolves the provider from the event's credentials alone, so it works with the Wallet switch off", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob() as never);

    await drainWalletCleanupJobs(db as never);

    expect(resolveConfiguredWalletProvider).toHaveBeenCalledTimes(1);
    expect(resolveWalletProvider).not.toHaveBeenCalled();
  });

  it("counts a skipped pass and a rejected one separately, and still succeeds when some passes worked", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob() as never);
    vi.mocked(voidOneWalletPassAtProvider)
      .mockResolvedValueOnce("voided")
      .mockResolvedValueOnce("skipped")
      .mockRejectedValueOnce(new Error("provider down"));

    const result = await drainWalletCleanupJobs(db as never);

    expect(result.succeeded).toBe(1);
    expect(terminalWrite()).toMatchObject({ status: "succeeded", result_json: { done: 1, skipped: 1, errored: 1 } });
    const [entry] = querySystemLogs({ source: "wallet", search: "wallet_cleanup_job_had_errors" });
    expect(entry?.fields).toMatchObject({ job_id: "job-1", job_type: "wallet_void_active", errored: 1 });
  });

  it("fails the job, with an operator-facing message, when every targeted pass errors", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob() as never);
    vi.mocked(voidOneWalletPassAtProvider).mockRejectedValue(new Error("provider down"));

    const result = await drainWalletCleanupJobs(db as never);

    expect(result).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
    expect(terminalWrite()).toMatchObject({ status: "failed", error: WALLET_CLEANUP_JOB_ALL_FAILED_ERROR });
  });

  it("succeeds with nothing to do when the event has no active pass left", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob() as never);
    db.walletPass.findMany.mockResolvedValueOnce([]);

    const result = await drainWalletCleanupJobs(db as never);

    expect(result.succeeded).toBe(1);
    expect(voidOneWalletPassAtProvider).not.toHaveBeenCalled();
    expect(terminalWrite()).toMatchObject({ result_json: { done: 0, skipped: 0, errored: 0 } });
  });

  it.each([
    ["an invalid request payload", { result_json: { request: {} } }, WALLET_CLEANUP_JOB_BAD_REQUEST_ERROR],
    ["a missing request payload", { result_json: null }, WALLET_CLEANUP_JOB_BAD_REQUEST_ERROR],
    ["an array payload", { result_json: [] }, WALLET_CLEANUP_JOB_BAD_REQUEST_ERROR],
    ["a non-object request", { result_json: { request: "evt-1" } }, WALLET_CLEANUP_JOB_BAD_REQUEST_ERROR],
  ])("fails with a fixed message for %s", async (_label, overrides, message) => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob(overrides) as never);

    await drainWalletCleanupJobs(db as never);

    expect(terminalWrite()).toMatchObject({ status: "failed", error: message });
    expect(voidOneWalletPassAtProvider).not.toHaveBeenCalled();
  });

  it("fails with 'not configured' when the event has no usable provider", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob() as never);
    vi.mocked(resolveConfiguredWalletProvider).mockReturnValue(null);

    await drainWalletCleanupJobs(db as never);

    expect(terminalWrite()).toMatchObject({ status: "failed", error: WALLET_CLEANUP_JOB_NOT_CONFIGURED_ERROR });
  });

  it("maps an unexpected exception to the generic message and logs the real one server-side", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob() as never);
    db.walletPass.findMany.mockRejectedValueOnce(new Error("db exploded"));

    await drainWalletCleanupJobs(db as never);

    expect(terminalWrite()).toMatchObject({ status: "failed", error: WALLET_CLEANUP_JOB_GENERIC_ERROR });
    const [entry] = querySystemLogs({ source: "wallet", search: "wallet_cleanup_job_failed" });
    expect(entry?.fields).toMatchObject({ job_id: "job-1", error: "db exploded" });
  });

  it("logs a non-Error throw by its value", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(voidJob() as never);
    db.walletPass.findMany.mockRejectedValueOnce("plain string error");

    await drainWalletCleanupJobs(db as never);

    const [entry] = querySystemLogs({ source: "wallet", search: "wallet_cleanup_job_failed" });
    expect(entry?.fields).toMatchObject({ error: "plain string error" });
  });

  it("stops claiming a type once its own per-type limit is reached", async () => {
    // limit is a budget PER type, not shared across types: wallet_void_active claims its 2
    // (job-1, job-2) and stops, then wallet_remove_inactive gets its own fresh budget of 2 and
    // claims the 3rd queued job before running out.
    vi.mocked(claimNextAdminJob)
      .mockResolvedValueOnce(voidJob({ id: "job-1" }) as never)
      .mockResolvedValueOnce(voidJob({ id: "job-2" }) as never)
      .mockResolvedValueOnce(voidJob({ id: "job-3" }) as never);

    const result = await drainWalletCleanupJobs(db as never, { limit: 2 });

    expect(result).toMatchObject({ claimed: 3, succeeded: 3 });
    expect(claimNextAdminJob).toHaveBeenCalledTimes(4);
  });

  it("does not let a steady stream of one job type starve the other at limit: 1 (regression)", async () => {
    // A shared claim counter across HANDLER_ENTRIES would let wallet_void_active consume the
    // worker's entire limit:1 budget every tick, so claimNextAdminJob would never even be called
    // for wallet_remove_inactive. Each type must get its own claim opportunity per drain call.
    vi.mocked(claimNextAdminJob).mockImplementation(async (_db, type) =>
      type === "wallet_void_active" ? ((voidJob() as never) as never) : ((removeJob() as never) as never),
    );

    const result = await drainWalletCleanupJobs(db as never, { limit: 1 });

    expect(claimNextAdminJob).toHaveBeenCalledWith(db, "wallet_void_active");
    expect(claimNextAdminJob).toHaveBeenCalledWith(db, "wallet_remove_inactive");
    expect(result).toMatchObject({ claimed: 2, succeeded: 2 });
  });

  it("reports an idle drain when nothing is pending", async () => {
    expect(await drainWalletCleanupJobs(db as never)).toEqual({ claimed: 0, succeeded: 0, failed: 0, reclaimed: 0 });
  });

  it("reclaims stale running and pending jobs across every clean-up type, each with the same fixed messages", async () => {
    db.adminJob.findMany.mockImplementation(async (args: unknown) => {
      const type = (args as { where: { type: string } }).where.type;
      return type === "wallet_void_active"
        ? [{ id: "stale-run", status: "running" }]
        : [{ id: "stale-pend", status: "pending" }];
    });
    db.adminJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await reclaimStaleWalletCleanupJobs(db as never);

    expect(result).toEqual({ reclaimed: 2 });
    expect(db.adminJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "wallet_void_active" }) }),
    );
    expect(db.adminJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "wallet_remove_inactive" }) }),
    );
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "stale-run", status: "running" },
      data: { status: "failed", error: STALE_WALLET_CLEANUP_JOB_ERROR, finished_at: expect.any(Date) },
    });
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "stale-pend", status: "pending" },
      data: { status: "failed", error: STALE_WALLET_CLEANUP_PENDING_ERROR, finished_at: expect.any(Date) },
    });
  });
});

describe("drainWalletCleanupJobs (wallet_remove_inactive)", () => {
  const db = {
    adminJob: { update: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    backgroundWorkerHeartbeat: { findUnique: vi.fn() },
    walletPass: { findMany: vi.fn(), findFirst: vi.fn() },
    event: { findUnique: vi.fn() },
  };

  const terminalWrite = () =>
    [...db.adminJob.update.mock.calls, ...db.adminJob.updateMany.mock.calls]
      .map((call) => (call[0] as { data: Record<string, unknown> }).data)
      .find((data) => data.status === "succeeded" || data.status === "failed");

  beforeEach(() => {
    vi.mocked(claimNextAdminJob).mockReset().mockResolvedValue(null);
    vi.mocked(removeOneWalletPassFromProvider).mockReset().mockResolvedValue("removed");
    vi.mocked(resolveConfiguredWalletProvider).mockReset().mockReturnValue(provider as never);
    vi.mocked(resolveWalletProvider).mockReset().mockReturnValue(provider as never);
    db.adminJob.update.mockReset().mockResolvedValue({});
    db.adminJob.findMany.mockReset().mockResolvedValue([]);
    db.adminJob.updateMany.mockReset().mockResolvedValue({ count: 1 });
    db.backgroundWorkerHeartbeat.findUnique.mockReset().mockResolvedValue({ last_beat_at: new Date() });
    db.walletPass.findMany.mockReset().mockResolvedValue([votedRow(1)]);
    db.walletPass.findFirst.mockReset().mockResolvedValue({
      status: "voided",
      voided_at: new Date(Date.now() - WALLET_REMOVE_INACTIVE_GRACE_MS - 60_000),
      provider_removed_at: null,
      provider_commanded_at: null,
      user_provided_id: "admitto:evt-1:att-1",
    });
    db.event.findUnique.mockReset().mockResolvedValue({
      wallet_enabled: false,
      wallet_template_id: "tmpl-1",
      wallet_api_key_enc: "enc",
      wallet_field_mapping: null,
      wallet_provider_timezone: null,
    });
  });

  it("queries both voided and expired passes past their own anchor's grace period, not the ones still within it", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null).mockResolvedValueOnce(removeJob() as never);

    const before = Date.now();
    await drainWalletCleanupJobs(db as never);
    const after = Date.now();

    expect(claimNextAdminJob).toHaveBeenCalledWith(db, "wallet_remove_inactive");
    const where = db.walletPass.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      provider_pass_id: { not: null },
      provider_removed_at: null,
      attendee: { event_id: "evt-1" },
    });
    expect(where.OR).toHaveLength(2);
    const [votedClause, expiredClause] = where.OR as [
      { status: string; voided_at: { lte: Date } },
      { status: string; expires_at: { lte: Date } },
    ];
    expect(votedClause.status).toBe("voided");
    expect(expiredClause.status).toBe("expired");
    for (const cutoff of [votedClause.voided_at.lte.getTime(), expiredClause.expires_at.lte.getTime()]) {
      expect(cutoff).toBeGreaterThanOrEqual(before - WALLET_REMOVE_INACTIVE_GRACE_MS);
      expect(cutoff).toBeLessThanOrEqual(after - WALLET_REMOVE_INACTIVE_GRACE_MS);
    }
  });

  it("re-reads each pass right before removing it, and passes the fresh state (not the stale listing) to removeOneWalletPassFromProvider", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null).mockResolvedValueOnce(removeJob() as never);
    const commandedAt = new Date("2026-09-28T10:00:00Z");
    db.walletPass.findFirst.mockResolvedValueOnce({
      status: "voided",
      voided_at: new Date(Date.now() - WALLET_REMOVE_INACTIVE_GRACE_MS - 60_000),
      provider_removed_at: null,
      provider_commanded_at: commandedAt,
      user_provided_id: "admitto:evt-1:att-1",
    });

    const result = await drainWalletCleanupJobs(db as never);

    expect(result).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(db.walletPass.findFirst).toHaveBeenCalledWith({
      where: { attendee_id: "att-1", provider_pass_id: "pc-1" },
      select: {
        status: true,
        voided_at: true,
        expires_at: true,
        provider_removed_at: true,
        provider_commanded_at: true,
        user_provided_id: true,
      },
    });
    expect(removeOneWalletPassFromProvider).toHaveBeenCalledWith(
      db,
      "evt-1",
      {
        attendeeId: "att-1",
        providerPassId: "pc-1",
        userProvidedId: "admitto:evt-1:att-1",
        status: "voided",
        providerCommandedAt: commandedAt,
        providerRemovedAt: null,
      },
      provider,
      { operator: "user-1", sessionId: "sess-1", timezone: "Europe/Warsaw" },
      { eventWide: true },
    );
    expect(terminalWrite()).toMatchObject({ status: "succeeded", result_json: { done: 1, skipped: 0, errored: 0 } });
  });

  it.each([
    ["restored back to active since the listing", { status: "active", provider_removed_at: null }],
    ["already removed by someone else since the listing", { status: "voided", provider_removed_at: new Date() }],
    ["gone since the listing (row not found)", null],
    [
      "restored and voided again since the listing, still within its own new grace period (regression)",
      { status: "voided", voided_at: new Date(), provider_removed_at: null },
    ],
  ])("skips a pass that was %s, without calling the provider", async (_label, row) => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null).mockResolvedValueOnce(removeJob() as never);
    db.walletPass.findFirst.mockResolvedValueOnce(row);

    await drainWalletCleanupJobs(db as never);

    expect(removeOneWalletPassFromProvider).not.toHaveBeenCalled();
    expect(terminalWrite()).toMatchObject({ result_json: { done: 0, skipped: 1, errored: 0 } });
  });

  it("still removes a pass that expired since the listing, past its own expires_at grace period", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null).mockResolvedValueOnce(removeJob() as never);
    db.walletPass.findFirst.mockResolvedValueOnce({
      status: "expired",
      expires_at: new Date(Date.now() - WALLET_REMOVE_INACTIVE_GRACE_MS - 60_000),
      provider_removed_at: null,
      provider_commanded_at: null,
      user_provided_id: "admitto:evt-1:att-1",
    });

    await drainWalletCleanupJobs(db as never);

    expect(removeOneWalletPassFromProvider).toHaveBeenCalledWith(
      db,
      "evt-1",
      expect.objectContaining({ status: "expired" }),
      provider,
      expect.anything(),
      { eventWide: true },
    );
  });

  it.each([
    ["expires_at is missing (no grace anchor)", { status: "expired", expires_at: null }],
    [
      "expires_at is still within its own grace period (regression)",
      { status: "expired", expires_at: new Date() },
    ],
  ])("skips an expired pass whose %s, without calling the provider", async (_label, overrides) => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null).mockResolvedValueOnce(removeJob() as never);
    db.walletPass.findFirst.mockResolvedValueOnce({
      provider_removed_at: null,
      provider_commanded_at: null,
      user_provided_id: "admitto:evt-1:att-1",
      ...overrides,
    });

    await drainWalletCleanupJobs(db as never);

    expect(removeOneWalletPassFromProvider).not.toHaveBeenCalled();
    expect(terminalWrite()).toMatchObject({ result_json: { done: 0, skipped: 1, errored: 0 } });
  });

  it("counts a non-'removed' outcome (already_removed/not_found/changed) as skipped, not an error", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(null).mockResolvedValueOnce(removeJob() as never);
    vi.mocked(removeOneWalletPassFromProvider).mockResolvedValueOnce("already_removed");

    await drainWalletCleanupJobs(db as never);

    expect(terminalWrite()).toMatchObject({ result_json: { done: 0, skipped: 1, errored: 0 } });
  });
});
