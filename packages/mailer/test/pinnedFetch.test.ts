import { beforeEach, describe, expect, it, vi } from "vitest";
import { Agent, fetch as undiciFetch } from "undici";
import { withPinnedFetch } from "../src/pinnedFetch.js";

/**
 * Real undici only ever exercises one shape of the custom `connect.lookup` callback per
 * process (whichever `options.all` value its Happy-Eyeballs connector happens to pass) —
 * see powerAutomate-pinnedFetch.test.ts for that real-socket path. This unit-tests the
 * lookup callback directly, mocking Agent to capture it, so both the array (`all: true`)
 * and single-address (`all: false`) shapes are actually verified rather than left to
 * whichever branch a real connection attempt happens to take. It also covers the
 * retry-across-validated-records behavior directly (mocked fetch failures), independent
 * of real network conditions.
 */
vi.mock("undici", () => {
  function MockAgent(this: { close: () => Promise<void> }) {
    this.close = vi.fn().mockResolvedValue(undefined);
  }
  return {
    Agent: vi.fn(MockAgent),
    fetch: vi.fn(),
  };
});

const MockedAgent = vi.mocked(Agent);
const mockedUndiciFetch = vi.mocked(undiciFetch);

beforeEach(() => {
  MockedAgent.mockClear();
  mockedUndiciFetch.mockClear();
  mockedUndiciFetch.mockResolvedValue(new Response("ok", { status: 200 }));
});

function capturedLookup(callIndex = 0): (
  host: string,
  options: { all?: boolean },
  callback: (...args: unknown[]) => void,
) => void {
  const call = MockedAgent.mock.calls[callIndex]?.[0] as {
    connect: { lookup: (host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => void };
  };
  return call.connect.lookup;
}

function connectError(code: string): Error {
  return Object.assign(new Error("fetch failed"), { code });
}

describe("withPinnedFetch's custom lookup", () => {
  it("returns an address array when options.all is true", async () => {
    await withPinnedFetch(
      "https://example.com/",
      "example.com",
      [{ address: "203.0.113.9", family: 4 }],
      { method: "GET" },
      async (res) => res,
    );

    const callback = vi.fn();
    capturedLookup()("example.com", { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [{ address: "203.0.113.9", family: 4 }]);
  });

  it("returns a single address/family pair when options.all is false", async () => {
    await withPinnedFetch(
      "https://example.com/",
      "example.com",
      [{ address: "203.0.113.9", family: 4 }],
      { method: "GET" },
      async (res) => res,
    );

    const callback = vi.fn();
    capturedLookup()("example.com", { all: false }, callback);

    expect(callback).toHaveBeenCalledWith(null, "203.0.113.9", 4);
  });
});

describe("withPinnedFetch retry across validated records", () => {
  it("tries the next record after a connect failure and pins to it", async () => {
    mockedUndiciFetch
      .mockRejectedValueOnce(connectError("ENETUNREACH"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await withPinnedFetch(
      "https://example.com/",
      "example.com",
      [
        { address: "2001:db8::1", family: 6 },
        { address: "203.0.113.9", family: 4 },
      ],
      { method: "GET" },
      async (r) => r,
    );

    expect(res.status).toBe(200);
    expect(MockedAgent).toHaveBeenCalledTimes(2);
    const secondCallback = vi.fn();
    capturedLookup(1)("example.com", { all: false }, secondCallback);
    expect(secondCallback).toHaveBeenCalledWith(null, "203.0.113.9", 4);
  });

  it("throws the last connect error when every record is unreachable", async () => {
    mockedUndiciFetch
      .mockRejectedValueOnce(connectError("ECONNREFUSED"))
      .mockRejectedValueOnce(connectError("ETIMEDOUT"));

    await expect(
      withPinnedFetch(
        "https://example.com/",
        "example.com",
        [
          { address: "203.0.113.1", family: 4 },
          { address: "203.0.113.2", family: 4 },
        ],
        { method: "GET" },
        async (r) => r,
      ),
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(MockedAgent).toHaveBeenCalledTimes(2);
  });

  it("does not retry when handler throws after a successful connect", async () => {
    const handlerError = new Error("boom");

    await expect(
      withPinnedFetch(
        "https://example.com/",
        "example.com",
        [
          { address: "203.0.113.1", family: 4 },
          { address: "203.0.113.2", family: 4 },
        ],
        { method: "GET" },
        async () => {
          throw handlerError;
        },
      ),
    ).rejects.toBe(handlerError);
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
    expect(MockedAgent).toHaveBeenCalledTimes(1);
  });

  it("retries when the connect failure is wrapped as an Error.cause (undici's fetch failed shape)", async () => {
    const wrapped = new Error("fetch failed", { cause: connectError("ECONNREFUSED") });
    mockedUndiciFetch
      .mockRejectedValueOnce(wrapped)
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await withPinnedFetch(
      "https://example.com/",
      "example.com",
      [
        { address: "203.0.113.1", family: 4 },
        { address: "203.0.113.2", family: 4 },
      ],
      { method: "GET" },
      async (r) => r,
    );

    expect(res.status).toBe(200);
    expect(MockedAgent).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-connect error (e.g. an aborted request)", async () => {
    const abortError = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    mockedUndiciFetch.mockRejectedValueOnce(abortError);

    await expect(
      withPinnedFetch(
        "https://example.com/",
        "example.com",
        [
          { address: "203.0.113.1", family: 4 },
          { address: "203.0.113.2", family: 4 },
        ],
        { method: "GET" },
        async (r) => r,
      ),
    ).rejects.toBe(abortError);
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates immediately when the rejection isn't an Error at all", async () => {
    mockedUndiciFetch.mockRejectedValueOnce("connection reset");

    await expect(
      withPinnedFetch(
        "https://example.com/",
        "example.com",
        [
          { address: "203.0.113.1", family: 4 },
          { address: "203.0.113.2", family: 4 },
        ],
        { method: "GET" },
        async (r) => r,
      ),
    ).rejects.toBe("connection reset");
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it("throws a generic error rather than looping when given no records", async () => {
    await expect(
      withPinnedFetch("https://example.com/", "example.com", [], { method: "GET" }, async (r) => r),
    ).rejects.toThrow("no validated address was reachable");
    expect(mockedUndiciFetch).not.toHaveBeenCalled();
  });
});
