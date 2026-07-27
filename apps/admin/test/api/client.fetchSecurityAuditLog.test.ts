// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchSecurityAuditLog } from "../../src/api/client.js";

describe("fetchSecurityAuditLog (client) — query string building", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown = { entries: [], total: 0, page: 1, pageSize: 25 }) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("omits the query string when no params are given", async () => {
    const fetchMock = stubFetch();

    await fetchSecurityAuditLog({});

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/security-audit-log",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("includes event_type/page/pageSize when given", async () => {
    const fetchMock = stubFetch();

    await fetchSecurityAuditLog({ eventType: "auth.login.fail", page: 2, pageSize: 50 });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/security-audit-log?event_type=auth.login.fail&page=2&pageSize=50");
  });

  it("passes the abort signal through", async () => {
    const fetchMock = stubFetch();
    const controller = new AbortController();

    await fetchSecurityAuditLog({}, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/security-audit-log",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("resolves with the parsed entries, total, page, and pageSize", async () => {
    stubFetch({
      entries: [
        {
          id: "sal-1",
          event_type: "auth.login.success",
          user_id: "user-1",
          user_email: "admin@example.com",
          user_display_name: null,
          ip: "1.2.3.4",
          metadata: { userAgent: null },
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    const result = await fetchSecurityAuditLog({});

    expect(result.total).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.event_type).toBe("auth.login.success");
  });

  it("throws an ApiError when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSecurityAuditLog({})).rejects.toBeInstanceOf(ApiError);
  });
});
