import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  GuestHostLookupError,
  configuredInstanceHostname,
  createGuestHostResolver,
  resolveInstanceHostname,
} from "../../src/guest-host/guest-host.js";
import { InstanceUrlRequiredError } from "../../src/instance-base-url.js";

/**
 * The memory of the events' own addresses (D-C6, 119b): what a host is, how long that is remembered, and that a host name a stranger
 * makes up can neither grow the memory nor cost more than one read.
 */
type Row = { custom_domain_verified_at: Date | null; event: { id: string; slug: string } } | null;

const OWN = "summit.acme.example";
const VERIFIED: Row = { custom_domain_verified_at: new Date("2026-11-11T10:00:00Z"), event: { id: "evt-1", slug: "summit" } };
const PENDING: Row = { custom_domain_verified_at: null, event: { id: "evt-1", slug: "summit" } };

function fakeDb(rows: Record<string, Row>, failWith?: Error) {
  const findUnique = vi.fn(async (args: { where: { custom_domain: string } }) => {
    if (failWith) throw failWith;
    return rows[args.where.custom_domain] ?? null;
  });
  return { db: { eventRegistrationSettings: { findUnique } } as unknown as PrismaClient, findUnique };
}

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

const noInstanceHost = async () => null;

describe("the kind of host", () => {
  it("is a guest's address when the address is verified, with the event it belongs to", async () => {
    const { db } = fakeDb({ [OWN]: VERIFIED });
    expect(await createGuestHostResolver(db, noInstanceHost).resolve(OWN)).toEqual({ kind: "guest", domain: OWN, eventId: "evt-1", slug: "summit" });
  });

  it("is pending when the address is set but not verified, and carries no slug", async () => {
    const { db } = fakeDb({ [OWN]: PENDING });
    expect(await createGuestHostResolver(db, noInstanceHost).resolve(OWN)).toEqual({ kind: "pending", domain: OWN, eventId: "evt-1" });
  });

  it("is none for a host no event has", async () => {
    const { db } = fakeDb({});
    expect(await createGuestHostResolver(db, noInstanceHost).resolve("unknown.example.net")).toEqual({ kind: "none" });
  });

  it("is none for the host of the instance even when a row names it, verified or not", async () => {
    for (const row of [VERIFIED, PENDING]) {
      const { db } = fakeDb({ [OWN]: row });
      expect(await createGuestHostResolver(db, async () => OWN).resolve(OWN), String(row?.custom_domain_verified_at)).toEqual({ kind: "none" });
    }
  });

  it("is none, with no read, for a name no event can have: localhost, an IP address, a name with a port, a single label, an empty one", async () => {
    const { db, findUnique } = fakeDb({ localhost: VERIFIED, "1.2.3.4": VERIFIED, "[::1]": VERIFIED });
    const resolver = createGuestHostResolver(db, noInstanceHost);
    for (const name of ["localhost", "app.localhost", "1.2.3.4", "[::1]", `${OWN}:8443`, "intranet", "", "-.example.com", "a..example.com"]) {
      expect(await resolver.resolve(name), name).toEqual({ kind: "none" });
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("asks for the instance's host only for a host that is an address in the table", async () => {
    const instanceHost = vi.fn(noInstanceHost);
    const { db } = fakeDb({ [OWN]: VERIFIED });
    const resolver = createGuestHostResolver(db, instanceHost);
    await resolver.resolve("unknown.example.net");
    expect(instanceHost).not.toHaveBeenCalled();
    await resolver.resolve(OWN);
    expect(instanceHost).toHaveBeenCalledTimes(1);
  });
});

describe("the memory", () => {
  it("answers a host it has seen without reading again, for a found host and for a missing one", async () => {
    const { db, findUnique } = fakeDb({ [OWN]: VERIFIED });
    const resolver = createGuestHostResolver(db, noInstanceHost);
    for (let i = 0; i < 5; i += 1) {
      await resolver.resolve(OWN);
      await resolver.resolve("unknown.example.net");
    }
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("forgets a found host after 30 seconds and a missing one after 10, on the clock it is given", async () => {
    const time = clock();
    const { db, findUnique } = fakeDb({ [OWN]: VERIFIED });
    const resolver = createGuestHostResolver(db, noInstanceHost, { now: time.now });
    await resolver.resolve(OWN);
    await resolver.resolve("unknown.example.net");
    expect(findUnique).toHaveBeenCalledTimes(2);

    time.advance(9_999);
    await resolver.resolve(OWN);
    await resolver.resolve("unknown.example.net");
    expect(findUnique).toHaveBeenCalledTimes(2);

    time.advance(1); // 10 s: the missing one is read again, the found one is not
    await resolver.resolve(OWN);
    await resolver.resolve("unknown.example.net");
    expect(findUnique).toHaveBeenCalledTimes(3);

    time.advance(19_999); // 29.999 s since the found host was read
    await resolver.resolve(OWN);
    expect(findUnique).toHaveBeenCalledTimes(3);
    time.advance(1);
    await resolver.resolve(OWN);
    expect(findUnique).toHaveBeenCalledTimes(4);
  });

  it("sees a change of the table after the entry has expired, and not before", async () => {
    const time = clock();
    const rows: Record<string, Row> = { [OWN]: PENDING };
    const { db } = fakeDb(rows);
    const resolver = createGuestHostResolver(db, noInstanceHost, { now: time.now });
    expect((await resolver.resolve(OWN)).kind).toBe("pending");
    rows[OWN] = VERIFIED;
    time.advance(29_999);
    expect((await resolver.resolve(OWN)).kind).toBe("pending");
    time.advance(1);
    expect((await resolver.resolve(OWN)).kind).toBe("guest");
  });

  it("is emptied by clear, so a change made through this process is seen at once", async () => {
    const rows: Record<string, Row> = { [OWN]: VERIFIED };
    const { db, findUnique } = fakeDb(rows);
    const resolver = createGuestHostResolver(db, noInstanceHost);
    expect((await resolver.resolve(OWN)).kind).toBe("guest");
    expect(await resolver.resolve("other.acme.example")).toEqual({ kind: "none" });
    rows[OWN] = null;
    rows["other.acme.example"] = VERIFIED;
    resolver.clear();
    expect(resolver.size()).toEqual({ found: 0, missing: 0 });
    expect((await resolver.resolve(OWN)).kind).toBe("none");
    expect((await resolver.resolve("other.acme.example")).kind).toBe("guest");
    expect(findUnique).toHaveBeenCalledTimes(4);
  });

  it("holds at most the number of hosts it is given of each kind, however many different names come", async () => {
    const { db, findUnique } = fakeDb({ [OWN]: VERIFIED });
    const resolver = createGuestHostResolver(db, noInstanceHost, { maxEntries: 50 });
    for (let i = 0; i < 1_000; i += 1) await resolver.resolve(`random-${i}.example.net`);
    expect(findUnique).toHaveBeenCalledTimes(1_000);
    expect(resolver.size().missing).toBe(50);
    expect(resolver.size().found).toBe(0);
  });

  it("keeps the real addresses when random names flood the missing ones: the two kinds are held apart", async () => {
    const { db, findUnique } = fakeDb({ [OWN]: VERIFIED });
    const resolver = createGuestHostResolver(db, noInstanceHost, { maxEntries: 20 });
    await resolver.resolve(OWN);
    for (let i = 0; i < 500; i += 1) await resolver.resolve(`random-${i}.example.net`);
    const reads = findUnique.mock.calls.length;
    expect((await resolver.resolve(OWN)).kind).toBe("guest");
    expect(findUnique).toHaveBeenCalledTimes(reads);
  });

  it("drops the oldest found host when more addresses than it holds are found", async () => {
    const rows: Record<string, Row> = {};
    for (let i = 0; i < 6; i += 1) rows[`ev${i}.acme.example`] = { ...VERIFIED!, event: { id: `evt-${i}`, slug: `ev${i}` } };
    const { db, findUnique } = fakeDb(rows);
    const resolver = createGuestHostResolver(db, noInstanceHost, { maxEntries: 5 });
    for (let i = 0; i < 6; i += 1) await resolver.resolve(`ev${i}.acme.example`);
    expect(resolver.size().found).toBe(5);
    await resolver.resolve("ev5.acme.example");
    expect(findUnique).toHaveBeenCalledTimes(6);
    await resolver.resolve("ev0.acme.example"); // the oldest went
    expect(findUnique).toHaveBeenCalledTimes(7);
  });
});

describe("a failed read", () => {
  it("is an error that names nothing of the host or of what the database said, and is not remembered", async () => {
    const failing = new Error(`Invalid findUnique invocation with where custom_domain ${OWN}`);
    const { db, findUnique } = fakeDb({}, failing);
    const resolver = createGuestHostResolver(db, noInstanceHost);

    const error = await resolver.resolve(OWN).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GuestHostLookupError);
    expect((error as Error).message).toBe("guest host lookup failed");
    expect(String((error as Error).stack)).not.toContain(OWN);
    expect((error as Error).cause).toBeUndefined();
    await resolver.resolve(OWN).catch(() => undefined);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(resolver.size()).toEqual({ found: 0, missing: 0 });
  });

  it("is an error too when the host of the instance cannot be read", async () => {
    const { db } = fakeDb({ [OWN]: VERIFIED });
    const resolver = createGuestHostResolver(db, async () => {
      throw new Error("database is down");
    });
    await expect(resolver.resolve(OWN)).rejects.toBeInstanceOf(GuestHostLookupError);
  });
});

describe("the host of the instance", () => {
  it("is read from the configuration: the injected address first, then BASE_URL, lower case", () => {
    expect(configuredInstanceHostname("https://Tickets.Example.com/", { BASE_URL: "https://env.example.com" })).toBe("tickets.example.com");
    expect(configuredInstanceHostname("  ", { BASE_URL: "https://env.example.com" })).toBe("env.example.com");
    expect(configuredInstanceHostname(undefined, { BASE_URL: "https://env.example.com:8443" })).toBe("env.example.com");
  });

  it("is null when the configuration has none or has one that is not an address", () => {
    expect(configuredInstanceHostname(undefined, {})).toBeNull();
    expect(configuredInstanceHostname("not a url", {})).toBeNull();
  });

  it("is the host of the resolved address, null while the instance has none, and an error for any other failure", async () => {
    expect(await resolveInstanceHostname(async () => "https://Tickets.Example.com:8443")).toBe("tickets.example.com");
    expect(await resolveInstanceHostname(async () => Promise.reject(new InstanceUrlRequiredError()))).toBeNull();
    await expect(resolveInstanceHostname(async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });
});
