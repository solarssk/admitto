import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { signDomainCheck } from "@admitto/crypto";
import {
  NOT_A_GUEST_HOST,
  type GuestHost,
  type GuestHostResolver,
} from "../../src/guest-host/guest-host.js";
import {
  createGuestHostMiddleware,
  guestHostOf,
  handleDomainCheck,
  isOtherEventOnGuestHost,
} from "../../src/guest-host/guest-host-middleware.js";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

const mockedGetConnInfo = vi.mocked(getConnInfo);

/**
 * The routing by host with its parts replaced by stand-ins (D-C6, 119b): which host the middleware judges (the one the request came
 * to, and the proxy's only from a trusted proxy), what it lets through on a guest's address, the one 404 for the rest, the redirect of
 * the root, the HSTS header, and that a failed lookup is an error and not a quiet "not a guest".
 */
const OWN = "summit.acme.example";
const OTHER = "other.acme.example";
const PENDING_HOST = "pending.acme.example";
const GUEST: GuestHost = { kind: "guest", domain: OWN, eventId: "evt-1", slug: "summit" };
const OTHER_GUEST: GuestHost = { kind: "guest", domain: OTHER, eventId: "evt-2", slug: "other" };
const PENDING: GuestHost = { kind: "pending", domain: PENDING_HOST, eventId: "evt-3" };

function resolverOf(hosts: Record<string, GuestHost>) {
  const resolve = vi.fn(async (hostname: string): Promise<GuestHost> => hosts[hostname] ?? NOT_A_GUEST_HOST);
  const resolver: GuestHostResolver = { resolve, clear: () => {}, size: () => ({ found: 0, missing: 0 }) };
  return { resolver, resolve };
}

function makeApp(options: { instanceHostname?: string | null; hosts?: Record<string, GuestHost>; resolver?: GuestHostResolver } = {}) {
  const { resolver, resolve } = resolverOf(options.hosts ?? { [OWN]: GUEST, [OTHER]: OTHER_GUEST, [PENDING_HOST]: PENDING });
  const app = new Hono();
  app.use("*", createGuestHostMiddleware({ resolver: options.resolver ?? resolver, configuredInstanceHostname: () => (options.instanceHostname === undefined ? "tickets.example.com" : options.instanceHostname) }));
  const seen = (c: Context) => c.json({ kind: guestHostOf(c).kind, other: isOtherEventOnGuestHost(c, "evt-9") });
  app.get("/", seen);
  app.get("/admin", seen);
  app.get("/api/admin/events", seen);
  app.get("/r/:slug", seen);
  app.get("/uploads/other/:id", (c) => c.json(isOtherEventOnGuestHost(c, c.req.param("id"))));
  app.post("/r/:slug", seen);
  app.get("/uploads/hsts", (c) => {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return c.text("ok");
  });
  app.get("/uploads/hsts-plain", (c) => {
    c.header("Strict-Transport-Security", "max-age=31536000");
    return c.text("ok");
  });
  app.get("/uploads/no-hsts", (c) => c.text("ok"));
  app.get("/uploads/boom", () => {
    throw new Error("boom");
  });
  app.onError((_err, c) => c.text("failed", 500));
  app.get("/.well-known/admitto-domain-check", (c) => handleDomainCheck(c));
  return { app, resolve };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  mockedGetConnInfo.mockReturnValue({ remote: { address: "127.0.0.1", port: 1234 } } as ReturnType<typeof getConnInfo>);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function signature(res: Response) {
  const headers: Record<string, string> = {};
  for (const [name, value] of res.headers.entries()) if (name !== "date") headers[name] = value;
  return { status: res.status, headers, body: await res.text() };
}

describe("which host is judged", () => {
  it("is the host the request came to", async () => {
    const { app } = makeApp();
    const res = await app.request(`https://${OWN}/r/summit`);
    expect(await res.json()).toEqual({ kind: "guest", other: true });
  });

  it("is the same name with the root dot some clients send: it is no way round the routing", async () => {
    const { app, resolve } = makeApp();
    const res = await app.request(`https://${OWN}./admin`);
    expect(res.status).toBe(404);
    expect(resolve.mock.calls.map(([name]) => name)).toEqual([OWN]);
    // The instance's host is the same name with or without the dot.
    const main = await app.request("https://tickets.example.com./admin");
    expect(await main.json()).toEqual({ kind: "none", other: false });
  });

  it("is lower case and without a port, however the host was written", async () => {
    const { app, resolve } = makeApp();
    for (const host of [OWN.toUpperCase(), `${OWN}:8443`]) {
      const res = await app.request(`https://${host}/r/summit`);
      expect(res.status, host).toBe(200);
    }
    expect(resolve.mock.calls.map(([name]) => name)).toEqual([OWN, OWN]);
  });

  it("is the host a trusted proxy reports in X-Forwarded-Host", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const { app } = makeApp();
    const res = await app.request("https://tickets.example.com/r/summit", { headers: { "X-Forwarded-Host": OWN } });
    expect(await res.json()).toEqual({ kind: "guest", other: true });
  });

  it("is the host the request came to when the peer is not a trusted proxy, whatever X-Forwarded-Host says", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    mockedGetConnInfo.mockReturnValue({ remote: { address: "203.0.113.9", port: 1234 } } as ReturnType<typeof getConnInfo>);
    const { app } = makeApp();
    // A stranger who reaches the application directly cannot make it a guest's address, nor hide one.
    const claimsGuest = await app.request("https://tickets.example.com/admin", { headers: { "X-Forwarded-Host": OWN } });
    expect(await claimsGuest.json()).toEqual({ kind: "none", other: false });
    const hidesGuest = await app.request(`https://${OWN}/admin`, { headers: { "X-Forwarded-Host": "tickets.example.com" } });
    expect(hidesGuest.status).toBe(404);
  });

  it("is the host the request came to when TRUST_PROXY is off, though the peer is on the allowlist", async () => {
    const { app } = makeApp();
    const res = await app.request("https://tickets.example.com/admin", { headers: { "X-Forwarded-Host": OWN } });
    expect(await res.json()).toEqual({ kind: "none", other: false });
  });

  it("takes the first of several hosts a proxy lists", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const { app } = makeApp();
    const res = await app.request("https://tickets.example.com/r/summit", { headers: { "X-Forwarded-Host": `${OWN}, evil.example.net` } });
    expect(await res.json()).toEqual({ kind: "guest", other: true });
  });
});

