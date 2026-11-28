/**
 * The clean-up of the state of guest sign-ins that were never finished (D-C4): what it deletes, and that it reads the
 * clock the way the rows were written, in any time zone of the database session.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrismaClient } from "@admitto/db/testing";
import { SSO_STATE_SWEEP_BATCH_SIZE, sweepRegistrationSsoStates } from "../src/index.js";
import { resetDb } from "./resetDb.js";
import { seedOrgAndEvent } from "./seedOrgAndEvent.js";

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-sso-sweep";
const ORG_ID = "org-sso-sweep";
const PROVIDER_ID = "idp-sso-sweep";

beforeAll(async () => {
  await resetDb();
  await seedOrgAndEvent(prisma, {
    orgId: ORG_ID,
    orgName: "SSO Sweep Org",
    orgSlug: "sso-sweep-org",
    eventId: EVENT_ID,
    eventTitle: "SSO Sweep",
    eventSlug: "sso-sweep",
  });
  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      issuer: "https://idp.example.com/",
      client_id: "sso-sweep-client",
      authorization_endpoint: "https://idp.example.com/authorize",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/jwks",
      display_name: "Sweep IdP",
      enabled: true,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.registrationSsoState.deleteMany();
});

const MINUTE = 60_000;
let counter = 0;
const row = (expiresInMs: number, consumed = false) => {
  counter += 1;
  return {
    state: `state-${counter}`,
    nonce: `nonce-${counter}`,
    code_verifier: `verifier-${counter}`,
    event_id: EVENT_ID,
    provider_id: PROVIDER_ID,
    expires_at: new Date(Date.now() + expiresInMs),
    ...(consumed ? { consumed_at: new Date() } : {}),
  };
};
const states = async () => (await prisma.registrationSsoState.findMany({ select: { state: true } })).map((r) => r.state);

describe("sweepRegistrationSsoStates", () => {
  it("deletes the states that ran out, spent or not, and keeps the ones still within their ten minutes", async () => {
    await prisma.registrationSsoState.createMany({
      data: [row(-MINUTE), row(-MINUTE, true), row(MINUTE), row(MINUTE, true)],
    });
    const keep = (await prisma.registrationSsoState.findMany({ where: { expires_at: { gt: new Date() } } })).map((r) => r.state).sort((a, b) => String(a).localeCompare(String(b), "en"));

    expect(await sweepRegistrationSsoStates(prisma)).toEqual({ deleted: 2, more: false });

    expect((await states()).sort((a, b) => String(a).localeCompare(String(b), "en"))).toEqual(keep);
  });

  it("does nothing, and says so, when nothing ran out", async () => {
    await prisma.registrationSsoState.create({ data: row(MINUTE) });

    expect(await sweepRegistrationSsoStates(prisma)).toEqual({ deleted: 0, more: false });
    expect(await states()).toHaveLength(1);
  });

  it("judges the expiry by the clock it is given", async () => {
    await prisma.registrationSsoState.create({ data: row(5 * MINUTE) });

    expect((await sweepRegistrationSsoStates(prisma, new Date(Date.now() + 4 * MINUTE))).deleted).toBe(0);
    expect((await sweepRegistrationSsoStates(prisma, new Date(Date.now() + 6 * MINUTE))).deleted).toBe(1);
  });

  it("goes on past one batch, and stops at its limit with a note that more may be left", async () => {
    const make = (count: number) => Array.from({ length: count }, () => row(-MINUTE));
    await prisma.registrationSsoState.createMany({ data: make(SSO_STATE_SWEEP_BATCH_SIZE + 5) });
    expect(await sweepRegistrationSsoStates(prisma)).toEqual({ deleted: SSO_STATE_SWEEP_BATCH_SIZE + 5, more: false });

    await prisma.registrationSsoState.createMany({ data: make(SSO_STATE_SWEEP_BATCH_SIZE * 10 + 3) });
    expect(await sweepRegistrationSsoStates(prisma)).toEqual({ deleted: SSO_STATE_SWEEP_BATCH_SIZE * 10, more: true });
    expect(await sweepRegistrationSsoStates(prisma)).toEqual({ deleted: 3, more: false });
  });

  // The columns hold naive UTC and the clock of the sweep is a JavaScript date, as the rows were written: a bare NOW() would
  // be read in the session's zone and move the comparison by its offset, either way.
  it.each(["Pacific/Kiritimati", "Asia/Kolkata", "UTC", "America/Los_Angeles", "Pacific/Pago_Pago"])(
    "deletes what ran out a minute ago and keeps what runs out in a minute (session zone %s)",
    async (zone) => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      url.searchParams.set("options", `-c TimeZone=${zone}`);
      const zoned = createTestPrismaClient(url.toString());
      try {
        const gone = row(-MINUTE);
        const kept = row(MINUTE);
        await zoned.registrationSsoState.createMany({ data: [gone, kept] });

        expect((await sweepRegistrationSsoStates(zoned)).deleted).toBe(1);

        expect(await states()).toEqual([kept.state]);
      } finally {
        await zoned.$disconnect();
      }
    },
  );
});
