/**
 * The probe of an event's own address (D-C6, PR 120): what each of the six results needs to be true, with the lookup and the pinned
 * request replaced where the network would be, and the real ones where the outcome does not need a server. No database.
 */
import { describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import { signDomainCheck } from "@admitto/crypto";
import { SafeHostnameError } from "@admitto/shared/ssrf-guard";
import { DOMAIN_CHECK_MAX_BODY_BYTES, probeEventDomain, type DomainCheckDeps } from "../src/event-domain-check.js";

const EVENT_ID = "evt-probe";
const DOMAIN = "summit.acme.example";
const PUBLIC_ADDRESS: LookupAddress = { address: "203.0.113.10", family: 4 };

type Pinned = NonNullable<DomainCheckDeps["fetchPinned"]>;

/** A pinned request whose answer is `response`: the handler is run on it, as the real one runs it. */
function answering(response: Response | (() => Response)): Pinned & ReturnType<typeof vi.fn> {
  return vi.fn(async (_url, _host, _records, _init, handler) => handler(typeof response === "function" ? response() : response)) as never;
}

/** A pinned request that fails the way undici fails: `TypeError: fetch failed` with the reason as its cause. */
function failing(code: string, message = "failed"): Pinned {
  return (async () => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error(message), { code }) });
  }) as never;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

const proof = (eventId = EVENT_ID, domain = DOMAIN) => ({ ok: true, mac: signDomainCheck(eventId, domain) });

const resolvesTo = (...records: LookupAddress[]) => vi.fn(async () => records);

describe("probeEventDomain: ok", () => {
  it("is ok when the address answers the proof for this event and this address", async () => {
    const fetchPinned = answering(() => json(proof()));
    const resolve = resolvesTo(PUBLIC_ADDRESS);
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve, fetchPinned })).toBe("ok");

    expect(resolve).toHaveBeenCalledWith(DOMAIN);
    expect(fetchPinned).toHaveBeenCalledOnce();
    const [url, host, records, init] = fetchPinned.mock.calls[0]!;
    expect(url).toBe(`https://${DOMAIN}/.well-known/admitto-domain-check`);
    expect(host).toBe(DOMAIN);
    expect(records).toEqual([PUBLIC_ADDRESS]);
    // A redirect is never followed, and one deadline covers the whole request.
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts a content type with a charset", async () => {
    const fetchPinned = answering(() => json(proof(), { headers: { "content-type": "application/json; charset=utf-8" } }));
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve: resolvesTo(PUBLIC_ADDRESS), fetchPinned })).toBe("ok");
  });
});

describe("probeEventDomain: dns_failed", () => {
  it("is dns_failed when the name does not resolve, and asks for nothing", async () => {
    const fetchPinned = vi.fn();
    const resolve = vi.fn(async () => {
      throw new SafeHostnameError("hostname_unresolved", "hostname could not be resolved");
    });
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve, fetchPinned: fetchPinned as never })).toBe("dns_failed");
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it("is dns_failed for the real lookup of a name that cannot exist", async () => {
    // `.invalid` is reserved (RFC 6761): it never resolves.
    expect(await probeEventDomain(EVENT_ID, "no-such-host.invalid", { fetchPinned: vi.fn() as never })).toBe("dns_failed");
  });

  it("is dns_failed when the lookup does not answer within the deadline", async () => {
    const resolve = () => new Promise<LookupAddress[]>(() => undefined);
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve, fetchPinned: vi.fn() as never, timeoutMs: 20 })).toBe("dns_failed");
  });

  it("is dns_failed when the lookup fails in any other way", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("resolver exploded");
    });
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve, fetchPinned: vi.fn() as never })).toBe("dns_failed");
  });
});

describe("probeEventDomain: not_verifiable_from_server", () => {
  it("is not_verifiable_from_server when the name resolves to a private address, as an internal DNS does", async () => {
    const fetchPinned = vi.fn();
    const resolve = vi.fn(async () => {
      throw new SafeHostnameError("hostname_blocked", "hostname must not resolve to a private or link-local address");
    });
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve, fetchPinned: fetchPinned as never })).toBe("not_verifiable_from_server");
    // Nothing is sent to a private address.
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it.each(["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.20", "100.100.100.200", "::1", "fd00::1"])(
    "refuses %s with the real guard, before any connection",
    async (address) => {
      const fetchPinned = vi.fn();
      expect(await probeEventDomain(EVENT_ID, address, { fetchPinned: fetchPinned as never })).toBe("not_verifiable_from_server");
      expect(fetchPinned).not.toHaveBeenCalled();
    },
  );
});

