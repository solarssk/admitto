// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, checkCustomDomain, saveCustomDomain } from "../../src/api/client.js";

/** A fetch that answers once with `body` and `status`. */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn((_input: string | URL, _init?: RequestInit) =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, statusText: "", json: () => Promise.resolve(body) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const STATE = {
  custom_domain: "summit.acme.example",
  custom_domain_status: "ok",
  custom_domain_check_result: "ok",
  custom_domain_verified_at: "2026-11-12T10:00:00.000Z",
  custom_domain_checked_at: "2026-11-12T10:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveCustomDomain", () => {
  it("PUTs the address as JSON with the proof of the same origin, at the address of the event, and returns the answer", async () => {
    const fetchMock = stubFetch(200, STATE);

    expect(await saveCustomDomain("evt/1", "summit.acme.example")).toEqual(STATE);

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/events/evt%2F1/registration/custom-domain");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init).toMatchObject({ method: "PUT", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Origin: window.location.origin });
    expect(JSON.parse(String(init.body))).toEqual({ custom_domain: "summit.acme.example" });
  });

  it("sends null as null, which takes the address away", async () => {
    const fetchMock = stubFetch(200, { ...STATE, custom_domain: null });
    await saveCustomDomain("evt-1", null);
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ custom_domain: null });
  });

  it.each([
    [409, "custom_domain_taken"],
    [422, "custom_domain_invalid"],
    [403, "forbidden"],
  ])("fails with %s and its code", async (status, code) => {
    stubFetch(status, { error: code });
    const failure = await saveCustomDomain("evt-1", "x.example").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status, code });
  });
});

describe("checkCustomDomain", () => {
  it("POSTs to the check of the event with the proof of the same origin, and returns the state", async () => {
    const fetchMock = stubFetch(200, STATE);

    expect(await checkCustomDomain("evt-1")).toEqual(STATE);

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/events/evt-1/registration/custom-domain/check");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ Origin: window.location.origin });
  });

  it("fails with the code of a refusal", async () => {
    stubFetch(429, { error: "domain_check_rate_limited" });
    const failure = await checkCustomDomain("evt-1").catch((err: unknown) => err);
    expect(failure).toMatchObject({ status: 429, code: "domain_check_rate_limited" });
  });
});
