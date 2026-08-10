import { beforeEach, describe, expect, it, vi } from "vitest";
import { Agent, fetch as undiciFetch } from "undici";
import { withPinnedFetch } from "../src/pinnedFetch.js";

/**
 * Real undici only ever exercises one shape of the custom `connect.lookup` callback per
 * process (whichever `options.all` value its Happy-Eyeballs connector happens to pass) —
 * see powerAutomate-pinnedFetch.test.ts for that real-socket path. This unit-tests the
 * lookup callback directly, mocking Agent to capture it, so both the array (`all: true`)
 * and single-address (`all: false`) shapes are actually verified rather than left to
 * whichever branch a real connection attempt happens to take.
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

function capturedLookup(): (
  host: string,
  options: { all?: boolean },
  callback: (...args: unknown[]) => void,
) => void {
  const call = MockedAgent.mock.calls[0]?.[0] as {
    connect: { lookup: (host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => void };
  };
  return call.connect.lookup;
}

describe("withPinnedFetch's custom lookup", () => {
  it("returns an address array when options.all is true", async () => {
    await withPinnedFetch(
      "https://example.com/",
      "example.com",
      { address: "203.0.113.9", family: 4 },
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
      { address: "203.0.113.9", family: 4 },
      { method: "GET" },
      async (res) => res,
    );

    const callback = vi.fn();
    capturedLookup()("example.com", { all: false }, callback);

    expect(callback).toHaveBeenCalledWith(null, "203.0.113.9", 4);
  });
});
