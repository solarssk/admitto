/**
 * What the check of an event's own address writes (D-C6, PR 120): the first ok verifies, a later failure only warns, a check for an
 * address that was changed meanwhile writes nothing, two checks at once leave one consistent state, and the daily refresh looks at
 * the addresses that are due and no others.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import { signDomainCheck } from "@admitto/crypto";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  DOMAIN_CHECK_REFRESH_MS,
  DOMAIN_CHECK_SWEEP_BATCH,
  checkEventDomain,
  readDomainCheckState,
  recordDomainCheck,
  refreshEventDomains,
  type DomainCheckDeps,
} from "../src/index.js";
import { resetDb } from "./resetDb.js";
import { seedOrgAndEvent } from "./seedOrgAndEvent.js";

const prisma = createTestPrismaClient();
const ORG_ID = "org-domain-check";
const EVENT_ID = "evt-domain-check";
const DOMAIN = "summit.acme.example";
const PUBLIC_ADDRESS: LookupAddress = { address: "203.0.113.10", family: 4 };
const HOUR = 3_600_000;

beforeAll(async () => {
  await resetDb();
  await seedOrgAndEvent(prisma, {
    orgId: ORG_ID,
    orgName: "Domain Check Org",
    orgSlug: "domain-check-org",
    eventId: EVENT_ID,
    eventTitle: "Domain Check",
    eventSlug: "domain-check",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createEvent(id: string, settings: Record<string, unknown> | null, archived = false) {
  await prisma.event.create({
    data: {
      id,
      organization_id: ORG_ID,
      title: id,
      slug: id,
      date: new Date("2026-09-01"),
      ...(archived ? { archived_at: new Date() } : {}),
    },
  });
  if (settings) await prisma.eventRegistrationSettings.create({ data: { event_id: id, ...settings } });
}

beforeEach(async () => {
  await prisma.eventRegistrationSettings.deleteMany();
  await prisma.event.deleteMany({ where: { id: { not: EVENT_ID } } });
  await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_ID, custom_domain: DOMAIN } });
});

const state = () => readDomainCheckState(prisma, EVENT_ID);

/** A pinned request that answers with the proof of the event, after `delayMs`. */
const proofAfter = (delayMs = 0, eventId = EVENT_ID, domain = DOMAIN): NonNullable<DomainCheckDeps["fetchPinned"]> =>
  (async (_url: unknown, _host: unknown, _records: unknown, _init: unknown, handler: (response: Response) => Promise<unknown>) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return handler(
      new Response(JSON.stringify({ ok: true, mac: signDomainCheck(eventId, domain) }), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }) as never;

/** A pinned request that finds a wrong target, after `delayMs`. */
const wrongAfter = (delayMs = 0): NonNullable<DomainCheckDeps["fetchPinned"]> =>
  (async (_url: unknown, _host: unknown, _records: unknown, _init: unknown, handler: (response: Response) => Promise<unknown>) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return handler(new Response("not found", { status: 404 }));
  }) as never;

const resolve = async () => [PUBLIC_ADDRESS];

