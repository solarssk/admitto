// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchRegistrationCounts, fetchRegistrations } from "../../src/api/client.js";

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: init.ok ?? true, status: init.status ?? 200, statusText: "", json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const PAGE = { items: [], total: 0, page: 1, pageSize: 25, selection_digest: null };

describe("fetchRegistrations (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the page and its size, with the session and the abort signal, and returns the whole answer", async () => {
    const fetchMock = stubFetch(PAGE);
    const controller = new AbortController();

    const result = await fetchRegistrations("evt-1", { page: 1, pageSize: 25 }, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/evt-1/registrations?page=1&pageSize=25", {
      credentials: "same-origin",
      signal: controller.signal,
    });
    expect(result).toEqual(PAGE);
  });

  it("leaves out a filter that is not set, so that the server selects every request", async () => {
    const fetchMock = stubFetch(PAGE);

    await fetchRegistrations("evt-1", { page: 3, pageSize: 50 });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/events/evt-1/registrations?page=3&pageSize=50");
    expect(String(url)).not.toContain("status");
    expect(String(url)).not.toContain("older_than");
    expect(String(url)).not.toContain("q=");
  });

  it("names the filters as the server reads them: status, older_than and q", async () => {
    const fetchMock = stubFetch(PAGE);

    await fetchRegistrations("evt-1", { page: 2, pageSize: 100, status: "pending", olderThan: "7d", q: "ann kow" });

    const [url] = fetchMock.mock.calls[0]!;
    const query = new URL(String(url), "https://admitto.example.com").searchParams;
    expect(Object.fromEntries(query)).toEqual({ page: "2", pageSize: "100", status: "pending", older_than: "7d", q: "ann kow" });
  });

  it("encodes what is typed in the search, so an address or a plus sign reaches the server as it was typed", async () => {
    const fetchMock = stubFetch(PAGE);

    await fetchRegistrations("evt-1", { page: 1, pageSize: 25, q: "ann+kow & co@example.com" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain(" ");
    expect(new URL(String(url), "https://admitto.example.com").searchParams.get("q")).toBe("ann+kow & co@example.com");
  });

  it("encodes the event in the path", async () => {
    const fetchMock = stubFetch(PAGE);

    await fetchRegistrations("evt one/2", { page: 1, pageSize: 25 });

    expect(fetchMock.mock.calls[0]![0]).toContain("/api/admin/events/evt%20one%2F2/registrations?");
  });

  it("fails with the status and the code of the server's answer", async () => {
    stubFetch({ error: "forbidden" }, { ok: false, status: 403 });

    const failure = await fetchRegistrations("evt-1", { page: 1, pageSize: 25 }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
    expect((failure as ApiError).code).toBe("forbidden");
  });
});

describe("fetchRegistrationCounts (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the numbers of the event, with the session and the abort signal, and returns the whole answer", async () => {
    const counts = { mode: "approval", by_status: { awaiting_email: 1, pending: 2, waitlist: 3, accepted: 4, rejected: 5 }, needs_decision: 2 };
    const fetchMock = stubFetch(counts);
    const controller = new AbortController();

    const result = await fetchRegistrationCounts("evt 1", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/evt%201/registrations/counts", {
      credentials: "same-origin",
      signal: controller.signal,
    });
    expect(result).toEqual(counts);
  });

  it("fails with the status of the server's answer", async () => {
    stubFetch({ error: "not_found" }, { ok: false, status: 404 });

    const failure = await fetchRegistrationCounts("evt-1").catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
  });
});
