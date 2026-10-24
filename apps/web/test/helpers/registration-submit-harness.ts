/**
 * What the tests of `POST /r/:slug` share: an event with the pieces of an open form, a stand-in for Cloudflare's
 * siteverify that behaves as the real one does about single use, a recording clock for the floor of an answer, and an
 * app built with them. Every address and name here is synthetic.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { Prisma, PrismaClient } from "@admitto/db";
import { createApp } from "../../src/app.js";
import { setEnabledAccessMethods, ACCESS_METHODS_SETTINGS_KEY } from "../../src/registration/access-methods.js";
import { patchTurnstileSettings, TURNSTILE_SETTINGS_KEY } from "../../src/registration/turnstile-settings.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/index.js";
import type { RateLimitStore } from "../../src/rate-limit/types.js";
import type { AnswerPace } from "../../src/registration/submit-route.js";
import { acquireEventCapacityLock, type PublicWriteOptions } from "@admitto/tickets";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");

export const HOST = "tickets.example.com";
export const ORIGIN = `https://${HOST}`;
export const SITE_KEY = "1x00000000000000000000AA";
export const FUTURE = new Date("2099-05-14T12:00:00Z");
export const PAST = new Date("2020-05-14T12:00:00Z");
const PUBLISHED = new Date("2026-10-20T10:00:00Z");

let sequence = 0;
/** A synthetic address, new on every call. */
export const nextEmail = (label = "guest") => `${label}-${(sequence += 1)}@example.com`;

export type FieldSeed = Partial<Prisma.EventCustomFieldUncheckedCreateInput> & { source_field: string; label: string };

export type EventSeed = {
  date?: Date;
  archived?: boolean;
  capacity?: number | null;
  /** null: no settings row at all. */
  settings?: Partial<Prisma.EventRegistrationSettingsUncheckedCreateInput> | null;
  legal?: { privacy?: boolean; terms?: boolean; draftTerms?: boolean; consents?: string[] };
  fields?: FieldSeed[];
};