describe("recordDomainCheck: what a result writes", () => {
  it("writes the first ok as verified, with the time of the write and not the time the check began", async () => {
    const startedAt = new Date("2026-11-12T10:00:00.000Z");
    const finished = new Date("2026-11-12T10:00:03.000Z");
    const recorded = await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "ok", startedAt, now: () => finished });
    expect(recorded).toEqual({ kind: "recorded", firstVerified: true, wentFailing: false });
    expect(await state()).toEqual({
      custom_domain: DOMAIN,
      custom_domain_status: "ok",
      custom_domain_check_result: "ok",
      custom_domain_verified_at: finished,
      custom_domain_checked_at: finished,
    });
  });

  it("keeps the time of the first ok on a later ok", async () => {
    const first = new Date("2026-11-12T10:00:00.000Z");
    await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "ok", startedAt: first, now: () => first });
    const later = new Date("2026-11-13T10:00:00.000Z");
    const recorded = await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "ok", startedAt: later, now: () => later });
    expect(recorded).toEqual({ kind: "recorded", firstVerified: false, wentFailing: false });
    expect(await state()).toMatchObject({ custom_domain_verified_at: first, custom_domain_checked_at: later });
  });

  it("only warns when a verified address stops working: it fails, and it stays verified", async () => {
    const first = new Date("2026-11-12T10:00:00.000Z");
    await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "ok", startedAt: first, now: () => first });
    const later = new Date("2026-11-13T10:00:00.000Z");
    const recorded = await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "tls_failed", startedAt: later, now: () => later });
    expect(recorded).toEqual({ kind: "recorded", firstVerified: false, wentFailing: true });
    expect(await state()).toMatchObject({
      custom_domain_status: "failing",
      custom_domain_check_result: "tls_failed",
      custom_domain_verified_at: first,
      custom_domain_checked_at: later,
    });
  });

  it("does not report a fall for an address that never worked", async () => {
    const at = new Date("2026-11-12T10:00:00.000Z");
    const recorded = await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "dns_failed", startedAt: at, now: () => at });
    expect(recorded).toEqual({ kind: "recorded", firstVerified: false, wentFailing: false });
    expect(await state()).toMatchObject({ custom_domain_status: "failing", custom_domain_check_result: "dns_failed", custom_domain_verified_at: null });
  });

  it.each(["dns_failed", "tls_failed", "wrong_target", "unreachable"] as const)("%s makes the status failing and verifies nothing", async (result) => {
    const at = new Date("2026-11-12T10:00:00.000Z");
    await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result, startedAt: at, now: () => at });
    expect(await state()).toMatchObject({ custom_domain_status: "failing", custom_domain_check_result: result, custom_domain_verified_at: null });
  });

  it("leaves the status unchecked for an address the server cannot judge, and says what it found", async () => {
    const at = new Date("2026-11-12T10:00:00.000Z");
    await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "not_verifiable_from_server", startedAt: at, now: () => at });
    expect(await state()).toMatchObject({
      custom_domain_status: "unchecked",
      custom_domain_check_result: "not_verifiable_from_server",
      custom_domain_verified_at: null,
      custom_domain_checked_at: at,
    });
  });

  it("does not take back a verification that a private-address result follows", async () => {
    const first = new Date("2026-11-12T10:00:00.000Z");
    await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "ok", startedAt: first, now: () => first });
    const later = new Date("2026-11-13T10:00:00.000Z");
    await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "not_verifiable_from_server", startedAt: later, now: () => later });
    expect(await state()).toMatchObject({ custom_domain_verified_at: first });
  });
});

describe("recordDomainCheck: a result that no longer belongs", () => {
  it("writes nothing for an address that was changed while the check ran", async () => {
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { custom_domain: "other.acme.example" } });
    const at = new Date("2026-11-12T10:00:00.000Z");
    expect(await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "ok", startedAt: at, now: () => at })).toEqual({ kind: "stale" });
    expect(await state()).toMatchObject({
      custom_domain: "other.acme.example",
      custom_domain_status: "unchecked",
      custom_domain_check_result: null,
      custom_domain_verified_at: null,
      custom_domain_checked_at: null,
    });
  });

  it("writes nothing for an address that was removed while the check ran", async () => {
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { custom_domain: null } });
    const at = new Date("2026-11-12T10:00:00.000Z");
    expect(await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "ok", startedAt: at, now: () => at })).toEqual({ kind: "stale" });
    expect(await state()).toMatchObject({ custom_domain: null, custom_domain_verified_at: null });
  });

  it("writes nothing for an event that has no settings", async () => {
    const at = new Date();
    expect(await recordDomainCheck(prisma, { eventId: "evt-nowhere", domain: DOMAIN, result: "ok", startedAt: at })).toEqual({ kind: "stale" });
  });

  it("does not overwrite the result of a check that finished after this one began", async () => {
    const newer = new Date("2026-11-12T10:00:05.000Z");
    await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "dns_failed", startedAt: newer, now: () => newer });
    const olderStart = new Date("2026-11-12T10:00:01.000Z");
    const recorded = await recordDomainCheck(prisma, { eventId: EVENT_ID, domain: DOMAIN, result: "ok", startedAt: olderStart, now: () => new Date("2026-11-12T10:00:09.000Z") });
    expect(recorded).toEqual({ kind: "superseded" });
    expect(await state()).toMatchObject({ custom_domain_status: "failing", custom_domain_check_result: "dns_failed", custom_domain_verified_at: null, custom_domain_checked_at: newer });
  });
});

