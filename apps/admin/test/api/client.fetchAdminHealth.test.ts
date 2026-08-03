// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchAdminHealth, runAdminHealthLive } from "../../src/api/client.js";
import type { HealthReportDto } from "../../src/api/types.js";

const sample: HealthReportDto = {
  generated_at: "2026-08-03T12:00:00.000Z",
  version: "0.4.13",
  commit: "deadbee",
  overall: "ok",
  groups: [],
};

describe("fetchAdminHealth / runAdminHealthLive (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchAdminHealth GETs /api/admin/health with credentials and optional signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sample });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const result = await fetchAdminHealth(controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/health",
      expect.objectContaining({ credentials: "same-origin", signal: controller.signal }),
    );
    expect(result).toEqual(sample);
  });

  it("runAdminHealthLive POSTs /api/admin/health/live", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sample });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAdminHealthLive();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/health/live");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({}) });
    expect(result).toEqual(sample);
  });

  it("throws ApiError when the health endpoint rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ error: "forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAdminHealth()).rejects.toBeInstanceOf(ApiError);
  });
});
