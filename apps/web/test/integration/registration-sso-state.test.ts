/**
 * The state of a guest sign-in (`RegistrationSsoState`, D-C4) against a real database: written once, spent once, and spent by
 * exactly one of any number of callbacks that arrive together.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { GUEST_SSO_STATE_TTL_MS } from "../../src/registration/sso-session.js";
import { createGuestSsoState, spendGuestSsoState } from "../../src/registration/sso-state.js";
import { eventSeeder } from "../helpers/registration-submit-harness.js";
import { installProvider, removeProvider, PROVIDER_ID } from "../helpers/registration-sso-harness.js";
import { startMockOidcIdp, stopMockOidcIdp, type MockOidcIdp } from "../helpers/mock-oidc-idp.js";

const ORG = "org-reg118a-state";
let prisma: PrismaClient;
let idp: MockOidcIdp;
let seeder: ReturnType<typeof eventSeeder>;
let eventId = "";
let counter = 0;

const input = (overrides: Partial<Parameters<typeof createGuestSsoState>[1]> = {}) => ({
  state: `state-${(counter += 1)}-${Math.random().toString(36).slice(2)}`,
  nonce: "a-nonce",
  codeVerifier: "a-verifier",
  eventId,
  providerId: PROVIDER_ID,
  ...overrides,
});

beforeAll(async () => {
  prisma = createTestPrismaClient();
  idp = await startMockOidcIdp();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
  await installProvider(prisma, idp);
  eventId = await seeder.addEvent("reg118a-state-event", { settings: { access_methods: ["sso"] } });
});

beforeEach(async () => {
  await prisma.registrationSsoState.deleteMany();
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.registrationSsoState.deleteMany();
  await removeProvider(prisma);
  await seeder.wipe();
  await prisma.$disconnect();
  await stopMockOidcIdp(idp);
});

describe("createGuestSsoState", () => {
  it("writes the state, the nonce, the verifier, the event and the provider, for ten minutes from now, and nothing of a guest", async () => {
    const now = new Date();
    const given = input();

    await createGuestSsoState(prisma, given, now);

    const row = await prisma.registrationSsoState.findUniqueOrThrow({ where: { state: given.state } });
    expect(row).toMatchObject({ nonce: "a-nonce", code_verifier: "a-verifier", event_id: eventId, provider_id: PROVIDER_ID, consumed_at: null });
    expect(row.expires_at.getTime()).toBe(now.getTime() + GUEST_SSO_STATE_TTL_MS);
    expect(Object.keys(row).sort((a, b) => String(a).localeCompare(String(b), "en"))).toEqual(["code_verifier", "consumed_at", "created_at", "event_id", "expires_at", "id", "nonce", "provider_id", "state"]);
  });

  it("refuses a second row with the same state", async () => {
    const given = input();
    await createGuestSsoState(prisma, given, new Date());

    await expect(createGuestSsoState(prisma, given, new Date())).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("spendGuestSsoState", () => {
  it("gives back what the callback needs, once, and marks the row spent", async () => {
    const given = input();
    const now = new Date();
    await createGuestSsoState(prisma, given, now);

    expect(await spendGuestSsoState(prisma, given.state, now)).toEqual({
      eventId,
      eventSlug: "reg118a-state-event",
      providerId: PROVIDER_ID,
      nonce: "a-nonce",
      codeVerifier: "a-verifier",
    });
    expect((await prisma.registrationSsoState.findUniqueOrThrow({ where: { state: given.state } })).consumed_at).toEqual(now);
    expect(await spendGuestSsoState(prisma, given.state, now)).toBeNull();
  });

  it("gives nothing for a state that is unknown, empty, or the text of a query", async () => {
    for (const state of ["unknown", "", "' OR 1=1 --", "%", "*"]) {
      expect(await spendGuestSsoState(prisma, state, new Date()), state).toBeNull();
    }
  });

  it("gives nothing once the ten minutes have passed, to the millisecond, and spends nothing", async () => {
    const given = input();
    const now = new Date();
    await createGuestSsoState(prisma, given, now);
    const expiry = new Date(now.getTime() + GUEST_SSO_STATE_TTL_MS);

    expect(await spendGuestSsoState(prisma, given.state, expiry)).toBeNull();
    expect(await spendGuestSsoState(prisma, given.state, new Date(expiry.getTime() + 1))).toBeNull();
    expect((await prisma.registrationSsoState.findUniqueOrThrow({ where: { state: given.state } })).consumed_at).toBeNull();
    expect(await spendGuestSsoState(prisma, given.state, new Date(expiry.getTime() - 1))).not.toBeNull();
  });

  it("is spent by exactly one of twenty callbacks that arrive together", async () => {
    const given = input();
    await createGuestSsoState(prisma, given, new Date());

    const results = await Promise.all(Array.from({ length: 20 }, () => spendGuestSsoState(prisma, given.state, new Date())));

    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it("goes with its event when the event is deleted, and with its provider when the provider is", async () => {
    const gone = await seeder.addEvent("reg118a-state-gone", { settings: { access_methods: ["sso"] } });
    await createGuestSsoState(prisma, input({ eventId: gone }), new Date());
    await prisma.registration.deleteMany({ where: { event_id: gone } });
    await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: gone } });
    await prisma.event.delete({ where: { id: gone } });
    expect(await prisma.registrationSsoState.count()).toBe(0);

    await createGuestSsoState(prisma, input(), new Date());
    await prisma.identityProvider.delete({ where: { id: PROVIDER_ID } });
    expect(await prisma.registrationSsoState.count()).toBe(0);
    await installProvider(prisma, idp);
  });
});
