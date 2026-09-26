import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveWalletProvider = vi.fn();
vi.mock("../src/resolve-provider.js", () => ({
  resolveWalletProvider: (...args: unknown[]) => mockResolveWalletProvider(...args),
}));

import { runWalletRegistrationSync, WALLET_SYNC_BATCH_LIMIT } from "../src/registration-sync.js";
import { walletSnapshot } from "./snapshot-fixture.js";

function makeDb(rows: unknown[]) {
  return {
    walletPass: {
      findMany: vi.fn(async () => rows),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function row(overrides: Record<string, unknown> = {}) {
  // Each attendee gets its own provider id, like real rows (a second row must not share one).
  const attendeeId = typeof overrides["attendee_id"] === "string" ? overrides["attendee_id"] : "att-1";
  return {
    attendee_id: attendeeId,
    provider_pass_id: `pc-${attendeeId}`,
    user_provided_id: `admitto:evt-1:${attendeeId}`,
    status: "active",
    provider_commanded_at: null,
    provider_removed_at: null,
    attendee: {
      event: {
        id: "evt-1",
        wallet_enabled: true,
        wallet_template_id: "tmpl-1",
        wallet_api_key_enc: "enc-key",
      },
    },
    ...overrides,
  };
}

const POLICY = { observationStalenessWindowMs: 10 * 60 * 1000 };

const SNAPSHOT = walletSnapshot(
  { appleActive: 1, samsungActive: 3, samsungInactive: 1 },
  { firstDownloadedAt: "2026-08-01 10:00:00" },
);

describe("runWalletRegistrationSync", () => {
  beforeEach(() => {
    mockResolveWalletProvider.mockReset();
  });

  it("does nothing when there are no stale candidates", async () => {
    const db = makeDb([]);
    const result = await runWalletRegistrationSync(db);
    expect(result).toEqual({ checked: 0, updated: 0, skippedNoProvider: 0, failed: 0 });
    expect(db.walletPass.updateMany).not.toHaveBeenCalled();
  });

  it("resolves one provider per event and updates each pass with the fetched status", async () => {
    const rows = [row(), row({ attendee_id: "att-2", user_provided_id: "admitto:evt-1:att-2" })];
    const db = makeDb(rows);
    const getPassSnapshot = vi.fn(async () => SNAPSHOT);
    mockResolveWalletProvider.mockReturnValue({ getPassSnapshot, consistencyPolicy: POLICY });

    const result = await runWalletRegistrationSync(db);

    expect(mockResolveWalletProvider).toHaveBeenCalledTimes(1);
    expect(getPassSnapshot).toHaveBeenCalledTimes(2);
    expect(getPassSnapshot).toHaveBeenCalledWith({ providerPassId: "pc-att-1", userProvidedId: "admitto:evt-1:att-1" });
    expect(db.walletPass.updateMany).toHaveBeenCalledTimes(2);
    expect(db.walletPass.updateMany.mock.calls[0][0]).toMatchObject({
      // The exact pass identity the snapshot was read for, not just the attendee.
      where: { attendee_id: "att-1", provider_pass_id: "pc-att-1", user_provided_id: "admitto:evt-1:att-1" },
      data: {
        apple_active_registrations: 1,
        google_active_registrations: 0,
        samsung_active_registrations: 3,
        samsung_inactive_registrations: 1,
        first_downloaded_at: "2026-08-01 10:00:00",
      },
    });
    expect(result).toEqual({ checked: 2, updated: 2, skippedNoProvider: 0, failed: 0 });
  });

  it("counts passes as skippedNoProvider when the event has no resolvable provider, bumping registration_sync_attempted_at (not registration_checked_at) so they don't starve future batches", async () => {
    const db = makeDb([row(), row({ attendee_id: "att-2", user_provided_id: "admitto:evt-1:att-2" })]);
    mockResolveWalletProvider.mockReturnValue(null);

    const result = await runWalletRegistrationSync(db);

    expect(db.walletPass.updateMany).toHaveBeenCalledTimes(1);
    expect(db.walletPass.updateMany).toHaveBeenCalledWith({
      where: { attendee_id: { in: ["att-1", "att-2"] } },
      data: { registration_sync_attempted_at: expect.any(Date) },
    });
    expect(result).toEqual({ checked: 0, updated: 0, skippedNoProvider: 2, failed: 0 });
  });

  it("counts a getPassSnapshot failure as failed without throwing or blocking its siblings", async () => {
    const rows = [row(), row({ attendee_id: "att-2", user_provided_id: "admitto:evt-1:att-2" })];
    const db = makeDb(rows);
    const getPassSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(SNAPSHOT);
    mockResolveWalletProvider.mockReturnValue({ getPassSnapshot, consistencyPolicy: POLICY });

    const result = await runWalletRegistrationSync(db);

    expect(result).toEqual({ checked: 2, updated: 1, skippedNoProvider: 0, failed: 1 });
  });

  it("counts a non-Error provider rejection as failed without blocking its siblings", async () => {
    const rows = [row(), row({ attendee_id: "att-2", user_provided_id: "admitto:evt-1:att-2" })];
    const db = makeDb(rows);
    const getPassSnapshot = vi
      .fn()
      .mockRejectedValueOnce(Object.create(null))
      .mockResolvedValueOnce(SNAPSHOT);
    mockResolveWalletProvider.mockReturnValue({ getPassSnapshot, consistencyPolicy: POLICY });

    const result = await runWalletRegistrationSync(db);

    expect(result).toEqual({ checked: 2, updated: 1, skippedNoProvider: 0, failed: 1 });
  });

  it("bumps registration_sync_attempted_at (only) on a failed row, leaving registration_checked_at untouched so the UI's last-known-good time doesn't drift on a failing retry", async () => {
    const db = makeDb([row()]);
    const getPassSnapshot = vi.fn().mockRejectedValueOnce(new Error("network down"));
    mockResolveWalletProvider.mockReturnValue({ getPassSnapshot, consistencyPolicy: POLICY });

    await runWalletRegistrationSync(db);

    expect(db.walletPass.updateMany).toHaveBeenCalledWith({
      where: { attendee_id: "att-1", provider_pass_id: "pc-att-1", user_provided_id: "admitto:evt-1:att-1" },
      data: { registration_sync_attempted_at: expect.any(Date) },
    });
  });

  it("groups candidates by event, resolving the provider once per event not once per pass", async () => {
    const rows = [
      row(),
      row({
        attendee_id: "att-2",
        user_provided_id: "admitto:evt-2:att-2",
        attendee: {
          event: {
            id: "evt-2",
            wallet_enabled: true,
            wallet_template_id: "tmpl-2",
            wallet_api_key_enc: "enc-2",
          },
        },
      }),
    ];
    const db = makeDb(rows);
    const getPassSnapshot = vi.fn(async () => null);
    mockResolveWalletProvider.mockReturnValue({ getPassSnapshot, consistencyPolicy: POLICY });

    await runWalletRegistrationSync(db);

    expect(mockResolveWalletProvider).toHaveBeenCalledTimes(2);
  });

  it("preserves whatever registration counts and registration_checked_at a pass already has, only bumping registration_sync_attempted_at, when the provider finds no matching pass", async () => {
    // 2026-09-03 incident: this used to write every registration column to null and advance
    // registration_checked_at on a provider "no match" result, treating it as a confirmed zero.
    // PassCreator's own lookup is a search, not a get-by-ID - a pass that has genuinely vanished
    // at the provider (deleted directly there, bypassing Admitto, or pruned by the provider's own
    // data-retention rules while the rest of the account is still reachable) makes that search
    // return a normal, non-error empty result, indistinguishable in shape from "never installed
    // anywhere". Writing that as all-null silently erased the historical fact that the pass had
    // really been confirmed installed at some point. A "no match" read is now treated exactly like
    // a hard provider error (see the test above): the write contains only
    // registration_sync_attempted_at, so a real DB row's own existing counts are left completely
    // untouched (Prisma's partial update only writes the keys present here).
    const db = makeDb([row()]);
    const getPassSnapshot = vi.fn(async () => null);
    mockResolveWalletProvider.mockReturnValue({ getPassSnapshot, consistencyPolicy: POLICY });

    await runWalletRegistrationSync(db);

    expect(db.walletPass.updateMany).toHaveBeenCalledWith({
      where: { attendee_id: "att-1", provider_pass_id: "pc-att-1", user_provided_id: "admitto:evt-1:att-1" },
      data: { registration_sync_attempted_at: expect.any(Date) },
    });
  });

  it("skips a row quietly, without failing, when its pass was replaced while the provider call was in flight - the write matches on the pass identity, so the new pass's row is left alone", async () => {
    const db = makeDb([row()]);
    // The row now holds a different provider_pass_id, so the conditioned write matches nothing.
    db.walletPass.updateMany.mockResolvedValue({ count: 0 });
    const getPassSnapshot = vi.fn(async () => SNAPSHOT);
    mockResolveWalletProvider.mockReturnValue({ getPassSnapshot, consistencyPolicy: POLICY });

    const result = await runWalletRegistrationSync(db);

    expect(result).toMatchObject({ checked: 1, failed: 0 });
    expect(db.walletPass.updateMany.mock.calls[0][0].where).toMatchObject({ provider_pass_id: "pc-att-1" });
  });

  it("queries only active passes of non-archived events, with a known provider identity, capped at WALLET_SYNC_BATCH_LIMIT, staleness keyed off registration_sync_attempted_at", async () => {
    const db = makeDb([]);
    await runWalletRegistrationSync(db, 1_000_000);

    const args = db.walletPass.findMany.mock.calls[0][0];
    // Voided and expired are Admitto's own recorded states: nothing the provider says can change
    // them, so they are never polled again.
    expect(args.where.status).toBe("active");
    expect(args.where.provider_pass_id).toEqual({ not: null });
    expect(args.where.user_provided_id).toEqual({ not: null });
    // Also part of WalletPass_registration_sync_pending_idx's predicate - the query has to imply it
    // for Postgres to use the partial index at all.
    expect(args.where.provider_removed_at).toBeNull();
    expect(args.where.attendee).toEqual({ event: { archived_at: null } });
    expect(args.select).toMatchObject({
      provider_pass_id: true,
      status: true,
      provider_commanded_at: true,
      provider_removed_at: true,
    });
    expect(args.where.OR).toEqual([
      { registration_sync_attempted_at: null },
      { registration_sync_attempted_at: { lt: expect.any(Date) } },
    ]);
    expect(args.orderBy).toEqual({ registration_sync_attempted_at: { sort: "asc", nulls: "first" } });
    expect(args.take).toBe(WALLET_SYNC_BATCH_LIMIT);
  });

  it("records a pass the provider now reports voided, in the same write as its newest registration counts", async () => {
    const db = makeDb([row()]);
    const voided = walletSnapshot(
      { appleActive: 2 },
      { validity: { voided: true, expirationRaw: null, expiresAt: null } },
    );
    const getPassSnapshot = vi.fn(async () => voided);
    mockResolveWalletProvider.mockReturnValue({ getPassSnapshot, consistencyPolicy: POLICY });

    const result = await runWalletRegistrationSync(db);

    expect(result).toEqual({ checked: 1, updated: 1, skippedNoProvider: 0, failed: 0 });
    expect(db.walletPass.updateMany).toHaveBeenCalledTimes(1);
    expect(db.walletPass.updateMany.mock.calls[0][0]).toMatchObject({
      where: { status: "active", provider_commanded_at: null, provider_removed_at: null },
      data: { status: "voided", voided_at: expect.any(Date), apple_active_registrations: 2 },
    });
  });

  it("does not turn a stale 'voided' read into a void right after Admitto's own Restore", async () => {
    const commandedAt = new Date(Date.now() - 60_000);
    const db = makeDb([row({ provider_commanded_at: commandedAt })]);
    const stale = walletSnapshot(
      { appleActive: 1 },
      { observedAt: new Date(), validity: { voided: true, expirationRaw: null, expiresAt: null } },
    );
    const getPassSnapshot = vi.fn(async () => stale);
    mockResolveWalletProvider.mockReturnValue({ getPassSnapshot, consistencyPolicy: POLICY });

    await runWalletRegistrationSync(db);

    expect(db.walletPass.updateMany.mock.calls[0][0].data).not.toHaveProperty("status");
  });
});
