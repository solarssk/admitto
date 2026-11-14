// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  acceptRegistrations,
  deleteRegistrations,
  deleteRegistrationsByFilter,
  fetchRegistration,
  rejectRegistrations,
  retryRegistrationMails,
} from "../../src/api/client.js";

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: init.ok ?? true, status: init.status ?? 200, statusText: "", json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The URL and the request of the one call a function made. */
function theCall(fetchMock: ReturnType<typeof stubFetch>): { url: string; init: RequestInit; body: unknown } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined };
}

const URL_OF_EVENT = "/api/admin/events/evt%201/registrations";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRegistration (client)", () => {
  it("reads one request of the event, with the session and the abort signal, and returns the whole answer", async () => {
    const record = { id: "reg/1", status: "pending", mails: [] };
    const fetchMock = stubFetch(record);
    const controller = new AbortController();

    const result = await fetchRegistration("evt 1", "reg/1", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(`${URL_OF_EVENT}/reg%2F1`, { credentials: "same-origin", signal: controller.signal });
    expect(result).toEqual(record);
  });

  it("fails with the status and the code of the server's answer", async () => {
    stubFetch({ error: "not_found" }, { ok: false, status: 404 });

    const failure = await fetchRegistration("evt-1", "gone").catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 404, code: "not_found" });
  });
});

describe.each([
  ["acceptRegistrations", "accept", (ids: string[]) => acceptRegistrations("evt 1", ids), { ids: ["a", "b"] }],
  ["rejectRegistrations", "reject", (ids: string[]) => rejectRegistrations("evt 1", ids, false), { ids: ["a", "b"], notify: false }],
  ["retryRegistrationMails", "retry-mail", (ids: string[]) => retryRegistrationMails("evt 1", ids), { ids: ["a", "b"] }],
  ["deleteRegistrations", "delete", (ids: string[]) => deleteRegistrations("evt 1", ids), { ids: ["a", "b"] }],
] as const)("%s (client)", (_name, path, call, expectedBody) => {
  it(`POSTs the ids to ${path} of the encoded event, from this site, as JSON, and returns the whole answer`, async () => {
    const answer = { results: [{ id: "a", outcome: "ok" }] };
    const fetchMock = stubFetch(answer);

    const result = await call(["a", "b"]);

    const { url, init, body } = theCall(fetchMock);
    expect(url).toBe(`${URL_OF_EVENT}/${path}`);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Origin: window.location.origin });
    expect(body).toEqual(expectedBody);
    expect(result).toEqual(answer);
  });

  it("fails with the status and the code of the server's answer, and with no ids of its own to show", async () => {
    stubFetch({ error: "event_archived" }, { ok: false, status: 403 });

    const failure = await call(["a"]).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: "event_archived" });
  });
});

describe("rejectRegistrations (client)", () => {
  it("tells the server whether the guests are to be mailed, and sends it as asked: on, or off", async () => {
    const on = stubFetch({ results: [] });
    await rejectRegistrations("evt-1", ["a"], true);
    expect(theCall(on).body).toEqual({ ids: ["a"], notify: true });

    const off = stubFetch({ results: [] });
    await rejectRegistrations("evt-1", ["a"], false);
    expect(theCall(off).body).toEqual({ ids: ["a"], notify: false });
  });
});

describe("deleteRegistrationsByFilter (client)", () => {
  it("POSTs the filter of the list with its total and the name the list gave the requests, in the words the server reads", async () => {
    const answer = { results: [], deleted: 3, attendees_erased: 1, wallet_pending: 0 };
    const fetchMock = stubFetch(answer);

    const result = await deleteRegistrationsByFilter("evt 1", {
      status: "rejected",
      olderThan: "90d",
      q: "ann kow",
      expected: 3,
      selectionDigest: "a".repeat(64),
    });

    const { url, init, body } = theCall(fetchMock);
    expect(url).toBe(`${URL_OF_EVENT}/delete-by-filter`);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(body).toEqual({ status: "rejected", older_than: "90d", q: "ann kow", expected: 3, selection_digest: "a".repeat(64) });
    expect(result).toEqual(answer);
  });

  it("leaves out a part of the filter that is not set, so that the server does not read it as an empty one", async () => {
    const fetchMock = stubFetch({ results: [], deleted: 0, attendees_erased: 0, wallet_pending: 0 });

    await deleteRegistrationsByFilter("evt-1", { olderThan: "30d", expected: 0, selectionDigest: "b".repeat(64) });

    expect(theCall(fetchMock).body).toEqual({ older_than: "30d", expected: 0, selection_digest: "b".repeat(64) });
  });

  it.each([
    ["registration_count_changed", 409],
    ["registration_selection_changed", 409],
    ["too_many_registrations", 422],
    ["too_many_accepted", 422],
  ])("fails with %s as the code, so that the screen can say it in its own words", async (code, status) => {
    stubFetch({ error: code, matched: 7, limit: 500 }, { ok: false, status });

    const failure = await deleteRegistrationsByFilter("evt-1", { status: "rejected", expected: 3, selectionDigest: "c".repeat(64) }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status, code });
  });
});

describe("the seats of a 409 not_enough_seats", () => {
  it("are on the error: the free seats and the seats the guests need", async () => {
    stubFetch({ error: "not_enough_seats", free: 2, needed: 10 }, { ok: false, status: 409 });

    const failure = await acceptRegistrations("evt-1", ["a"]).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, code: "not_enough_seats", seats: { free: 2, needed: 10 } });
  });

  it("are not on the error when the server gave no numbers, half of them, or numbers that are not seats", async () => {
    for (const body of [
      { error: "not_enough_seats" },
      { error: "not_enough_seats", free: 2 },
      { error: "not_enough_seats", free: -1, needed: 3 },
      { error: "not_enough_seats", free: "2", needed: 3 },
      { error: "not_enough_seats", free: 1.5, needed: 3 },
    ]) {
      stubFetch(body, { ok: false, status: 409 });
      const failure = await acceptRegistrations("evt-1", ["a"]).catch((err: unknown) => err);
      expect((failure as ApiError).seats).toBeUndefined();
    }
  });

  it("are read for that code only: another error with the same fields has no seats", async () => {
    stubFetch({ error: "event_full", free: 2, needed: 10 }, { ok: false, status: 409 });

    const failure = await acceptRegistrations("evt-1", ["a"]).catch((err: unknown) => err);

    expect((failure as ApiError).seats).toBeUndefined();
  });

  it("are zero free seats and zero needed, as numbers", async () => {
    stubFetch({ error: "not_enough_seats", free: 0, needed: 0 }, { ok: false, status: 409 });

    const failure = await acceptRegistrations("evt-1", ["a"]).catch((err: unknown) => err);

    expect((failure as ApiError).seats).toEqual({ free: 0, needed: 0 });
  });
});