describe("two checks of one address at once", () => {
  it("leave one consistent state: ten oks at once verify once", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        recordDomainCheck(prisma, {
          eventId: EVENT_ID,
          domain: DOMAIN,
          result: "ok",
          startedAt: new Date("2026-11-12T10:00:00.000Z"),
          now: () => new Date(`2026-11-12T10:00:0${index}.000Z`),
        }),
      ),
    );
    expect(results.filter((r) => r.kind === "recorded" && r.firstVerified)).toHaveLength(1);
    const after = await state();
    expect(after).toMatchObject({ custom_domain_status: "ok", custom_domain_check_result: "ok" });
    // The time of the verification is the time of the one write that verified, and not a later one.
    const verifier = results.findIndex((r) => r.kind === "recorded" && r.firstVerified);
    expect(after?.custom_domain_verified_at?.toISOString()).toBe(`2026-11-12T10:00:0${verifier}.000Z`);
  });

  it("let the check that began later win when it finishes first, and drop the slow one that began earlier", async () => {
    // A begins first and is slow, and finds a wrong target; B begins later, is quick, and finds the proof.
    const slowWrong = checkEventDomain(prisma, EVENT_ID, { resolve, fetchPinned: wrongAfter(150) });
    await new Promise((r) => setTimeout(r, 30));
    const quickOk = checkEventDomain(prisma, EVENT_ID, { resolve, fetchPinned: proofAfter(0) });
    const [a, b] = await Promise.all([slowWrong, quickOk]);
    expect(b.recorded).toMatchObject({ kind: "recorded", firstVerified: true });
    // A began before B wrote, and B's row is newer than A's start, so A does not overwrite it.
    expect(a.recorded).toEqual({ kind: "superseded" });
    expect(await state()).toMatchObject({ custom_domain_status: "ok", custom_domain_check_result: "ok" });
    expect((await state())?.custom_domain_verified_at).not.toBeNull();
  });

  it("let the later write win when the earlier one wrote first and the slow one began after it wrote", async () => {
    await checkEventDomain(prisma, EVENT_ID, { resolve, fetchPinned: proofAfter(0) });
    const first = (await state())?.custom_domain_checked_at;
    await new Promise((r) => setTimeout(r, 10));
    const second = await checkEventDomain(prisma, EVENT_ID, { resolve, fetchPinned: wrongAfter(0) });
    expect(second.recorded).toMatchObject({ kind: "recorded", wentFailing: true });
    expect(await state()).toMatchObject({ custom_domain_status: "failing", custom_domain_check_result: "wrong_target" });
    expect((await state())?.custom_domain_checked_at?.getTime()).toBeGreaterThan(first?.getTime() ?? 0);
  });

  it("do not write for an address that is changed between the two", async () => {
    const running = checkEventDomain(prisma, EVENT_ID, { resolve, fetchPinned: proofAfter(100) });
    await new Promise((r) => setTimeout(r, 20));
    await prisma.eventRegistrationSettings.update({
      where: { event_id: EVENT_ID },
      data: { custom_domain: "other.acme.example", custom_domain_status: "unchecked", custom_domain_check_result: null, custom_domain_verified_at: null, custom_domain_checked_at: null },
    });
    const done = await running;
    expect(done.recorded).toEqual({ kind: "stale" });
    expect(await state()).toMatchObject({ custom_domain: "other.acme.example", custom_domain_status: "unchecked", custom_domain_verified_at: null });
  });
});

