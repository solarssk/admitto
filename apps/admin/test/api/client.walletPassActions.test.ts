// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteWalletPass, reissueWalletPass, restoreWalletPass, voidWalletPass } from "../../src/api/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voidWalletPass (client) — thin wrapper coverage", () => {
  it("POSTs the encoded wallet/void endpoint for the attendee", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "voided" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await voidWalletPass("evt with space", "att-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/att-1/wallet/void",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(result).toEqual({ status: "voided" });
  });
});

describe("restoreWalletPass (client) — thin wrapper coverage", () => {
  it("POSTs the encoded wallet/restore endpoint for the attendee", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "active" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await restoreWalletPass("evt-1", "att-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/attendees/att-1/wallet/restore",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(result).toEqual({ status: "active" });
  });
});

describe("reissueWalletPass (client) — thin wrapper coverage", () => {
  it("POSTs the encoded wallet/reissue endpoint for the attendee", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "active" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await reissueWalletPass("evt-1", "att-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/attendees/att-1/wallet/reissue",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(result).toEqual({ status: "active" });
  });
});

describe("deleteWalletPass (client) — thin wrapper coverage", () => {
  it("POSTs the encoded wallet/delete endpoint for the attendee", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteWalletPass("evt-1", "att-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/attendees/att-1/wallet/delete",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(result).toEqual({ deleted: true });
  });
});
