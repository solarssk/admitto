import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import {
  clearPinnedOidcCacheForTests,
  createSafeOidcCustomFetch,
  safeOidcFetch,
} from "../src/oidc/safe-oidc-fetch.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

vi.mock("undici", () => {
  function MockAgent(this: { close: () => Promise<void> }) {
    this.close = vi.fn().mockResolvedValue(undefined);
  }
  return {
    Agent: vi.fn(MockAgent),
    fetch: vi.fn(),
  };
});

const mockedLookup = vi.mocked(lookup);
const mockedUndiciFetch = vi.mocked(undiciFetch);
const MockedAgent = vi.mocked(Agent);

beforeEach(() => {
  process.env["NODE_ENV"] = "test";
  clearPinnedOidcCacheForTests();
  mockedLookup.mockClear();
  mockedUndiciFetch.mockClear();
  MockedAgent.mockClear();
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
  mockedUndiciFetch.mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("safeOidcFetch", () => {
  it("pins resolved IP into undici connect lookup", async () => {
    await safeOidcFetch("https://login.example.com/jwks");

    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(MockedAgent).toHaveBeenCalledWith({
      connect: {
        servername: "login.example.com",
        lookup: expect.any(Function),
      },
    });
    expect(mockedUndiciFetch).toHaveBeenCalledWith(
      "https://93.184.216.34/jwks",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.any(Headers),
        dispatcher: expect.any(Object),
      }),
    );
    const headers = mockedUndiciFetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("host")).toBe("login.example.com");
  });

  it("caches DNS resolution for repeated fetches", async () => {
    await safeOidcFetch("https://login.example.com/a");
    await safeOidcFetch("https://login.example.com/b");

    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });

  it("uses default fetch for http localhost in non-production", async () => {
    const globalFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", globalFetch);

    await safeOidcFetch("http://localhost:9999/jwks");

    expect(mockedLookup).not.toHaveBeenCalled();
    expect(globalFetch).toHaveBeenCalledWith("http://localhost:9999/jwks", { redirect: "manual" });
    expect(mockedUndiciFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("follows redirects only after re-validating the Location URL", async () => {
    mockedUndiciFetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://login.example.com/jwks-final" },
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const res = await safeOidcFetch("https://login.example.com/jwks");

    expect(res.status).toBe(200);
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
    expect(mockedUndiciFetch.mock.calls[0]?.[0]).toBe("https://93.184.216.34/jwks");
    expect(mockedUndiciFetch.mock.calls[1]?.[0]).toBe("https://93.184.216.34/jwks-final");
  });

  it("rejects redirects to private targets", async () => {
    mockedUndiciFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "https://169.254.169.254/latest/meta-data/" },
      }),
    );

    await expect(safeOidcFetch("https://login.example.com/jwks")).rejects.toThrow(
      /private or link-local/,
    );
  });

  it("tries the next validated DNS record after connect failure", async () => {
    mockedLookup.mockResolvedValue([
      { address: "2001:db8::1", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ] as Awaited<ReturnType<typeof lookup>>);
    mockedUndiciFetch
      .mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { code: "ENETUNREACH" }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const res = await safeOidcFetch("https://login.example.com/jwks");

    expect(res.status).toBe(200);
    expect(MockedAgent).toHaveBeenCalledTimes(2);
    expect(mockedUndiciFetch.mock.calls[0]?.[0]).toBe("https://[2001:db8::1]/jwks");
    expect(mockedUndiciFetch.mock.calls[1]?.[0]).toBe("https://93.184.216.34/jwks");
  });
});

describe("createSafeOidcCustomFetch", () => {
  it("reuses pinned target for jose JWKS reloads", async () => {
    const customFetch = createSafeOidcCustomFetch("https://login.example.com/jwks");
    await customFetch("https://login.example.com/jwks", { method: "GET" });
    await customFetch("https://login.example.com/jwks", { method: "GET" });

    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
  });
});
