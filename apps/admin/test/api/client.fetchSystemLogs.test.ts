// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchSystemLogs } from "../../src/api/client.js";

describe("fetchSystemLogs (client) — query string building", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown = { entries: [], cursor: 0 }) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("omits the query string when no params are given", async () => {
    const fetchMock = stubFetch();

    await fetchSystemLogs({});

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/system-logs",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("includes since/level/source/search when given", async () => {
    const fetchMock = stubFetch();

    await fetchSystemLogs({ since: 42, level: "error", source: "mail", search: "failed" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/system-logs?since=42&level=error&source=mail&search=failed");
  });

  it("passes the abort signal through", async () => {
    const fetchMock = stubFetch();
    const controller = new AbortController();

    await fetchSystemLogs({}, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/system-logs", expect.objectContaining({ signal: controller.signal }));
  });

  it("resolves with the parsed entries and cursor", async () => {
    stubFetch({ entries: [{ id: 1, ts: "2026-01-01T00:00:00.000Z", level: "info", source: "api", message: "http_request" }], cursor: 1 });

    const result = await fetchSystemLogs({});

    expect(result.cursor).toBe(1);
    expect(result.entries).toHaveLength(1);
  });

  it("throws an ApiError when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSystemLogs({})).rejects.toBeInstanceOf(ApiError);
  });
});
