// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, exportAuditLog, fetchAuditLog } from "../../src/api/client.js";

describe("fetchAuditLog (client) — query string building", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("omits the query string when no params are given", async () => {
    const fetchMock = stubFetch();

    await fetchAuditLog({});

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/audit-log",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("includes actionType/start/end when given", async () => {
    const fetchMock = stubFetch();

    await fetchAuditLog({ actionType: "login", start: "2026-01-01", end: "2026-01-31" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/audit-log?action_type=login&start=2026-01-01&end=2026-01-31");
  });

  it("includes eventId as event_id when given", async () => {
    const fetchMock = stubFetch();

    await fetchAuditLog({ eventId: "evt-1" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/audit-log?event_id=evt-1");
  });
});

describe("exportAuditLog (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Restores the HTMLAnchorElement.prototype.click spy below even if an assertion throws
    // first - a manual mockRestore() at the end of the test body would never run in that case,
    // leaving the prototype mocked for every test after it.
    vi.restoreAllMocks();
  });

  it("requests format=csv plus the current filters, then triggers a browser download", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["a,b\n1,2"], { type: "text/csv" }),
      headers: new Headers({ "Content-Disposition": 'attachment; filename="audit-log-2026-01-01.csv"' }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await exportAuditLog({ actionType: "event_created", eventId: "evt-1" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/audit-log/export?action_type=event_created&event_id=evt-1&format=csv");
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it("falls back to audit-log.csv when the response has no Content-Disposition header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["a,b\n1,2"], { type: "text/csv" }),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let downloadedFilename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "download", "set").mockImplementation(function (this: unknown, value: string) {
      downloadedFilename = value;
    });

    await exportAuditLog({});

    expect(downloadedFilename).toBe("audit-log.csv");
  });

  it("throws an ApiError with the server message when the export request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(exportAuditLog({})).rejects.toBeInstanceOf(ApiError);
  });
});
