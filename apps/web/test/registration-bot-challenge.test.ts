import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToString, SECRET_CONTEXTS } from "@admitto/crypto";
import type { PrismaClient } from "@admitto/db";
import {
  BOT_CHALLENGE_TIMEOUT_MS,
  MAX_BOT_CHALLENGE_TOKEN_LENGTH,
  TURNSTILE_SITEVERIFY_URL,
  botChallengeCData,
  botChallengeFailureStatus,
  resolveChallengeHosts,
  verifyBotChallenge,
  verifyTurnstileToken,
  type BotChallengeFailure,
  type BotChallengeResult,
} from "../src/registration/bot-challenge.js";
import { TURNSTILE_SETTINGS_KEY, type TurnstileSettingsDb } from "../src/registration/turnstile-settings.js";
import { memorySystemSettings } from "./helpers/memory-system-settings.js";

const SECRET = "0x4AAAAAAAsecretKEYforTests_-123456";
const TOKEN = "XXXX.token.from.the.widget.XXXX";
const HOST = "tickets.example.com";
const SLUG = "summer-party";
const INPUT = { token: TOKEN, expectedHosts: [HOST], slug: SLUG };
const GENUINE = { success: true, hostname: HOST, cdata: botChallengeCData(SLUG), "error-codes": [] };

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Call {
  url: string;
  init: RequestInit;
}

/** A `fetch` that answers every call with `respond()` and remembers what it was asked. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  });
  return { fetch: fetchFn as unknown as typeof fetch, calls, fn: fetchFn };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Like a real `fetch`: rejects when its signal aborts. */
function fetchThatNeverAnswers(): typeof fetch {
  return ((_input: string | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(signal.reason));
    })) as unknown as typeof fetch;
}

