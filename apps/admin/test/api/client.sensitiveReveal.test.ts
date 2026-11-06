// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, revealAttendeeSensitive, revealRegistrationSensitive } from "../../src/api/client.js";
import type { SensitiveRevealDto } from "../../src/api/types.js";

/** A fetch that answers once with `body` and `status`. */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn((_input: string | URL, _init?: RequestInit) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      json: () => Promise.resolve(body),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const failureOf = (call: Promise<unknown>) => call.catch((err: unknown) => err);

const ANSWERS: SensitiveRevealDto = {
  guest: { allergy: "peanuts" },
  companions: [{ slot: 1, answers: { access: "ramp" } }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("revealAttendeeSensitive", () => {
  it("POSTs an empty JSON body with the proof of the same origin to the reveal of the attendee, and returns the answers", async () => {
    const fetchMock = stubFetch(200, ANSWERS);

    const answer = await revealAttendeeSensitive("evt 1", "att/1");

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/events/evt%201/attendees/att%2F1/reveal-sensitive");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Origin: window.location.origin });
    expect(JSON.parse(String(init.body))).toEqual({});
    expect(answer).toEqual(ANSWERS);
  });

  it.each([
    [403, "forbidden"],
    [409, "attendee_erased"],
    [429, "sensitive_reveal_limit"],
  ])("fails with the status and the code of a refusal (%i %s)", async (status, code) => {
    stubFetch(status, { error: code });

    const failure = await failureOf(revealAttendeeSensitive("evt-1", "att-1"));

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status, code });
  });
});

describe("revealRegistrationSensitive", () => {
  it("POSTs an empty JSON body with the proof of the same origin to the reveal of the request, and returns the answers", async () => {
    const fetchMock = stubFetch(200, ANSWERS);

    const answer = await revealRegistrationSensitive("evt 1", "reg/1");

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/events/evt%201/registrations/reg%2F1/reveal");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Origin: window.location.origin });
    expect(JSON.parse(String(init.body))).toEqual({});
    expect(answer).toEqual(ANSWERS);
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
    [429, "sensitive_reveal_limit"],
  ])("fails with the status and the code of a refusal (%i %s)", async (status, code) => {
    stubFetch(status, { error: code });

    const failure = await failureOf(revealRegistrationSensitive("evt-1", "reg-1"));

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status, code });
  });
});
