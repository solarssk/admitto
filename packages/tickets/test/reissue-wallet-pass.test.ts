import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admitto/crypto", () => ({ decryptFromString: vi.fn() }));
vi.mock("../src/resolve.js", () => ({ resolveTicket: vi.fn() }));
vi.mock("../src/wallet-pass-input.js", () => ({
  resolveTicketPageDisplay: vi.fn(),
  buildWalletPassInput: vi.fn(),
}));
vi.mock("../src/ops-audit.js", () => ({ writeActionLog: vi.fn() }));

import { decryptFromString } from "@admitto/crypto";
import { WalletProviderError } from "@admitto/wallet";
import { resolveTicket } from "../src/resolve.js";
import { resolveTicketPageDisplay, buildWalletPassInput } from "../src/wallet-pass-input.js";
import { writeActionLog } from "../src/ops-audit.js";
import { reissueOneWalletPass } from "../src/reissue-wallet-pass.js";

const audit = { operator: "user-1", sessionId: "sess-1", timezone: "Europe/Warsaw" };
const target = { attendeeId: "att-1", providerPassId: "pc-1" };
const resolvedTicket = { attendee: { id: "att-1" }, event: { id: "evt-1" } };
const walletPassInput = { attendeeName: "Jane Doe" };

function makeDb() {
  const txWalletPassUpdate = vi.fn().mockResolvedValue({});
  const db = {
    attendee: { findUnique: vi.fn() },
    walletPass: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({ walletPass: { update: txWalletPassUpdate } });
    }),
  };
  return { db, txWalletPassUpdate };
}

describe("reissueOneWalletPass", () => {
  const provider = { updatePass: vi.fn() };

  beforeEach(() => {
    vi.mocked(decryptFromString).mockReset();
    vi.mocked(resolveTicket).mockReset();
    vi.mocked(resolveTicketPageDisplay).mockReset().mockResolvedValue(resolvedTicket as never);
    vi.mocked(buildWalletPassInput).mockReset().mockReturnValue(walletPassInput as never);
    vi.mocked(writeActionLog).mockReset().mockResolvedValue(undefined);
    provider.updatePass.mockReset();
  });

  it("skips when the attendee no longer exists", async () => {
    const { db } = makeDb();
    db.attendee.findUnique.mockResolvedValueOnce(null);

    const result = await reissueOneWalletPass(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("skipped");
    expect(resolveTicket).not.toHaveBeenCalled();
  });

  it("skips when the attendee has no qr_payload, external_uuid, or token to decrypt", async () => {
    const { db } = makeDb();
    db.attendee.findUnique.mockResolvedValueOnce({ qr_payload: null, external_uuid: null, token_enc: null });

    const result = await reissueOneWalletPass(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("skipped");
  });

  it("decrypts token_enc when qr_payload and external_uuid are both unset", async () => {
    const { db } = makeDb();
    db.attendee.findUnique.mockResolvedValueOnce({ qr_payload: null, external_uuid: null, token_enc: "enc-value" });
    vi.mocked(decryptFromString).mockReturnValueOnce("decrypted-token");
    vi.mocked(resolveTicket).mockResolvedValueOnce(null);

    await reissueOneWalletPass(db as never, "evt-1", target, provider as never, audit);

    expect(decryptFromString).toHaveBeenCalledWith("enc-value");
    expect(resolveTicket).toHaveBeenCalledWith("decrypted-token", db, { eventId: "evt-1" });
  });

  it("skips when the scanned value no longer resolves to a ticket", async () => {
    const { db } = makeDb();
    db.attendee.findUnique.mockResolvedValueOnce({ qr_payload: "qr-1", external_uuid: null, token_enc: null });
    vi.mocked(resolveTicket).mockResolvedValueOnce(null);

    const result = await reissueOneWalletPass(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("skipped");
    expect(buildWalletPassInput).not.toHaveBeenCalled();
  });

  it("pushes the rebuilt pass content, updates the WalletPass row, and logs the action", async () => {
    const { db, txWalletPassUpdate } = makeDb();
    db.attendee.findUnique.mockResolvedValueOnce({ qr_payload: "qr-1", external_uuid: null, token_enc: null });
    vi.mocked(resolveTicket).mockResolvedValueOnce(resolvedTicket as never);
    provider.updatePass.mockResolvedValueOnce({
      downloadUrl: "https://pc/download",
      appleUrl: "https://pc/apple",
      androidUrl: "https://pc/android",
    });

    const result = await reissueOneWalletPass(db as never, "evt-1", target, provider as never, audit);

    expect(result).toBe("reissued");
    expect(provider.updatePass).toHaveBeenCalledWith("pc-1", walletPassInput);
    expect(txWalletPassUpdate).toHaveBeenCalledWith({
      where: { attendee_id: "att-1" },
      data: {
        download_url: "https://pc/download",
        apple_url: "https://pc/apple",
        android_url: "https://pc/android",
        last_error_code: null,
        last_synced_at: expect.any(Date),
      },
    });
    expect(writeActionLog).toHaveBeenCalledWith(expect.anything(), {
      event_id: "evt-1",
      attendee_id: "att-1",
      action_type: "wallet_pass_reissued",
      audit,
      metadata: { bulk: true },
    });
  });

  it("records the provider's error code on the WalletPass row and rethrows", async () => {
    const { db } = makeDb();
    db.attendee.findUnique.mockResolvedValueOnce({ qr_payload: "qr-1", external_uuid: null, token_enc: null });
    vi.mocked(resolveTicket).mockResolvedValueOnce(resolvedTicket as never);
    const providerErr = new WalletProviderError("rate_limited", "PassCreator rate limit hit");
    provider.updatePass.mockRejectedValueOnce(providerErr);

    await expect(
      reissueOneWalletPass(db as never, "evt-1", target, provider as never, audit),
    ).rejects.toThrow(providerErr);

    expect(db.walletPass.update).toHaveBeenCalledWith({
      where: { attendee_id: "att-1" },
      data: { last_error_code: "rate_limited" },
    });
  });

  it("falls back to a generic error code for a non-WalletProviderError rejection", async () => {
    const { db } = makeDb();
    db.attendee.findUnique.mockResolvedValueOnce({ qr_payload: "qr-1", external_uuid: null, token_enc: null });
    vi.mocked(resolveTicket).mockResolvedValueOnce(resolvedTicket as never);
    provider.updatePass.mockRejectedValueOnce(new Error("network timeout"));

    await expect(
      reissueOneWalletPass(db as never, "evt-1", target, provider as never, audit),
    ).rejects.toThrow("network timeout");

    expect(db.walletPass.update).toHaveBeenCalledWith({
      where: { attendee_id: "att-1" },
      data: { last_error_code: "wallet_provider_rejected" },
    });
  });

  it("still surfaces the original provider error when the last_error_code bookkeeping write itself fails", async () => {
    const { db } = makeDb();
    db.attendee.findUnique.mockResolvedValueOnce({ qr_payload: "qr-1", external_uuid: null, token_enc: null });
    vi.mocked(resolveTicket).mockResolvedValueOnce(resolvedTicket as never);
    const providerErr = new Error("provider down");
    provider.updatePass.mockRejectedValueOnce(providerErr);
    db.walletPass.update.mockRejectedValueOnce(new Error("row locked"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      reissueOneWalletPass(db as never, "evt-1", target, provider as never, audit),
    ).rejects.toThrow("provider down");

    consoleSpy.mockRestore();
  });
});
