// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchRegistrationAccessMethods, saveRegistrationAccessMethods } from "../../src/api/client.js";
import { accessMethodsDto } from "../settings/accessMethodsFixtures.js";

/** A fetch that answers once with `body` and `status`. */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const failureOf = (call: Promise<unknown>) => call.catch((err: unknown) => err);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRegistrationAccessMethods", () => {
  it("reads the ways in of the instance with the session, and hands the abort signal on", async () => {
    const fetchMock = stubFetch(200, accessMethodsDto(["link"]));
    const controller = new AbortController();

    const answer = await fetchRegistrationAccessMethods(controller.signal);

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/registration/access-methods");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "same-origin", signal: controller.signal });
    expect(answer).toEqual(accessMethodsDto(["link"]));
  });

  it("fails with the status and the code of a refusal", async () => {
    stubFetch(403, { error: "forbidden" });

    const failure = await failureOf(fetchRegistrationAccessMethods());

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("saveRegistrationAccessMethods", () => {
  it("PUTs the whole list of ways that are on as JSON with the proof of the same origin, and returns the answer", async () => {
    const fetchMock = stubFetch(200, accessMethodsDto(["link", "password"]));

    const answer = await saveRegistrationAccessMethods({ methods: ["link", "password"] });

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/registration/access-methods");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init).toMatchObject({ method: "PUT", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Origin: window.location.origin });
    expect(JSON.parse(String(init.body))).toEqual({ methods: ["link", "password"] });
    expect(answer).toEqual(accessMethodsDto(["link", "password"]));
  });

  it("sends an empty list as a list, which turns every way off", async () => {
    const fetchMock = stubFetch(200, accessMethodsDto());

    await saveRegistrationAccessMethods({ methods: [] });

    expect(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).toBe('{"methods":[]}');
  });

  it("fails with the status and the code of a body the server refuses", async () => {
    stubFetch(400, { error: "validation_failed", fields: ["methods"] });

    const failure = await failureOf(saveRegistrationAccessMethods({ methods: [] }));

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 400, code: "validation_failed" });
  });
});
