import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@admitto/auth";
import { REGISTRATION_PASSWORD_MAX } from "@admitto/shared";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { clearEventPassword, isEventPassword, notePasswordTriesRefused, setEventPassword } from "../../src/registration/event-password.js";

// The real check and the real hash run; this only counts how often they were asked to do their work.
const work = vi.hoisted(() => ({ hashes: 0, made: 0 }));
vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    verifyPasswordOrDummy: (candidate: string, hash: string | null) => {
      work.hashes += 1;
      return actual.verifyPasswordOrDummy(candidate, hash);
    },
    hashPassword: async (plaintext: string) => {
      const hash = await actual.hashPassword(plaintext);
      work.made += 1;
      return hash;
    },
  };
});

const PASSWORD = "test-password";
let hash: string;

beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  work.hashes = 0;
  work.made = 0;
});

describe("isEventPassword", () => {
  it("is true for the password and false for any other text, one letter off or a space at an end included", async () => {
    expect(await isEventPassword(PASSWORD, hash)).toBe(true);
    for (const wrong of ["wrong-password", `${PASSWORD}x`, PASSWORD.slice(1), PASSWORD.toUpperCase(), ` ${PASSWORD}`, `${PASSWORD} `, ""]) {
      expect(await isEventPassword(wrong, hash), JSON.stringify(wrong)).toBe(false);
    }
  });

  it("takes a password of a space and a password of the longest length, in characters", async () => {
    const spaces = " ".repeat(8);
    const longest = String.fromCodePoint(0x1f600).repeat(REGISTRATION_PASSWORD_MAX);
    expect(await isEventPassword(spaces, await hashPassword(spaces))).toBe(true);
    expect(await isEventPassword(longest, await hashPassword(longest))).toBe(true);
  });

  it("costs no hash for a try that is not a text, is missing, or is longer than a password can be: it is a wrong password", async () => {
    const tooLong = "x".repeat(REGISTRATION_PASSWORD_MAX + 1);
    const tooLongInCharacters = String.fromCodePoint(0x1f600).repeat(REGISTRATION_PASSWORD_MAX + 1);

    for (const wrong of [undefined, null, 12_345_678, true, [PASSWORD], { value: PASSWORD }, tooLong, tooLongInCharacters, "x".repeat(60 * 1024)]) {
      expect(await isEventPassword(wrong, hash)).toBe(false);
    }

    expect(work.hashes).toBe(0);
  });

  it("does one hash for a try that could be the password, whether it is right or not, even an empty one", async () => {
    await isEventPassword(PASSWORD, hash);
    await isEventPassword("wrong-password", hash);
    await isEventPassword("", hash);
    await isEventPassword("x".repeat(REGISTRATION_PASSWORD_MAX), hash);

    expect(work.hashes).toBe(4);
  });

  it("is false, and does not throw, for a stored value that is not a hash", async () => {
    expect(await isEventPassword(PASSWORD, "not-an-argon2-hash")).toBe(false);
    expect(await isEventPassword(PASSWORD, PASSWORD)).toBe(false);
  });
});

describe("notePasswordTriesRefused", () => {
  beforeEach(() => {
    resetSystemLogBufferForTest();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T10:00:00.000Z"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const lines = () => querySystemLogs({ search: "registration_password_tries_refused" });

  it("writes one warning with the id of the event and which budget, and nothing else, however often the budget is found spent", () => {
    for (let i = 0; i < 20; i += 1) notePasswordTriesRefused("evt-pw-a", "client");

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ level: "warn", source: "security", fields: { event_id: "evt-pw-a", budget: "client" } });
    expect(Object.keys(lines()[0]!.fields ?? {}).sort()).toEqual(["budget", "event_id"]);
  });

  it("keeps a count for each event and each budget apart, and writes again an hour later", () => {
    notePasswordTriesRefused("evt-pw-b", "client");
    notePasswordTriesRefused("evt-pw-b", "event");
    notePasswordTriesRefused("evt-pw-c", "client");
    vi.advanceTimersByTime(59 * 60_000);
    notePasswordTriesRefused("evt-pw-b", "client");
    expect(lines()).toHaveLength(3);

    vi.advanceTimersByTime(2 * 60_000);
    notePasswordTriesRefused("evt-pw-b", "client");
    expect(lines()).toHaveLength(4);
  });

  it("remembers at most 500 of them, so that the memory it uses is bounded", async () => {
    // The memory is module state: a copy of the module of its own, so that the events above are not in it.
    vi.resetModules();
    const { notePasswordTriesRefused: fresh } = await import("../../src/registration/event-password.js");
    const freshLog = await import("@admitto/shared/system-log");
    const freshLines = () => freshLog.querySystemLogs({ search: "registration_password_tries_refused" });
    for (let i = 0; i < 500; i += 1) fresh(`evt-pw-bound-${i}`, "event");
    expect(freshLines()).toHaveLength(500);

    fresh("evt-pw-bound-0", "event");
    expect(freshLines()).toHaveLength(500);
    // A 501st one makes room by forgetting the others.
    fresh("evt-pw-bound-500", "event");
    fresh("evt-pw-bound-0", "event");
    expect(freshLines()).toHaveLength(502);
  });
});