describe("checkEventDomain", () => {
  it("asks the address of the event and gives the state after it", async () => {
    const { state: after, recorded } = await checkEventDomain(prisma, EVENT_ID, { resolve, fetchPinned: proofAfter() });
    expect(recorded).toMatchObject({ kind: "recorded", firstVerified: true });
    expect(after).toMatchObject({ custom_domain: DOMAIN, custom_domain_status: "ok", custom_domain_check_result: "ok" });
    expect(after?.custom_domain_verified_at).toBeInstanceOf(Date);
  });

  it("does not take the proof of another event for this one", async () => {
    const { state: after } = await checkEventDomain(prisma, EVENT_ID, { resolve, fetchPinned: proofAfter(0, "evt-other") });
    expect(after).toMatchObject({ custom_domain_status: "failing", custom_domain_check_result: "wrong_target", custom_domain_verified_at: null });
  });

  it("makes no request for an event with no address", async () => {
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { custom_domain: null } });
    const fetchPinned = vi.fn();
    const done = await checkEventDomain(prisma, EVENT_ID, { resolve, fetchPinned: fetchPinned as never });
    expect(done.recorded).toBeNull();
    expect(done.state).toMatchObject({ custom_domain: null });
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it("makes no request for an event with no settings", async () => {
    await createEvent("evt-bare", null);
    const fetchPinned = vi.fn();
    expect(await checkEventDomain(prisma, "evt-bare", { resolve, fetchPinned: fetchPinned as never })).toEqual({ state: null, recorded: null });
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it("reports an address that is the instance's own as a wrong target", async () => {
    const fetchPinned = vi.fn();
    const { state: after } = await checkEventDomain(prisma, EVENT_ID, { resolve, fetchPinned: fetchPinned as never, instanceHostname: DOMAIN });
    expect(after).toMatchObject({ custom_domain_check_result: "wrong_target" });
    expect(fetchPinned).not.toHaveBeenCalled();
  });
});

describe("refreshEventDomains: the daily refresh", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const refresh = (deps: Partial<Parameters<typeof refreshEventDomains>[1]> = {}) =>
    refreshEventDomains(prisma, { resolve, fetchPinned: proofAfter(), now: () => now, ...deps });

  it("checks an address never checked and one last checked over a day ago, and no others", async () => {
    const checkedOf = async (id: string) => (await prisma.eventRegistrationSettings.findUniqueOrThrow({ where: { event_id: id } })).custom_domain_checked_at;
    const result = await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { custom_domain: "never.acme.example" } });
    expect(result.custom_domain_checked_at).toBeNull();
    await createEvent("evt-old", { custom_domain: "old.acme.example", custom_domain_checked_at: ago(DOMAIN_CHECK_REFRESH_MS + HOUR) });
    await createEvent("evt-fresh", { custom_domain: "fresh.acme.example", custom_domain_checked_at: ago(HOUR) });
    await createEvent("evt-archived", { custom_domain: "archived.acme.example" }, true);
    await createEvent("evt-none", {});
    await createEvent("evt-bare", null);

    const fetchPinned = vi.fn(proofAfter() as never);
    // The stub signs for one event and one address, so what each address finds does not matter here: only which ones are asked.
    const done = await refresh({ fetchPinned: fetchPinned as never });
    expect(done).toMatchObject({ checked: 2, errors: 0, more: false });
    expect(fetchPinned).toHaveBeenCalledTimes(2);
    expect(await checkedOf(EVENT_ID)).toEqual(now);
    expect(await checkedOf("evt-old")).toEqual(now);
    expect(await checkedOf("evt-fresh")).toEqual(ago(HOUR));
    expect(await checkedOf("evt-archived")).toBeNull();
    expect(await checkedOf("evt-none")).toBeNull();
  });

  it("counts a first verification and a fall to failing", async () => {
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { custom_domain: DOMAIN } });
    await createEvent("evt-was-ok", {
      custom_domain: "was-ok.acme.example",
      custom_domain_status: "ok",
      custom_domain_check_result: "ok",
      custom_domain_verified_at: ago(5 * DOMAIN_CHECK_REFRESH_MS),
      custom_domain_checked_at: ago(DOMAIN_CHECK_REFRESH_MS + HOUR),
    });
    const done = await refresh();
    // The stub signs for EVENT_ID and DOMAIN: that event is verified for the first time, and the other one, which worked, fails.
    expect(done).toMatchObject({ checked: 2, verified: 1, failing: 1, errors: 0 });
    expect(await prisma.eventRegistrationSettings.findUniqueOrThrow({ where: { event_id: "evt-was-ok" } })).toMatchObject({
      custom_domain_status: "failing",
      custom_domain_check_result: "wrong_target",
    });
  });

  it("does not ask for an immediate next run when a batch recorded nothing", async () => {
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { custom_domain: null } });
    const total = DOMAIN_CHECK_SWEEP_BATCH + 1;
    for (let index = 0; index < total; index += 1) {
      await createEvent(`evt-stuck-${index}`, { custom_domain: `stuck-${index}.acme.example` });
    }
    const failing = vi.spyOn(prisma, "$transaction").mockRejectedValue(new Error("write failed"));
    try {
      expect(await refresh()).toMatchObject({ checked: 0, errors: DOMAIN_CHECK_SWEEP_BATCH, more: false });
    } finally {
      failing.mockRestore();
    }
  });

  it("looks at the oldest first, a few at a time, and says when more are due", async () => {
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { custom_domain: null } });
    const total = DOMAIN_CHECK_SWEEP_BATCH + 2;
    for (let index = 0; index < total; index += 1) {
      await createEvent(`evt-due-${index}`, { custom_domain: `due-${index}.acme.example`, custom_domain_checked_at: ago(DOMAIN_CHECK_REFRESH_MS + (total - index) * HOUR) });
    }
    const first = await refresh();
    expect(first).toMatchObject({ checked: DOMAIN_CHECK_SWEEP_BATCH, more: true });
    const checkedAfter = (await prisma.eventRegistrationSettings.findMany({ where: { custom_domain_checked_at: now }, select: { event_id: true } })).map((row) => row.event_id).sort((a, b) => a.localeCompare(b, "en"));
    // The oldest ones went first: the two newest of the due are left.
    expect(checkedAfter).toEqual(Array.from({ length: DOMAIN_CHECK_SWEEP_BATCH }, (_, index) => `evt-due-${index}`));
    const second = await refresh();
    expect(second).toMatchObject({ checked: 2, more: false });
    expect((await refresh()).checked).toBe(0);
  });

  it("counts a check that could not be written and goes on with the next", async () => {
    await createEvent("evt-second", { custom_domain: "second.acme.example" });
    let calls = 0;
    const clock = () => {
      calls += 1;
      // The first read is the refresh's own; the first address then fails at its clock, the second one does not.
      if (calls === 2) throw new Error("clock failed");
      return now;
    };
    const done = await refresh({ now: clock });
    expect(done).toMatchObject({ checked: 1, errors: 1 });
  });

  it("makes no request when nothing is due", async () => {
    await prisma.eventRegistrationSettings.update({ where: { event_id: EVENT_ID }, data: { custom_domain_checked_at: ago(HOUR) } });
    const fetchPinned = vi.fn();
    expect(await refresh({ fetchPinned: fetchPinned as never })).toEqual({ checked: 0, verified: 0, failing: 0, errors: 0, more: false });
    expect(fetchPinned).not.toHaveBeenCalled();
  });
});
