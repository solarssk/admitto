// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchRegistrationReturnAddresses } from "../../src/api/client.js";
import { ssoProviderDto } from "../settings/ssoProviderFixtures.js";

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

describe("fetchRegistrationReturnAddresses", () => {
  it("reads the return addresses with the session, and hands the abort signal on", async () => {
    const answer = ssoProviderDto();
    const fetchMock = stubFetch(200, answer);
    const controller = new AbortController();

    expect(await fetchRegistrationReturnAddresses(controller.signal)).toEqual(answer);

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/registration/sso-provider");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "same-origin", signal: controller.signal });
  });

  it("fails with the status and the code of a refusal", async () => {
    stubFetch(403, { error: "forbidden" });

    const failure = await failureOf(fetchRegistrationReturnAddresses());

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: "forbidden" });
  });
});