describe("setEventPassword and clearEventPassword, on a database that records what it is asked", () => {
  const ACTOR = { operator: "staff-1", sessionId: "session-1", ip: "198.51.100.1", timezone: "UTC" };

  /** A database whose transaction runs the work on a client that records its calls. */
  function fakeDatabase(options: { event?: { organization_id: string; title: string } | null; cleared?: number } = {}) {
    const event = options.event === undefined ? { organization_id: "org-1", title: "Summit" } : options.event;
    const seen: string[] = [];
    const tx = {
      event: { findUnique: vi.fn(async () => event) },
      eventRegistrationSettings: {
        upsert: vi.fn(async (_args: unknown) => ({})),
        updateMany: vi.fn(async (_args: unknown) => ({ count: options.cleared ?? 1 })),
      },
      adminAuditLog: { create: vi.fn(async (_args: unknown) => ({})) },
      user: { findUnique: vi.fn(async () => ({ email: "staff@example.com", display_name: null })) },
    };
    const db = {
      $transaction: vi.fn(async (work_: (client: typeof tx) => Promise<unknown>) => {
        seen.push(`transaction opened after ${work.made} hash(es) were made`);
        return work_(tx);
      }),
    };
    return { db: db as never, tx, seen };
  }

  it("computes the hash before it opens the transaction, which would otherwise hold a connection for the work of the hash", async () => {
    const { db, seen } = fakeDatabase();

    expect(await setEventPassword(db, { eventId: "evt-1", password: PASSWORD, actor: ACTOR })).toBe("ok");

    expect(seen).toEqual(["transaction opened after 1 hash(es) were made"]);
  });

  it("stores the hash of the password under the event, for a row that exists and for one that does not, and the password nowhere", async () => {
    const { db, tx } = fakeDatabase();

    await setEventPassword(db, { eventId: "evt-1", password: PASSWORD, actor: ACTOR });

    const call = tx.eventRegistrationSettings.upsert.mock.calls[0]![0] as {
      where: unknown;
      create: { event_id: string; password_hash: string };
      update: { password_hash: string };
    };
    expect(call.where).toEqual({ event_id: "evt-1" });
    expect(call.create.event_id).toBe("evt-1");
    expect(call.create.password_hash).toMatch(/^\$argon2id\$/);
    expect(call.update).toEqual({ password_hash: call.create.password_hash });
    expect(JSON.stringify(tx.eventRegistrationSettings.upsert.mock.calls)).not.toContain(PASSWORD);
    expect(await isEventPassword(PASSWORD, call.create.password_hash)).toBe(true);
  });

  it("writes one audit entry in the same transaction: what happened, to which event, in which organisation, by whom, and no word of the password", async () => {
    const { db, tx } = fakeDatabase();

    await setEventPassword(db, { eventId: "evt-1", password: PASSWORD, actor: ACTOR });
    await clearEventPassword(db, { eventId: "evt-1", actor: ACTOR });

    const entries = tx.adminAuditLog.create.mock.calls.map(([args]) => (args as { data: Record<string, unknown> }).data);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      organization_id: "org-1",
      actor_user_id: "staff-1",
      action_type: "registration_password_changed",
      session_id: "session-1",
      ip: "198.51.100.1",
      metadata: { event_id: "evt-1", event_title: "Summit", change: "set" },
    });
    expect(entries[1]).toMatchObject({ action_type: "registration_password_changed", metadata: { event_id: "evt-1", event_title: "Summit", change: "cleared" } });
    expect(JSON.stringify(entries)).not.toContain(PASSWORD);
    expect(JSON.stringify(entries)).not.toContain("argon2");
  });

  it("does nothing and says so when the event is not there: no row, no audit entry", async () => {
    const { db, tx } = fakeDatabase({ event: null });

    expect(await setEventPassword(db, { eventId: "evt-gone", password: PASSWORD, actor: ACTOR })).toBe("not_found");
    expect(await clearEventPassword(db, { eventId: "evt-gone", actor: ACTOR })).toBe("not_found");

    expect(tx.eventRegistrationSettings.upsert).not.toHaveBeenCalled();
    expect(tx.eventRegistrationSettings.updateMany).not.toHaveBeenCalled();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("switches the password off only where there is one, and records the change only when there was one to switch off", async () => {
    const withPassword = fakeDatabase({ cleared: 1 });
    const without = fakeDatabase({ cleared: 0 });

    expect(await clearEventPassword(withPassword.db, { eventId: "evt-1", actor: ACTOR })).toBe("ok");
    expect(await clearEventPassword(without.db, { eventId: "evt-1", actor: ACTOR })).toBe("ok");

    expect(withPassword.tx.eventRegistrationSettings.updateMany.mock.calls[0]![0]).toEqual({
      where: { event_id: "evt-1", password_hash: { not: null } },
      data: { password_hash: null },
    });
    expect(withPassword.tx.adminAuditLog.create).toHaveBeenCalledOnce();
    expect(without.tx.adminAuditLog.create).not.toHaveBeenCalled();
    expect(work.made).toBe(0);
  });
});
