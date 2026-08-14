// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWalletMessage } from "../../src/api/client.js";

describe("sendWalletMessage (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the encoded wallet-message send endpoint and returns a dry-run count", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recipientCount: 3 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWalletMessage("evt with space", {
      filter: { type: "all" },
      text: "Hi",
      dryRun: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/wallet-message/send",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ filter: { type: "all" }, text: "Hi", dryRun: true }),
      }),
    );
    expect(result).toEqual({ recipientCount: 3 });
  });

  it("returns a queued jobId for a real (non-dry-run) send", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: "job-1", recipientCount: 2 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWalletMessage("evt-1", {
      filter: { type: "ticket_type", value: "vip" },
      text: "Doors open at 6pm.",
    });

    expect(result).toEqual({ jobId: "job-1", recipientCount: 2 });
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "validation_failed" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendWalletMessage("evt-1", { filter: { type: "all" }, text: "" }),
    ).rejects.toMatchObject({ status: 400, message: "validation_failed" });
  });
});