describe("a host that is not looked up", () => {
  it("is the host the configuration names as the instance's, even when the table names it", async () => {
    const { app, resolve } = makeApp({ hosts: { "tickets.example.com": GUEST } });
    const res = await app.request("https://tickets.example.com/admin");
    expect(await res.json()).toEqual({ kind: "none", other: false });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("is the instance's host when the configuration names none: the lookup decides, and it never calls it a guest's", async () => {
    const { app, resolve } = makeApp({ instanceHostname: null, hosts: {} });
    const res = await app.request("https://tickets.example.com/admin");
    expect(await res.json()).toEqual({ kind: "none", other: false });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("on a guest's address", () => {
  it("lets through the paths of its own event and what the guest needs", async () => {
    const { app } = makeApp();
    for (const path of ["/r/summit", "/uploads/hsts"]) {
      const res = await app.request(`https://${OWN}${path}`);
      expect(res.status, path).toBe(200);
    }
    expect((await app.request(`https://${OWN}/r/summit`, { method: "POST" })).status).toBe(200);
  });

  it("hides the panel, the API and the pages of another event with the one 404, whatever the method", async () => {
    const { app } = makeApp();
    const reference = await signature(await app.request(`https://${OWN}/r/not-this-event`));
    expect(reference.status).toBe(404);
    for (const [path, method] of [
      ["/admin", "GET"],
      ["/api/admin/events", "GET"],
      ["/api/admin/events", "POST"],
      ["/login", "GET"],
      ["/healthz", "GET"],
      ["/r/other", "GET"],
      ["/anything/at/all", "DELETE"],
    ] as const) {
      expect(await signature(await app.request(`https://${OWN}${path}`, { method })), `${method} ${path}`).toEqual(reference);
    }
  });

  it("answers a hidden path before any later middleware or route has run", async () => {
    const { app } = makeApp();
    const reached = vi.fn();
    app.get("/api/never", (c) => {
      reached();
      return c.text("no");
    });
    await app.request(`https://${OWN}/api/never`);
    await app.request(`https://${OWN}/admin`);
    expect(reached).not.toHaveBeenCalled();
  });

  it("sends the root to the form of its own event, a path taken from the table and never from the request", async () => {
    const { app } = makeApp();
    for (const target of ["/", "/?next=https://evil.example.net", "/?slug=other", "/?redirect=//evil.example.net"]) {
      const res = await app.request(`https://${OWN}${target}`, { redirect: "manual" });
      expect(res.status, target).toBe(302);
      expect(res.headers.get("location"), target).toBe("/r/summit");
      expect(res.headers.get("cache-control"), target).toBe("no-store");
    }
    const other = await app.request(`https://${OTHER}/`, { redirect: "manual" });
    expect(other.headers.get("location")).toBe("/r/other");
  });

  it("hides the root for a method that is not a read", async () => {
    const { app } = makeApp();
    const reference = await signature(await app.request(`https://${OWN}/r/not-this-event`));
    expect(await signature(await app.request(`https://${OWN}/`, { method: "POST" }))).toEqual(reference);
  });

  it("knows that another event's ticket is not this host's", async () => {
    const { app } = makeApp();
    const res = await app.request(`https://${OWN}/r/summit`);
    expect(await res.json()).toEqual({ kind: "guest", other: true });
    const onOther = await app.request(`https://${OTHER}/r/other`);
    expect(await onOther.json()).toEqual({ kind: "guest", other: true });
  });

  it("drops includeSubDomains from Strict-Transport-Security on what it serves and on what it hides, and only there", async () => {
    const { app } = makeApp();
    const served = await app.request(`https://${OWN}/uploads/hsts`);
    const plain = await app.request(`https://${OWN}/uploads/hsts-plain`);
    const hidden = await app.request(`https://${OWN}/admin`);
    const main = await app.request("https://tickets.example.com/uploads/hsts");
    expect(served.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(plain.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(hidden.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(main.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });
});

describe("Strict-Transport-Security is owned by the application (D-L3)", () => {
  const WITH = "max-age=31536000; includeSubDomains";
  const WITHOUT = "max-age=31536000";

  it("adds it to every answer to an HTTPS request that has none: a file, an error and a 404, with includeSubDomains only off a guest's address", async () => {
    const { app } = makeApp();
    for (const path of ["/uploads/no-hsts", "/uploads/boom", "/uploads/missing"]) {
      const main = await app.request(`https://tickets.example.com${path}`);
      const guest = await app.request(`https://${OWN}${path}`);
      expect(main.headers.get("strict-transport-security"), `main ${path}`).toBe(WITH);
      expect(guest.headers.get("strict-transport-security"), `guest ${path}`).toBe(WITHOUT);
    }
    const hidden = await app.request(`https://${OWN}/api/admin/events`);
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("strict-transport-security")).toBe(WITHOUT);
  });

  it("adds none to a plain HTTP request on any host", async () => {
    const { app } = makeApp();
    for (const host of ["tickets.example.com", OWN]) {
      for (const path of ["/uploads/no-hsts", "/admin"]) {
        const res = await app.request(`http://${host}${path}`);
        expect(res.headers.get("strict-transport-security"), `${host}${path}`).toBeNull();
      }
    }
  });
});

describe("on a host that is only a pending address, or no address", () => {
  it("serves everything as before", async () => {
    const { app } = makeApp();
    for (const host of [PENDING_HOST, "unknown.example.net", "tickets.example.com"]) {
      for (const path of ["/admin", "/api/admin/events", "/"]) {
        const res = await app.request(`https://${host}${path}`);
        expect(res.status, `${host}${path}`).toBe(200);
        expect(await res.json()).toMatchObject({ other: false });
      }
    }
  });
});

describe("a failed lookup", () => {
  it("is an error and not a request served as if the host were no guest's", async () => {
    const failing: GuestHostResolver = {
      resolve: async () => {
        throw new Error("down");
      },
      clear: () => {},
      size: () => ({ found: 0, missing: 0 }),
    };
    const { app } = makeApp({ resolver: failing });
    const res = await app.request(`https://${OWN}/admin`);
    expect(res.status).toBe(500);
  });
});

describe("GET /.well-known/admitto-domain-check", () => {
  it("answers ok with the proof of the event and the address, for a guest's address and for a pending one", async () => {
    const { app } = makeApp();
    for (const [host, domain, eventId] of [[OWN, OWN, "evt-1"], [PENDING_HOST, PENDING_HOST, "evt-3"]] as const) {
      const res = await app.request(`https://${host}/.well-known/admitto-domain-check`);
      expect(res.status, host).toBe(200);
      expect(res.headers.get("content-type"), host).toContain("application/json");
      expect(res.headers.get("cache-control"), host).toBe("no-store");
      expect(await res.json(), host).toEqual({ ok: true, mac: signDomainCheck(eventId, domain) });
    }
  });

  it("gives another address another proof, and never the proof of the event for another address", async () => {
    const { app } = makeApp();
    const a = (await (await app.request(`https://${OWN}/.well-known/admitto-domain-check`)).json()) as { mac: string };
    const b = (await (await app.request(`https://${OTHER}/.well-known/admitto-domain-check`)).json()) as { mac: string };
    expect(a.mac).not.toBe(b.mac);
    expect(a.mac).not.toBe(signDomainCheck("evt-1", OTHER));
  });

  it("is the 404 of a path that is not there on a host that is no address of an event", async () => {
    const { app } = makeApp();
    const res = await app.request("https://tickets.example.com/.well-known/admitto-domain-check");
    expect(res.status).toBe(404);
  });
});

describe("guestHostOf and isOtherEventOnGuestHost", () => {
  it("are none and false when the middleware did not run", async () => {
    const app = new Hono();
    app.get("/x", (c) => c.json({ kind: guestHostOf(c).kind, other: isOtherEventOnGuestHost(c, "evt-1") }));
    expect(await (await app.request("https://tickets.example.com/x")).json()).toEqual({ kind: "none", other: false });
  });

  it("are false for the event of the host and true for another, only on a guest's address", async () => {
    const { app } = makeApp();
    const ask = async (host: string, eventId: string) =>
      (await (await app.request(`https://${host}/uploads/other/${eventId}`)).json()) as boolean;
    expect([await ask(OWN, "evt-1"), await ask(OWN, "evt-2")]).toEqual([false, true]);
    // A pending address and a host that is nobody's are no guest's address: no event is another there.
    expect([await ask(PENDING_HOST, "evt-1"), await ask(PENDING_HOST, "evt-3"), await ask("unknown.example.net", "evt-1")]).toEqual([false, false, false]);
  });
});