/** Headers arrive, then the body stalls until the signal aborts, as a stuck server would do. */
function fetchWithStalledBody(): typeof fetch {
  return (async (_input: string | URL, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason));
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

async function verify(
  respond: () => Response | Promise<Response>,
  input: Parameters<typeof verifyTurnstileToken>[1] = INPUT,
): Promise<BotChallengeResult> {
  return verifyTurnstileToken(SECRET, input, { fetch: fakeFetch(respond).fetch });
}

function refusal(reason: BotChallengeFailure): BotChallengeResult {
  return { ok: false, reason };
}

describe("verifyTurnstileToken", () => {
  it("passes a genuine answer", async () => {
    expect(await verify(() => json(GENUINE))).toEqual({ ok: true });
  });

  it("sends the secret and the token, and nothing else, to the fixed Cloudflare address", async () => {
    const { fetch: fetchFn, calls } = fakeFetch(() => json(GENUINE));
    await verifyTurnstileToken(SECRET, INPUT, { fetch: fetchFn });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    const params = new URLSearchParams(String(init.body));
    expect([...params.keys()].sort()).toEqual(["response", "secret"]);
    expect(params.get("secret")).toBe(SECRET);
    expect(params.get("response")).toBe(TOKEN);
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers["Accept-Encoding"]).toBe("identity");
    // The secret is in the body, so a redirect must fail instead of carrying it elsewhere.
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("encodes a token with reserved characters instead of letting it add parameters", async () => {
    const { fetch: fetchFn, calls } = fakeFetch(() => json(GENUINE));
    await verifyTurnstileToken(SECRET, { ...INPUT, token: "a&secret=evil&remoteip=1.2.3.4" }, { fetch: fetchFn });
    const params = new URLSearchParams(String(calls[0]!.init.body));
    expect(params.get("secret")).toBe(SECRET);
    expect(params.get("response")).toBe("a&secret=evil&remoteip=1.2.3.4");
    expect(params.has("remoteip")).toBe(false);
  });

  describe("host", () => {
    it("refuses a token solved on another host", async () => {
      expect(await verify(() => json({ ...GENUINE, hostname: "evil.example.net" }))).toEqual(refusal("wrong_host"));
    });

    it("is exact: a parent, a subdomain or a look-alike is another host", async () => {
      for (const hostname of ["example.com", `www.${HOST}`, `${HOST}.evil.net`, `x${HOST}`, HOST.replace(".", "-")]) {
        expect(await verify(() => json({ ...GENUINE, hostname }))).toEqual(refusal("wrong_host"));
      }
    });

    it("accepts any host of the set, so the event's own address works next to the instance's", async () => {
      const input = { ...INPUT, expectedHosts: [HOST, "party.example.org"] };
      expect(await verify(() => json({ ...GENUINE, hostname: "party.example.org" }), input)).toEqual({ ok: true });
    });

    it("ignores case, a port, a scheme and a trailing dot in the expected hosts", async () => {
      for (const expected of ["Tickets.Example.COM", `${HOST}:8443`, `https://${HOST}/`, `${HOST}.`]) {
        const input = { ...INPUT, expectedHosts: [expected] };
        expect(await verify(() => json(GENUINE), input)).toEqual({ ok: true });
      }
    });

    it("compares the answered host in lower case", async () => {
      expect(await verify(() => json({ ...GENUINE, hostname: HOST.toUpperCase() }))).toEqual({ ok: true });
    });

    it("refuses everything when no expected host is usable", async () => {
      for (const expectedHosts of [[], [""], ["   "], ["http://"]]) {
        expect(await verify(() => json(GENUINE), { ...INPUT, expectedHosts })).toEqual(refusal("wrong_host"));
      }
    });

    it("does not take a host from the answer that is not a plain host name", async () => {
      // A parser that read this as a URL would see tickets.example.com and accept it.
      const hostname = `${HOST}#.evil.net`;
      expect(await verify(() => json({ ...GENUINE, hostname }))).toEqual(refusal("wrong_host"));
    });

    it("treats a successful answer with no host as unusable", async () => {
      const { hostname: _hostname, ...withoutHost } = GENUINE;
      expect(await verify(() => json(withoutHost))).toEqual(refusal("unavailable"));
      expect(await verify(() => json({ ...GENUINE, hostname: 42 }))).toEqual(refusal("unavailable"));
    });
  });

  describe("event binding", () => {
    it("refuses a token solved for another event", async () => {
      expect(await verify(() => json({ ...GENUINE, cdata: botChallengeCData("other-event") }))).toEqual(
        refusal("wrong_binding"),
      );
    });

    it("refuses an answer with no binding, or a binding that is only the slug", async () => {
      const { cdata: _cdata, ...withoutBinding } = GENUINE;
      expect(await verify(() => json(withoutBinding))).toEqual(refusal("wrong_binding"));
      expect(await verify(() => json({ ...GENUINE, cdata: SLUG }))).toEqual(refusal("wrong_binding"));
      expect(await verify(() => json({ ...GENUINE, cdata: null }))).toEqual(refusal("wrong_binding"));
    });

    it("checks the host before the binding", async () => {
      expect(await verify(() => json({ ...GENUINE, hostname: "evil.net", cdata: "nope" }))).toEqual(refusal("wrong_host"));
    });

    it("derives the widget value from the slug", () => {
      expect(botChallengeCData("summer-party")).toBe("reg-summer-party");
      // Cloudflare accepts letters, digits, underscore and hyphen, up to 255 characters.
      expect(botChallengeCData("a_b-9".repeat(16))).toMatch(/^[A-Za-z0-9_-]{1,255}$/);
    });
  });

  describe("the token", () => {
    it("is refused without calling Cloudflare when missing or not a string", async () => {
      for (const token of [undefined, null, "", 0, 12345, {}, [TOKEN], true]) {
        const { fetch: fetchFn, fn } = fakeFetch(() => json(GENUINE));
        const result = await verifyTurnstileToken(SECRET, { ...INPUT, token }, { fetch: fetchFn });
        expect(result).toEqual(refusal("missing_token"));
        expect(fn).not.toHaveBeenCalled();
      }
    });

    it("is refused without calling Cloudflare when longer than Cloudflare issues", async () => {
      const { fetch: fetchFn, fn } = fakeFetch(() => json(GENUINE));
      const tooLong = "x".repeat(MAX_BOT_CHALLENGE_TOKEN_LENGTH + 1);
      expect(await verifyTurnstileToken(SECRET, { ...INPUT, token: tooLong }, { fetch: fetchFn })).toEqual(
        refusal("rejected"),
      );
      expect(fn).not.toHaveBeenCalled();
    });

    it("is sent when exactly as long as the limit", async () => {
      const { fetch: fetchFn, fn } = fakeFetch(() => json(GENUINE));
      const longest = "x".repeat(MAX_BOT_CHALLENGE_TOKEN_LENGTH);
      expect(await verifyTurnstileToken(SECRET, { ...INPUT, token: longest }, { fetch: fetchFn })).toEqual({ ok: true });
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("a refusal from Cloudflare", () => {
    it.each(["invalid-input-response", "timeout-or-duplicate", "missing-input-response", "some-new-code"])(
      "is `rejected` for %s",
      async (code) => {
        expect(await verify(() => json({ success: false, "error-codes": [code] }))).toEqual(refusal("rejected"));
      },
    );

    it("is `rejected` when no code is given", async () => {
      expect(await verify(() => json({ success: false }))).toEqual(refusal("rejected"));
    });

    it.each(["invalid-input-secret", "missing-input-secret"])("blames the saved secret for %s", async (code) => {
      expect(await verify(() => json({ success: false, "error-codes": [code] }))).toEqual(refusal("secret_rejected"));
      // Cloudflare answers a bad secret with HTTP 400; it is the same refusal.
      expect(await verify(() => json({ success: false, "error-codes": [code] }, 400))).toEqual(
        refusal("secret_rejected"),
      );
    });

    it.each(["internal-error", "bad-request"])("is `unavailable` for %s", async (code) => {
      expect(await verify(() => json({ success: false, "error-codes": [code] }))).toEqual(refusal("unavailable"));
    });

    it("never passes a success flag that comes with an error code", async () => {
      expect(await verify(() => json({ ...GENUINE, "error-codes": ["internal-error"] }))).toEqual(
        refusal("unavailable"),
      );
      expect(await verify(() => json({ ...GENUINE, "error-codes": ["invalid-input-secret"] }))).toEqual(
        refusal("secret_rejected"),
      );
    });
  });

  describe("Cloudflare's published test keys", () => {
    // What the live endpoint answered for the always-pass and the always-fail dummy secrets.
    const PASS_DUMMY = {
      challenge_ts: "2026-10-21T07:24:57.297Z",
      "error-codes": [],
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
      success: true,
    };
    const FAIL_DUMMY = {
      "error-codes": ["invalid-input-response"],
      success: false,
      messages: [],
      metadata: { result_with_testing_key: true },
    };

    it("never open the form, and are told apart from a guest's mistake", async () => {
      expect(await verify(() => json(PASS_DUMMY))).toEqual(refusal("secret_rejected"));
      expect(await verify(() => json(FAIL_DUMMY))).toEqual(refusal("secret_rejected"));
    });

    it("stay refused even for an instance that is served from example.com", async () => {
      const input = { ...INPUT, expectedHosts: ["example.com"] };
      expect(await verify(() => json(PASS_DUMMY), input)).toEqual(refusal("secret_rejected"));
    });

    it("are told apart only by Cloudflare's own marker, and a false or odd marker changes nothing", async () => {
      for (const metadata of [{ result_with_testing_key: false }, {}, null, "yes", 1, [], { result_with_testing_key: "true" }]) {
        expect(await verify(() => json({ ...GENUINE, metadata }))).toEqual({ ok: true });
        expect(await verify(() => json({ ...FAIL_DUMMY, metadata }))).toEqual(refusal("rejected"));
      }
    });
  });

  describe("no usable answer is never a pass", () => {
    it("answers `unavailable` for a 500, even when its body says success", async () => {
      expect(await verify(() => json(GENUINE, 500))).toEqual(refusal("unavailable"));
      expect(await verify(() => new Response("upstream down", { status: 500 }))).toEqual(refusal("unavailable"));
    });

    it.each([400, 403, 404, 429, 502, 503])("answers `unavailable` for HTTP %i with a success body", async (status) => {
      expect(await verify(() => json(GENUINE, status))).toEqual(refusal("unavailable"));
    });

    it("answers `unavailable` when the body is not JSON", async () => {
      expect(await verify(() => new Response("<html>Bad gateway</html>", { status: 200 }))).toEqual(
        refusal("unavailable"),
      );
      expect(await verify(() => new Response("", { status: 200 }))).toEqual(refusal("unavailable"));
      expect(await verify(() => new Response("{\"success\": tru", { status: 200 }))).toEqual(refusal("unavailable"));
    });

    it("answers `unavailable` when the JSON is not an object with a boolean success", async () => {
      for (const body of [null, [], [GENUINE], "ok", 1, true, {}, { success: "true" }, { success: 1 }, { success: null }]) {
        expect(await verify(() => json(body))).toEqual(refusal("unavailable"));
      }
    });

    it("answers `unavailable` when the network fails", async () => {
      const failing = vi.fn(async () => {
        throw new TypeError("fetch failed: ECONNREFUSED");
      }) as unknown as typeof fetch;
      const result = await verifyTurnstileToken(SECRET, INPUT, { fetch: failing });
      expect(result).toEqual(refusal("unavailable"));
      // The reason is a code, never the error text, which could carry the address or the secret.
      expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
    });

    it("answers `unavailable` when the request is redirected", async () => {
      const redirected = vi.fn(async () => {
        throw new TypeError("fetch failed: unexpected redirect");
      }) as unknown as typeof fetch;
      expect(await verifyTurnstileToken(SECRET, INPUT, { fetch: redirected })).toEqual(refusal("unavailable"));
    });

    it("answers `unavailable` when the body is larger than an answer can be", async () => {
      const huge = JSON.stringify({ ...GENUINE, padding: "x".repeat(64 * 1024) });
      expect(await verify(() => new Response(huge, { status: 200 }))).toEqual(refusal("unavailable"));
      const declared = new Response(JSON.stringify(GENUINE), {
        status: 200,
        headers: { "Content-Length": String(1024 * 1024) },
      });
      expect(await verify(() => declared)).toEqual(refusal("unavailable"));
    });
  });

  describe("timeout", () => {
    it("gives up on a call that never answers and refuses", async () => {
      const started = Date.now();
      const result = await verifyTurnstileToken(SECRET, INPUT, { fetch: fetchThatNeverAnswers(), timeoutMs: 30 });
      expect(result).toEqual(refusal("unavailable"));
      expect(Date.now() - started).toBeLessThan(2_000);
    });

    it("gives up on a body that stalls after the headers arrived, and refuses", async () => {
      const result = await verifyTurnstileToken(SECRET, INPUT, { fetch: fetchWithStalledBody(), timeoutMs: 30 });
      expect(result).toEqual(refusal("unavailable"));
    });

    it("waits five seconds by default and does not retry", async () => {
      expect(BOT_CHALLENGE_TIMEOUT_MS).toBe(5_000);
      const { fetch: fetchFn, fn } = fakeFetch(() => json(GENUINE, 500));
      await verifyTurnstileToken(SECRET, INPUT, { fetch: fetchFn });
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  it("never carries the token or the secret in a refusal", async () => {
    const bodies: Array<() => Response> = [
      () => json({ success: false, "error-codes": ["invalid-input-response"] }),
      () => json({ success: false, "error-codes": ["invalid-input-secret"] }, 400),
      () => json({ ...GENUINE, hostname: "evil.net" }),
      () => new Response("not json", { status: 500 }),
    ];
    for (const respond of bodies) {
      const text = JSON.stringify(await verify(respond));
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(TOKEN);
    }
  });

  it("writes nothing to the console for any outcome", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    try {
      await verify(() => json(GENUINE));
      await verify(() => json(GENUINE, 500));
      await verifyTurnstileToken(SECRET, INPUT, { fetch: fetchThatNeverAnswers(), timeoutMs: 10 });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("resolveChallengeHosts", () => {
  const db = (instanceUrl?: string) =>
    ({
      systemSettings: {
        findUnique: vi.fn(async () =>
          instanceUrl === undefined ? null : { key: "instance_url", value_json: JSON.stringify(instanceUrl), updated_at: new Date() },
        ),
      },
    }) as unknown as PrismaClient;
  const production = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  // The saved instance URL is read through the settings resolver, which looks at process.env's BASE_URL
  // first (the test environment sets one), so these cases clear it.
  beforeEach(() => {
    vi.stubEnv("BASE_URL", "");
  });

  it("takes the instance host from the URL the app was started with", async () => {
    expect(await resolveChallengeHosts(db(), { injectedBaseUrl: "https://Tickets.Example.com:8443/", env: production })).toEqual([
      "tickets.example.com",
    ]);
  });

  it("takes it from BASE_URL, then from the saved instance URL", async () => {
    expect(await resolveChallengeHosts(db("https://saved.example.com"), { env: { ...production, BASE_URL: "https://env.example.com" } })).toEqual([
      "env.example.com",
    ]);
    expect(await resolveChallengeHosts(db("https://saved.example.com"), { env: production })).toEqual(["saved.example.com"]);
  });

  it("adds the event's own verified address, in the same plain form", async () => {
    const hosts = await resolveChallengeHosts(db(), {
      injectedBaseUrl: "https://tickets.example.com",
      eventHost: "Party.Example.org:443",
      env: production,
    });
    expect(hosts).toEqual(["tickets.example.com", "party.example.org"]);
  });

  it("leaves out an event address that is not a host, and an event with none", async () => {
    for (const eventHost of [null, undefined, "", "   ", "http://"]) {
      expect(await resolveChallengeHosts(db(), { injectedBaseUrl: "https://tickets.example.com", eventHost, env: production })).toEqual([
        "tickets.example.com",
      ]);
    }
  });

  it("leaves out the instance host when there is no usable instance URL, so the check refuses", async () => {
    expect(await resolveChallengeHosts(db(), { env: production })).toEqual([]);
    expect(await resolveChallengeHosts(db(), { env: production, eventHost: "party.example.org" })).toEqual(["party.example.org"]);
    const result = await verifyTurnstileToken(SECRET, { ...INPUT, expectedHosts: [] }, { fetch: fakeFetch(() => json(GENUINE)).fetch });
    expect(result).toEqual(refusal("wrong_host"));
  });
});

describe("botChallengeFailureStatus", () => {
  it("blames the guest with 400 and the instance or Cloudflare with 503", () => {
    const expected: Record<BotChallengeFailure, 400 | 503> = {
      missing_token: 400,
      rejected: 400,
      wrong_host: 400,
      wrong_binding: 400,
      not_configured: 503,
      secret_rejected: 503,
      unavailable: 503,
    };
    for (const [reason, status] of Object.entries(expected)) {
      expect(botChallengeFailureStatus(reason as BotChallengeFailure)).toBe(status);
    }
  });
});

/** A SystemSettings table with one Turnstile value, as much of the database as the keys need. */
function settingsDb(value: string | null): { db: TurnstileSettingsDb } {
  const memory = memorySystemSettings(value === null ? {} : { [TURNSTILE_SETTINGS_KEY]: value });
  return { db: { systemSettings: memory.systemSettings } as unknown as TurnstileSettingsDb };
}

const storedKeys = (secret = SECRET, siteKey = "0x4AAAAAAAsite") =>
  JSON.stringify({ siteKey, secretEnc: encryptToString(secret, SECRET_CONTEXTS.turnstileSecret) });

describe("verifyBotChallenge", () => {
  it("is closed without keys, for any host, and never calls Cloudflare", async () => {
    for (const expectedHosts of [[HOST], ["localhost"], ["localhost:3000"], ["127.0.0.1"], []]) {
      const { db } = settingsDb(null);
      const { fetch: fetchFn, fn } = fakeFetch(() => json(GENUINE));
      const result = await verifyBotChallenge(db, { ...INPUT, expectedHosts }, { fetch: fetchFn });
      expect(result).toEqual(refusal("not_configured"));
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("is closed without keys in development too, with the instance at localhost and a request for localhost", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BASE_URL", "http://localhost:3000");
    const { db } = settingsDb(null);
    const { fetch: fetchFn, fn } = fakeFetch(() => json({ ...GENUINE, hostname: "localhost" }));
    const input = { token: "XXXX.DUMMY.TOKEN.XXXX", expectedHosts: ["localhost"], slug: SLUG };
    expect(await verifyBotChallenge(db, input, { fetch: fetchFn })).toEqual(refusal("not_configured"));
    expect(fn).not.toHaveBeenCalled();
  });

  it("is closed with only one of the two keys", async () => {
    const siteKeyOnly = JSON.stringify({ siteKey: "0x4AAAAAAAsite", secretEnc: null });
    const secretOnly = JSON.stringify({ siteKey: null, secretEnc: encryptToString(SECRET, SECRET_CONTEXTS.turnstileSecret) });
    for (const value of [siteKeyOnly, secretOnly, "{}"]) {
      const { fetch: fetchFn, fn } = fakeFetch(() => json(GENUINE));
      const result = await verifyBotChallenge(settingsDb(value).db, INPUT, { fetch: fetchFn });
      expect(result).toEqual(refusal("not_configured"));
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("is closed when the stored value is corrupt, or its secret cannot be decrypted", async () => {
    const wrongContext = JSON.stringify({ siteKey: "0x4AAAAAAAsite", secretEnc: encryptToString(SECRET, "another-purpose") });
    const notCiphertext = JSON.stringify({ siteKey: "0x4AAAAAAAsite", secretEnc: "plain text secret" });
    for (const value of ["not json", "null", "[]", "\"text\"", wrongContext, notCiphertext]) {
      const { fetch: fetchFn, fn } = fakeFetch(() => json(GENUINE));
      const result = await verifyBotChallenge(settingsDb(value).db, INPUT, { fetch: fetchFn });
      expect(result).toEqual(refusal("not_configured"));
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("checks with the decrypted secret when both keys are saved", async () => {
    const { fetch: fetchFn, calls } = fakeFetch(() => json(GENUINE));
    const result = await verifyBotChallenge(settingsDb(storedKeys()).db, INPUT, { fetch: fetchFn });
    expect(result).toEqual({ ok: true });
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("secret")).toBe(SECRET);
  });

  it("still refuses a wrong host or event when the keys are fine", async () => {
    const db = settingsDb(storedKeys()).db;
    expect(await verifyBotChallenge(db, INPUT, { fetch: fakeFetch(() => json({ ...GENUINE, hostname: "x.net" })).fetch })).toEqual(
      refusal("wrong_host"),
    );
    expect(
      await verifyBotChallenge(db, { ...INPUT, slug: "another" }, { fetch: fakeFetch(() => json(GENUINE)).fetch }),
    ).toEqual(refusal("wrong_binding"));
  });

  it("reads the keys at every call from the same database, so a rotated secret takes effect at once", async () => {
    const memory = memorySystemSettings({ [TURNSTILE_SETTINGS_KEY]: storedKeys("first-secret-value") });
    const db = { systemSettings: memory.systemSettings } as unknown as TurnstileSettingsDb;
    const { fetch: fetchFn, calls } = fakeFetch(() => json(GENUINE));
    await verifyBotChallenge(db, INPUT, { fetch: fetchFn });
    memory.rows().set(TURNSTILE_SETTINGS_KEY, storedKeys("second-secret-value"));
    await verifyBotChallenge(db, INPUT, { fetch: fetchFn });
    memory.rows().delete(TURNSTILE_SETTINGS_KEY);
    expect(await verifyBotChallenge(db, INPUT, { fetch: fetchFn })).toEqual(refusal("not_configured"));
    expect(calls).toHaveLength(2);
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("secret")).toBe("first-secret-value");
    expect(new URLSearchParams(String(calls[1]!.init.body)).get("secret")).toBe("second-secret-value");
    expect(memory.systemSettings.findUnique).toHaveBeenCalledTimes(3);
  });

  it("refuses with `unavailable`, as a value and not as an error, when the keys cannot be read", async () => {
    const failing = {
      systemSettings: {
        findUnique: vi.fn(async () => {
          throw new Error("connection lost: password=hunter2");
        }),
      },
    } as unknown as TurnstileSettingsDb;
    const { fetch: fetchFn, fn } = fakeFetch(() => json(GENUINE));
    const result = await verifyBotChallenge(failing, INPUT, { fetch: fetchFn });
    expect(result).toEqual(refusal("unavailable"));
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(fn).not.toHaveBeenCalled();
  });
});
