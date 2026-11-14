// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchRegistrationSsoProvider, saveRegistrationSsoProvider } from "../../src/api/client.js";
import { ssoProviderDto } from "../settings/accessMethodsFixtures.js";

/** A fetch that answers once with `body` and `status`. */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn((_input: string | URL, _init?: RequestInit) =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, statusText: "", json: () => Promise.resolve(body) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const failureOf = (call: Promise<unknown>) => call.catch((err: unknown) => err);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRegistrationSsoProvider", () => {
  it("reads the choice, the providers and the return address with the session, and hands the abort signal on", async () => {
    const answer = ssoProviderDto({ provider_id: "idp-okta", state: "ready" });
    const fetchMock = stubFetch(200, answer);
    const controller = new AbortController();

    expect(await fetchRegistrationSsoProvider(controller.signal)).toEqual(answer);

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/registration/sso-provider");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "same-origin", signal: controller.signal });
  });

  it("fails with the status and the code of a refusal", async () => {
    stubFetch(403, { error: "forbidden" });

    const failure = await failureOf(fetchRegistrationSsoProvider());

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("saveRegistrationSsoProvider", () => {
  it("PUTs the provider as JSON with the proof of the same origin, and returns the answer", async () => {
    const answer = ssoProviderDto({ provider_id: "idp-okta", state: "ready" });
    const fetchMock = stubFetch(200, answer);

    expect(await saveRegistrationSsoProvider({ provider_id: "idp-okta" })).toEqual(answer);

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/registration/sso-provider");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init).toMatchObject({ method: "PUT", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Origin: window.location.origin });
    expect(JSON.parse(String(init.body))).toEqual({ provider_id: "idp-okta" });
  });

  it("sends null as null, which takes the choice away", async () => {
    const fetchMock = stubFetch(200, ssoProviderDto());

    await saveRegistrationSsoProvider({ provider_id: null });

    expect(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).toBe('{"provider_id":null}');
  });

  it("fails with the code of a provider that is not available", async () => {
    stubFetch(422, { error: "provider_not_available" });

    const failure = await failureOf(saveRegistrationSsoProvider({ provider_id: "nobody" }));

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 422, code: "provider_not_available" });
  });
});
