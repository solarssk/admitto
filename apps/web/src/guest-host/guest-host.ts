/**
 * Which event, if any, a request's host belongs to (D-C6, PR 119b): the lookup of a host name among the events' own addresses, held
 * in the memory of the process so that a host name a stranger makes up costs one indexed read and then nothing.
 *
 * - `guest`: the host is the VERIFIED own address of an event. Everything the application answers there is the guest's side of that
 *   one event and nothing of the panel (see ./guest-paths.ts and ./guest-host-middleware.ts).
 * - `pending`: an address is set but not verified yet. The application answers as it does on any other host, except for the proof
 *   at `/.well-known/admitto-domain-check` (the check of PR 120 asks for it before it can verify anything).
 * - `none`: not an address of an event. This includes the host of the instance itself, whatever the table holds.
 *
 * What is cached is bounded twice: found entries live 30 s, missing ones 10 s, and each kind holds at most `maxEntries` hosts
 * (the oldest goes first), so random names from outside cannot grow the memory or push the real addresses out. A change of an
 * address through this process clears the cache (`clear`); another process catches up when the entries expire.
 */
import type { PrismaClient } from "@admitto/db";
import { parseCustomDomain } from "@admitto/shared";
import { InstanceUrlRequiredError } from "../instance-base-url.js";

export type GuestHost =
  | { kind: "guest"; domain: string; eventId: string; slug: string }
  | { kind: "pending"; domain: string; eventId: string }
  | { kind: "none" };

export const NOT_A_GUEST_HOST: GuestHost = { kind: "none" };

export interface GuestHostCacheOptions {
  /** The clock of the cache, for a test. */
  now?: () => number;
  /** How long a host that is an address is remembered (default 30 s). */
  foundTtlMs?: number;
  /** How long a host that is not is remembered (default 10 s). */
  missingTtlMs?: number;
  /** The most hosts held of each kind (default 1000). */
  maxEntries?: number;
}

export interface GuestHostResolver {
  /** The kind of host `hostname` is. A name that cannot be an address of an event is `none` without a read. */
  resolve(hostname: string): Promise<GuestHost>;
  /** Forget everything, after an address was changed through this process. */
  clear(): void;
  /** How many hosts are held of each kind (a test reads it). */
  size(): { found: number; missing: number };
}

/** The lookup failed: a fixed message, because what the database says can carry the host name, which came from the request. */
export class GuestHostLookupError extends Error {
  constructor() {
    super("guest host lookup failed");
    this.name = "GuestHostLookupError";
  }
}

/** A map whose entries expire and whose size is bounded: when it is full the oldest entry goes. */
class ExpiringMap<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt > this.now()) return entry.value;
    this.entries.delete(key);
    return undefined;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    if (this.entries.size >= this.max) {
      // A Map keeps insertion order, so the first key is the oldest. With a `max` of 0 there is none and the delete does nothing.
      this.entries.delete(this.entries.keys().next().value as string);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** The host of the instance, lower case, or null while it has none. Called only for a host that is an address in the table. */
export type InstanceHostname = () => Promise<string | null>;

async function readHost(db: PrismaClient, hostname: string, instanceHostname: InstanceHostname): Promise<GuestHost> {
  const row = await db.eventRegistrationSettings.findUnique({
    where: { custom_domain: hostname },
    select: { custom_domain_verified_at: true, event: { select: { id: true, slug: true } } },
  });
  if (row === null) return NOT_A_GUEST_HOST;
  // The panel is on the host of the instance: a row that names it (the setting refuses it, a hand-written one may not) never turns it into a guest's page.
  if ((await instanceHostname()) === hostname) return NOT_A_GUEST_HOST;
  return row.custom_domain_verified_at === null
    ? { kind: "pending", domain: hostname, eventId: row.event.id }
    : { kind: "guest", domain: hostname, eventId: row.event.id, slug: row.event.slug };
}

export function createGuestHostResolver(
  db: PrismaClient,
  instanceHostname: InstanceHostname,
  options: GuestHostCacheOptions = {},
): GuestHostResolver {
  const now = options.now ?? Date.now;
  const max = options.maxEntries ?? 1_000;
  const found = new ExpiringMap<GuestHost>(max, options.foundTtlMs ?? 30_000, now);
  const missing = new ExpiringMap<true>(max, options.missingTtlMs ?? 10_000, now);

  return {
    async resolve(hostname) {
      // A name the setting would refuse is no address of an event, whatever the table holds: no read for localhost, an IP address or a name with a port.
      if (!parseCustomDomain(hostname).ok) return NOT_A_GUEST_HOST;
      const known = found.get(hostname);
      if (known !== undefined) return known;
      if (missing.get(hostname) !== undefined) return NOT_A_GUEST_HOST;
      let host: GuestHost;
      try {
        host = await readHost(db, hostname, instanceHostname);
      } catch {
        throw new GuestHostLookupError();
      }
      if (host.kind === "none") missing.set(hostname, true);
      else found.set(hostname, host);
      return host;
    },
    clear() {
      found.clear();
      missing.clear();
    },
    size: () => ({ found: found.size, missing: missing.size }),
  };
}

/** The host name of the instance as the configuration gives it (the injected address, else `BASE_URL`), or null when neither is set. */
export function configuredInstanceHostname(injectedBaseUrl: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = injectedBaseUrl?.trim() || env["BASE_URL"]?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The host name of the instance by every source, the database's setting included, or null while the instance has no address. */
export async function resolveInstanceHostname(resolveBaseUrl: () => Promise<string>): Promise<string | null> {
  try {
    return new URL(await resolveBaseUrl()).hostname.toLowerCase();
  } catch (error) {
    if (error instanceof InstanceUrlRequiredError) return null;
    throw error;
  }
}
