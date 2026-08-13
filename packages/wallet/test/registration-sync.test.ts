import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveWalletProvider = vi.fn();
vi.mock("../src/resolve-provider.js", () => ({
  resolveWalletProvider: (...args: unknown[]) => mockResolveWalletProvider(...args),
}));

import { runWalletRegistrationSync, WALLET_SYNC_BATCH_LIMIT } from "../src/registration-sync.js";

function makeDb(rows: unknown[]) {
  return {
    walletPass: {
      findMany: vi.fn(async () => rows),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    attendee_id: "att-1",
    user_provided_id: "admitto:evt-1:att-1",
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

const STATUS = {
  appleActiveRegistrations: 1,
  appleInactiveRegistrations: 0,
  googleActiveRegistrations: 0,
  googleInactiveRegistrations: 0,
  firstDownloadedAt: "2026-08-01 10:00:00",
};

describe("runWalletRegistrationSync", () => {
  beforeEach(() => {
    mockResolveWalletProvider.mockReset();
  });

  it("does nothing when there are no stale candidates", async () => {
    const db = makeDb([]);
    const result = await runWalletRegistrationSync(db);
    expect(result).toEqual({ checked: 0, updated: 0, skippedNoProvider: 0, failed: 0 });
    expect(db.walletPass.update).not.toHaveBeenCalled();
  });

  it("resolves one provider per event and updates each pass with the fetched status", async () => {
    const rows = [row(), row({ attendee_id: "att-2", user_provided_id: "admitto:evt-1:att-2" })];
    const db = makeDb(rows);
    const getRegistrationStatus = vi.fn(async () => STATUS);
    mockResolveWalletProvider.mockReturnValue({ getRegistrationStatus });

    const result = await runWalletRegistrationSync(db);

    expect(mockResolveWalletProvider).toHaveBeenCalledTimes(1);
    expect(getRegistrationStatus).toHaveBeenCalledTimes(2);
    expect(db.walletPass.update).toHaveBeenCalledTimes(2);
    expect(db.walletPass.update.mock.calls[0][0]).toMatchObject({
      where: { attendee_id: "att-1" },
      data: {
        apple_active_registrations: 1,
        google_active_registrations: 0,
        first_downloaded_at: "2026-08-01 10:00:00",
      },
    });
    expect(result).toEqual({ checked: 2, updated: 2, skippedNoProvider: 0, failed: 0 });
  });

  it("counts passes as skippedNoProvider when the event has no resolvable provider, still bumping registration_checked_at so they don't starve future batches", async () => {
    const db = makeDb([row(), row({ attendee_id: "att-2", user_provided_id: "admitto:evt-1:att-2" })]);
    mockResolveWalletProvider.mockReturnValue(null);

    const result = await runWalletRegistrationSync(db);

    expect(db.walletPass.update).not.toHaveBeenCalled();
    expect(db.walletPass.updateMany).toHaveBeenCalledWith({
      where: { attendee_id: { in: ["att-1", "att-2"] } },
      data: { registration_checked_at: expect.any(Date) },
    });
    expect(result).toEqual({ checked: 0, updated: 0, skippedNoProvider: 2, failed: 0 });
  });

  it("counts a getRegistrationStatus failure as failed without throwing or blocking its siblings", async () => {
    const rows = [row(), row({ attendee_id: "att-2", user_provided_id: "admitto:evt-1:att-2" })];
    const db = makeDb(rows);
    const getRegistrationStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(STATUS);
    mockResolveWalletProvider.mockReturnValue({ getRegistrationStatus });

    const result = await runWalletRegistrationSync(db);

    expect(result).toEqual({ checked: 2, updated: 1, skippedNoProvider: 0, failed: 1 });
  });

  it("still bumps registration_checked_at on a failed row (only) - otherwise it would starve every future batch", async () => {
    const db = makeDb([row()]);
    const getRegistrationStatus = vi.fn().mockRejectedValueOnce(new Error("network down"));
    mockResolveWalletProvider.mockReturnValue({ getRegistrationStatus });

    await runWalletRegistrationSync(db);

    expect(db.walletPass.update).toHaveBeenCalledWith({
      where: { attendee_id: "att-1" },
      data: { registration_checked_at: expect.any(Date) },
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
    const getRegistrationStatus = vi.fn(async () => null);
    mockResolveWalletProvider.mockReturnValue({ getRegistrationStatus });

    await runWalletRegistrationSync(db);

    expect(mockResolveWalletProvider).toHaveBeenCalledTimes(2);
  });

  it("writes all-null registration fields (but still stamps registration_checked_at) when the provider returns no match", async () => {
    const db = makeDb([row()]);
    const getRegistrationStatus = vi.fn(async () => null);
    mockResolveWalletProvider.mockReturnValue({ getRegistrationStatus });

    await runWalletRegistrationSync(db);

    const call = db.walletPass.update.mock.calls[0][0];
    expect(call.data.apple_active_registrations).toBeNull();
    expect(call.data.first_downloaded_at).toBeNull();
    expect(call.data.registration_checked_at).toBeInstanceOf(Date);
  });

  it("queries only active/voided passes with a known provider_pass_id, capped at WALLET_SYNC_BATCH_LIMIT", async () => {
    const db = makeDb([]);
    await runWalletRegistrationSync(db, 1_000_000);

    const args = db.walletPass.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ in: ["active", "voided"] });
    expect(args.where.provider_pass_id).toEqual({ not: null });
    expect(args.take).toBe(WALLET_SYNC_BATCH_LIMIT);
  });
});