/** Creates and removes the events, organisation and system settings of one test file. */
export function eventSeeder(prisma: PrismaClient, orgId: string) {
  const eventIds: string[] = [];
  let counter = 0;

  async function addEvent(slug: string, seed: EventSeed = {}): Promise<string> {
    counter += 1;
    const id = `evt-${orgId}-${counter}`;
    eventIds.push(id);
    await prisma.event.create({
      data: {
        id,
        organization_id: orgId,
        title: `Submit Summit ${counter}`,
        slug,
        date: seed.date ?? FUTURE,
        timezone: "Europe/Warsaw",
        capacity: seed.capacity === undefined ? null : seed.capacity,
        archived_at: seed.archived ? new Date("2026-10-01T00:00:00Z") : null,
      },
    });
    if (seed.settings !== null) {
      await prisma.eventRegistrationSettings.create({
        data: {
          event_id: id,
          mode: "automatic",
          access_methods: ["link"],
          consent_keys: seed.legal?.consents ?? [],
          verify_email: true,
          waitlist_enabled: true,
          ...seed.settings,
        },
      });
    }
    const legal = { privacy: true, terms: true, draftTerms: false, consents: [] as string[], ...seed.legal };
    const rows: Prisma.LegalDocumentUncheckedCreateInput[] = [];
    if (legal.privacy) rows.push({ event_id: id, kind: "privacy_notice", title: "Privacy notice", content_html: "<p>P</p>", published_at: PUBLISHED });
    if (legal.terms) rows.push({ event_id: id, kind: "event_terms", title: "Event terms", content_html: "<p>T</p>", published_at: PUBLISHED });
    if (legal.draftTerms) rows.push({ event_id: id, kind: "event_terms", title: "Event terms", content_html: "<p>T</p>", published_at: null });
    for (const key of legal.consents) {
      rows.push({ event_id: id, kind: "consent", key, title: `Consent ${key}`, content_html: "<p>C</p>", published_at: PUBLISHED });
    }
    if (rows.length > 0) await prisma.legalDocument.createMany({ data: rows });
    for (const field of seed.fields ?? []) {
      await prisma.eventCustomField.create({ data: { event_id: id, type: "text", show_on_form: true, ...field } });
    }
    return id;
  }

  async function setSystemKeys(on: boolean): Promise<void> {
    if (on) {
      await patchTurnstileSettings(prisma, { siteKey: SITE_KEY, secretKey: "secret-key-for-tests" });
      await setEnabledAccessMethods(prisma, ["link"]);
    } else {
      await prisma.systemSettings.deleteMany({ where: { key: { in: [TURNSTILE_SETTINGS_KEY, ACCESS_METHODS_SETTINGS_KEY] } } });
    }
  }

  async function prepare(): Promise<void> {
    await prisma.event.deleteMany({ where: { organization_id: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.organization.create({ data: { id: orgId, name: `Org ${orgId}`, slug: orgId } });
    await setSystemKeys(true);
  }

  async function wipe(): Promise<void> {
    await prisma.attendeeActionLog.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.registration.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.legalDocument.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.eventCustomField.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await setSystemKeys(false);
  }

  return { addEvent, setSystemKeys, prepare, wipe };
}

/**
 * Cloudflare's siteverify as the route sees it. A token is `<kind>:<slug>:<n>`: `ok` passes once, as a real token does
 * (a second use is `timeout-or-duplicate`), `host` was solved on another host, `bound` was made for another event,
 * `refused` is a token Cloudflare turns down, `down` is a network failure, `broken` is an answer that is no JSON.
 * `whileChecking` runs while an `ok` token is being checked, before the answer: what an administrator can do during
 * the call over the network.
 */
export function cloudflare(whileChecking: () => Promise<void> = async () => {}) {
  const used = new Set<string>();
  let counter = 0;
  const fetchStub = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    const token = new URLSearchParams(String(init?.body)).get("response") ?? "";
    const [kind, slug] = token.split(":");
    const answer = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (kind === "down") throw new TypeError("fetch failed");
    if (kind === "broken") return new Response("<html>", { status: 200 });
    if (kind === "server") return answer({ success: false, "error-codes": ["internal-error"] }, 500);
    if (kind === "refused" || used.has(token)) return answer({ success: false, "error-codes": ["timeout-or-duplicate"] });
    used.add(token);
    if (kind === "host") return answer({ success: true, hostname: "evil.example", cdata: `reg-${slug}` });
    if (kind === "bound") return answer({ success: true, hostname: HOST, cdata: "reg-another-event" });
    await whileChecking();
    return answer({ success: true, hostname: HOST, cdata: `reg-${slug}` });
  });
  return {
    fetch: fetchStub as unknown as typeof fetch,
    mock: fetchStub,
    /** A token that passes once for this event. */
    token: (slug: string, kind = "ok") => `${kind}:${slug}:${(counter += 1)}`,
  };
}

/** A clock that never moves and a wait that records what it was asked for and does not wait: every answer that is
 * held asks for exactly the floor. */
export function recordingPace(floorMs = 250) {
  const sleep = vi.fn(async (_ms: number): Promise<void> => {});
  const pace: AnswerPace = { floorMs, now: () => 1000, sleep };
  return { pace, sleep };
}

/** A store that refuses the keys `deny` names, and counts like the real in-memory one for the rest. */
export class SelectiveStore implements RateLimitStore {
  readonly inner = new InMemoryRateLimitStore();
  readonly keys: string[] = [];
  deny: (key: string) => boolean = () => false;

  async hit(key: string, windowMs: number, max: number) {
    this.keys.push(key);
    if (this.deny(key)) return { allowed: false, remaining: 0, resetAt: Date.now() + windowMs };
    return this.inner.hit(key, windowMs, max);
  }

  health() {
    return this.inner.health();
  }
}

export type HarnessOptions = {
  prisma: PrismaClient;
  store?: RateLimitStore;
  /** The floor of an answer. Default: a clock that never moves and a floor of 0, so no test waits. `"real"`: the
   * route's own, real one. */
  pace?: AnswerPace | "real";
  /** How long a write waits for a lock: for the submit route and for the confirmation route alike. */
  placement?: PublicWriteOptions;
  /** Runs while the challenge of a request is being checked, before Cloudflare answers. */
  whileChallenged?: () => Promise<void>;
  /** The access log of the app (one line a request on `console.info`). Default: off, as in the tests of the other routes. */
  logHttpRequests?: boolean;
};

/** The app with the route's test injection points filled, and a way to post to it as the page does. */
export function harness(options: HarnessOptions) {
  const cf = cloudflare(options.whileChallenged);
  const store = options.store ?? new SelectiveStore();
  const app = createApp({
    prisma: options.prisma,
    checkinToken: "reg95c-submit-checkin-token-32-chars",
    allowCheckinBearer: true,
    baseUrl: ORIGIN,
    rateLimitStore: store,
    skipCheckinBootValidation: true,
    adminDistRoot,
    registrationSubmit: {
      challenge: { fetch: cf.fetch },
      ...(options.pace === "real" ? {} : { pace: options.pace ?? recordingPace(0).pace }),
      ...(options.placement ? { placement: options.placement } : {}),
    },
    ...(options.placement ? { registrationConfirm: { placement: options.placement } } : {}),
    ...(options.logHttpRequests === undefined ? {} : { logHttpRequests: options.logHttpRequests }),
  });

  /** A body the page would send for an event, with a fresh token and address; `overrides` replace any key. */
  const body = (slug: string, overrides: Record<string, unknown> = {}) => ({
    first_name: "Ada",
    last_name: "Example",
    email: nextEmail(),
    terms: true,
    consents: [] as string[],
    challenge: cf.token(slug),
    ...overrides,
  });

  const post = (slug: string, payload: unknown, init: { headers?: Record<string, string>; raw?: string } = {}) =>
    app.request(`${ORIGIN}/r/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, ...init.headers },
      body: init.raw ?? JSON.stringify(payload),
    });

  const get = (path: string) => app.request(`${ORIGIN}${path}`);

  return { app, cf, store, body, post, get };
}

/** What a response says, without the one header that changes with the clock. */
export async function signature(res: Response) {
  const headers: Record<string, string> = {};
  for (const [name, value] of res.headers.entries()) {
    if (name !== "date") headers[name] = value;
  }
  return { status: res.status, headers, body: await res.text() };
}

/**
 * What an import does to an event: a transaction of `holder` takes its capacity lock and keeps it until `release` is
 * called. `holder` is another pool than the app's, so it is another process as far as connections go.
 */
export function holdCapacityLock(holder: PrismaClient, eventId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const hasStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const transaction = holder.$transaction(
    async (tx) => {
      await acquireEventCapacityLock(tx, eventId);
      started();
      await released;
    },
    { timeout: 60_000 },
  );
  return {
    started: hasStarted,
    release: async () => {
      release();
      await transaction;
    },
  };
}

/**
 * The client, with a note of every model and transaction the code under test reaches for: a test that says "this
 * request never reads the database" or "never writes" reads the note. Everything is passed through unchanged.
 * `forget` clears the note: building the app reads some settings before any request.
 */
export function watchedClient(client: PrismaClient) {
  const touched: string[] = [];
  const proxy = new Proxy(client, {
    get(target, key, receiver) {
      if (typeof key === "string" && !key.startsWith("_") && key !== "then") touched.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
  return { client: proxy, touched, forget: () => touched.splice(0) };
}
