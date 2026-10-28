// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, clearRegistrationPassword, fetchRegistrationSettings, saveRegistrationSettings, setRegistrationPassword } from "../../src/api/client.js";
import { settings } from "../registration/accessData.js";

/** A fetch that answers once with `body` and `status`; a 204 has no body to read, and asking for one fails the test. */
function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => {
      if (body === undefined) throw new Error("a response without a body was read as JSON");
      return body;
    },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const failureOf = (call: Promise<unknown>) => call.catch((err: unknown) => err);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRegistrationSettings", () => {
  it("reads the settings of the event at its own address, with the session, and hands the abort signal on", async () => {
    const fetchMock = stubFetch(200, settings({ mode: "approval" }));
    const controller = new AbortController();

    const read = await fetchRegistrationSettings("evt one/2", controller.signal);

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/events/evt%20one%2F2/registration/settings");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "same-origin", signal: controller.signal });
    expect(read.mode).toBe("approval");
  });

  it("fails with the status and the code of a refusal", async () => {
    stubFetch(403, { error: "forbidden" });

    const failure = await failureOf(fetchRegistrationSettings("evt-1"));

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("saveRegistrationSettings", () => {
  it("PUTs the patch, and only the patch, as JSON with the proof of the same origin, and returns the answer", async () => {
    const fetchMock = stubFetch(200, settings({ mode: "automatic" }));

    const answer = await saveRegistrationSettings("evt-1", { mode: "automatic", ask_company: true });

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/events/evt-1/registration/settings");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init).toMatchObject({ method: "PUT", credentials: "same-origin" });
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Origin: window.location.origin });
    expect(JSON.parse(String(init.body))).toEqual({ mode: "automatic", ask_company: true });
    expect(answer.mode).toBe("automatic");
  });

  it("sends turning registration off as a null mode, which is not the same as leaving it out", async () => {
    const fetchMock = stubFetch(200, settings());

    await saveRegistrationSettings("evt-1", { mode: null });

    expect(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).toBe('{"mode":null}');
  });

  it("carries the keys of what is missing on a 409 registration_not_ready, and nothing else of the body", async () => {
    stubFetch(409, { error: "registration_not_ready", blockers: ["legal_documents", "mail_provider"], note: "ignored" });

    const failure = await failureOf(saveRegistrationSettings("evt-1", { mode: "automatic" }));

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, code: "registration_not_ready", blockers: ["legal_documents", "mail_provider"] });
  });

  it("keeps only the keys that are strings, and has none when the blockers are not a list", async () => {
    stubFetch(409, { error: "registration_not_ready", blockers: ["legal_documents", 7, null, { key: "x" }] });
    expect(await failureOf(saveRegistrationSettings("evt-1", { mode: "automatic" }))).toMatchObject({ blockers: ["legal_documents"] });

    stubFetch(409, { error: "registration_not_ready", blockers: "legal_documents" });
    expect((await failureOf(saveRegistrationSettings("evt-1", { mode: "automatic" }))) as ApiError).toMatchObject({ blockers: undefined });
  });

  it("reads blockers only from the answer that means registration is not ready", async () => {
    stubFetch(409, { error: "something_else", blockers: ["legal_documents"] });

    const failure = (await failureOf(saveRegistrationSettings("evt-1", { mode: "automatic" }))) as ApiError;

    expect(failure.code).toBe("something_else");
    expect(failure.blockers).toBeUndefined();
  });

  it.each([
    [422, { error: "consent_not_published" }, "consent_not_published"],
    [403, { code: "event_archived" }, "event_archived"],
    [400, { error: "validation_failed" }, "validation_failed"],
  ])("fails with the status and the code of a %i", async (status, body, code) => {
    stubFetch(status, body);

    expect(await failureOf(saveRegistrationSettings("evt-1", { mode: "automatic" }))).toMatchObject({ status, code });
  });
});

describe("setRegistrationPassword", () => {
  it("PUTs the password in the body of the request and nowhere else, and reads nothing from the 204 that answers", async () => {
    const fetchMock = stubFetch(204);

    await expect(setRegistrationPassword("evt-1", "correct horse battery")).resolves.toBeUndefined();

    const [address, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(address).toBe("/api/admin/events/evt-1/registration/password");
    expect(address).not.toContain("correct");
    expect(init).toMatchObject({ method: "PUT", credentials: "same-origin" });
    expect(JSON.parse(String(init.body))).toEqual({ password: "correct horse battery" });
    expect(JSON.stringify(init.headers)).not.toContain("correct");
  });

  it("fails with the code of a refusal of the length", async () => {
    stubFetch(400, { error: "registration_password_length" });

    expect(await failureOf(setRegistrationPassword("evt-1", "short"))).toMatchObject({ status: 400, code: "registration_password_length" });
  });
});

describe("clearRegistrationPassword", () => {
  it("DELETEs the password of the event, with no body, and reads nothing from the 204", async () => {
    const fetchMock = stubFetch(204);

    await expect(clearRegistrationPassword("evt-1")).resolves.toBeUndefined();

    const [address, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(address).toBe("/api/admin/events/evt-1/registration/password");
    expect(init).toMatchObject({ method: "DELETE", credentials: "same-origin" });
    expect(init.body).toBeUndefined();
  });

  it("fails with the code of a refusal on an archived event", async () => {
    stubFetch(403, { code: "event_archived" });

    expect(await failureOf(clearRegistrationPassword("evt-1"))).toMatchObject({ status: 403, code: "event_archived" });
  });
});