describe("probeEventDomain: tls_failed", () => {
  it.each([
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "ERR_SSL_WRONG_VERSION_NUMBER",
    "EPROTO",
  ])("is tls_failed for %s", async (code) => {
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve: resolvesTo(PUBLIC_ADDRESS), fetchPinned: failing(code) })).toBe("tls_failed");
  });

  it("finds the reason however deep undici wraps it", async () => {
    const deep = new TypeError("fetch failed", {
      cause: new Error("outer", { cause: Object.assign(new Error("inner"), { code: "CERT_HAS_EXPIRED" }) }),
    });
    const fetchPinned = (async () => {
      throw deep;
    }) as never;
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve: resolvesTo(PUBLIC_ADDRESS), fetchPinned })).toBe("tls_failed");
  });
});

describe("probeEventDomain: unreachable", () => {
  it.each(["ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"])("is unreachable for %s", async (code) => {
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve: resolvesTo(PUBLIC_ADDRESS), fetchPinned: failing(code) })).toBe("unreachable");
  });

  it("is unreachable when nothing answers within the deadline", async () => {
    const fetchPinned = vi.fn(
      (_url, _host, _records, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
        }),
    );
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve: resolvesTo(PUBLIC_ADDRESS), fetchPinned: fetchPinned as never, timeoutMs: 20 })).toBe("unreachable");
  });

  it("is unreachable when the answer stops half way", async () => {
    const stalled = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":'));
          controller.error(new Error("socket closed"));
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve: resolvesTo(PUBLIC_ADDRESS), fetchPinned: answering(stalled) })).toBe("unreachable");
  });

  it("is unreachable for the real client when nothing listens on the address it is pinned to", async () => {
    // The real pinned request, to a port that refuses: the lookup is replaced because the real one would refuse the loopback.
    const resolve = resolvesTo({ address: "127.0.0.1", family: 4 });
    expect(await probeEventDomain(EVENT_ID, DOMAIN, { resolve })).toBe("unreachable");
  });
});

describe("probeEventDomain: wrong_target", () => {
  const probeWith = (response: Response) => probeEventDomain(EVENT_ID, DOMAIN, { resolve: resolvesTo(PUBLIC_ADDRESS), fetchPinned: answering(response) });

  it.each([
    ["a 404 (another service, or another instance that does not know the address)", () => new Response("not found", { status: 404 })],
    ["a 500", () => new Response("error", { status: 500 })],
    ["a redirect (it is not followed)", () => new Response(null, { status: 301, headers: { location: "https://elsewhere.example/" } })],
    ["a page", () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["JSON without a content type", () => new Response(JSON.stringify(proof()), { status: 200 })],
    ["text that is not JSON", () => new Response("nope", { status: 200, headers: { "content-type": "application/json" } })],
    ["JSON that is not an object", () => json("yes")],
    ["JSON null", () => json(null)],
    ["an answer that is not ok", () => json({ ok: false, mac: signDomainCheck(EVENT_ID, DOMAIN) })],
    ["an answer without a mac", () => json({ ok: true })],
    ["a mac that is not text", () => json({ ok: true, mac: 7 })],
    ["a wrong mac", () => json({ ok: true, mac: "x".repeat(43) })],
    ["a mac of another length", () => json({ ok: true, mac: "short" })],
    ["the proof of another event", () => json(proof("evt-other"))],
    ["the proof of another address", () => json(proof(EVENT_ID, "other.acme.example"))],
  ])("is wrong_target for %s", async (_label, make) => {
    expect(await probeWith(make())).toBe("wrong_target");
  });

  it("is wrong_target for an answer longer than the proof can be, and does not read the rest", async () => {
    const cancelled = vi.fn();
    const long = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(DOMAIN_CHECK_MAX_BODY_BYTES)));
        },
        cancel: cancelled,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    expect(await probeWith(long)).toBe("wrong_target");
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("drops the body of an answer it does not read, so the connection can close", async () => {
    const cancelled = vi.fn();
    const refused = new Response(new ReadableStream({ cancel: cancelled }), { status: 404 });
    expect(await probeWith(refused)).toBe("wrong_target");
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("is wrong_target for the host of the instance itself, without a request", async () => {
    const fetchPinned = vi.fn();
    const resolve = vi.fn();
    const result = await probeEventDomain(EVENT_ID, "tickets.example.com", {
      resolve: resolve as never,
      fetchPinned: fetchPinned as never,
      instanceHostname: "tickets.example.com",
    });
    expect(result).toBe("wrong_target");
    expect(resolve).not.toHaveBeenCalled();
    expect(fetchPinned).not.toHaveBeenCalled();
  });
});
