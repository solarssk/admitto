import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import type { WalletPassInput, WalletPassProvider } from "@admitto/wallet";
import { PASSCREATOR_CAPABILITIES, PASSCREATOR_CONSISTENCY_POLICY } from "@admitto/wallet";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import { walletSnapshot } from "../helpers/wallet-snapshot.js";

const ORG_ID = "org-wallet-webhook";
const EVENT_ID = "evt-wallet-webhook";
const OTHER_EVENT_ID = "evt-wallet-webhook-other";
const UNCONFIGURED_EVENT_ID = "evt-wallet-webhook-unconfigured";
const CACHE_TEST_EVENT_ID = "evt-wallet-webhook-cache";
// Own event id for the public-key-fetch-failure test below, never reused elsewhere in this
// file - publicKeyCache is module-scoped and never cleared between tests, so reusing an id
// another test has already delivered to would silently skip the fetch this test needs to fail.
const KEY_FETCH_FAILURE_EVENT_ID = "evt-wallet-webhook-key-failure";
const ATTENDEE_ID = "attendee-wallet-webhook";
const USER_PROVIDED_ID = `admitto:${EVENT_ID}:${ATTENDEE_ID}`;

let prisma: PrismaClient;
let keyPair: { publicKey: string; privateKey: string };

function signP256(data: string, privateKeyPem: string): string {
  const signer = createSign("SHA1");
  signer.update(data, "utf8");
  signer.end();
  return signer.sign(privateKeyPem, "hex");
}

function stubProvider(publicKey: string): WalletPassProvider & {
  getWebhookPublicKey: ReturnType<typeof vi.fn>;
} {
  return {
    provider: "stub",
    capabilities: PASSCREATOR_CAPABILITIES,
    consistencyPolicy: PASSCREATOR_CONSISTENCY_POLICY,
    createPass: vi.fn(async (input: WalletPassInput) => ({
      providerPassId: `pc-${input.userProvidedId}`,
      appleUrl: "https://pc.test/apple/x",
      androidUrl: "https://pc.test/android/x",
    })),
    updatePass: vi.fn(),
    sendPushMessage: vi.fn(),
    voidPass: vi.fn(),
    restorePass: vi.fn(),
    deletePass: vi.fn(),
    findByUserProvidedId: vi.fn(async () => null),
    getPassSnapshot: vi.fn(async () => null),
    getWebhookPublicKey: vi.fn(async () => publicKey),
  };
}

async function seedFixture(client: PrismaClient): Promise<void> {
  const eventIds = [EVENT_ID, OTHER_EVENT_ID, UNCONFIGURED_EVENT_ID, CACHE_TEST_EVENT_ID, KEY_FETCH_FAILURE_EVENT_ID];
  await client.walletPass.deleteMany({ where: { attendee_id: ATTENDEE_ID } });
  await client.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.event.deleteMany({ where: { id: { in: eventIds } } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  await client.organization.create({ data: { id: ORG_ID, name: "Org", slug: "wallet-webhook-org" } });
  await client.event.create({
    data: {
      id: EVENT_ID,
      title: "Webhook Gala",
      slug: "webhook-gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      wallet_template_id: "tmpl-webhook-gala",
    },
  });
  await client.event.create({
    data: {
      id: OTHER_EVENT_ID,
      title: "Other Gala",
      slug: "other-gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      wallet_template_id: "tmpl-other-gala",
    },
  });
  await client.event.create({
    data: {
      id: UNCONFIGURED_EVENT_ID,
      title: "Unconfigured Gala",
      slug: "unconfigured-gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      wallet_enabled: false,
    },
  });
  await client.event.create({
    data: {
      id: CACHE_TEST_EVENT_ID,
      title: "Cache Test Gala",
      slug: "cache-test-gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      wallet_template_id: "tmpl-cache-test-gala",
    },
  });
  await client.event.create({
    data: {
      id: KEY_FETCH_FAILURE_EVENT_ID,
      title: "Key Failure Gala",
      slug: "key-failure-gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      wallet_template_id: "tmpl-key-failure-gala",
    },
  });
  await client.attendee.create({
    data: {
      id: ATTENDEE_ID,
      event_id: EVENT_ID,
      email: "webhook@example.com",
      name: "Webhook Guest",
      status: "registered",
    },
  });
  await client.walletPass.create({
    data: {
      attendee_id: ATTENDEE_ID,
      provider: "passcreator",
      provider_pass_id: "pc-webhook-1",
      user_provided_id: USER_PROVIDED_ID,
      status: "active",
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  keyPair = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  await seedFixture(prisma);
});

beforeEach(() => {
  resetSystemLogBufferForTest();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.walletPass.update({
    where: { attendee_id: ATTENDEE_ID },
    data: {
      status: "active",
      voided_at: null,
      provider_commanded_at: null,
      provider_removed_at: null,
      apple_active_registrations: null,
      apple_inactive_registrations: null,
      first_downloaded_at: null,
      registration_checked_at: null,
      first_confirmed_at: null,
    },
  });
});

afterAll(async () => {
  const eventIds = [EVENT_ID, OTHER_EVENT_ID, UNCONFIGURED_EVENT_ID, CACHE_TEST_EVENT_ID, KEY_FETCH_FAILURE_EVENT_ID];
  await prisma.walletPass.deleteMany({ where: { attendee_id: ATTENDEE_ID } });
  await prisma.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma?.$disconnect();
});

function makeApp(walletPassProvider?: WalletPassProvider) {
  return createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    walletPassProvider,
  });
}

function signedRequest(payload: object, privateKeyPem = keyPair.privateKey) {
  const signedData = JSON.stringify(payload);
  return { signedData, signature: signP256(signedData, privateKeyPem) };
}

describe("POST /api/wallet/webhook/passcreator/:eventId", () => {
  it("applies a validly signed registration update and returns 200", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const body = signedRequest({
      identifier: "pc-webhook-1",
      userProvidedId: USER_PROVIDED_ID,
      operatingSystem: "iOS",
      noOfActivePasses: 1,
      firstDownloadedAt: "2026-08-01 10:00:00",
    });

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.apple_active_registrations).toBe(1);
    expect(row?.first_downloaded_at).toBe("2026-08-01 10:00:00");
    expect(row?.registration_checked_at).not.toBeNull();
    expect(querySystemLogs({ search: "wallet_webhook_applied" })).toHaveLength(1);
  });

  it("logs wallet_webhook_unmatched (not applied) for a validly signed delivery whose pass no longer exists", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const body = signedRequest({ identifier: "pc-does-not-exist" });

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    expect(querySystemLogs({ search: "wallet_webhook_unmatched" })).toHaveLength(1);
    expect(querySystemLogs({ search: "wallet_webhook_applied" })).toHaveLength(0);
  });

  it("never reads a voided flag out of a registration delivery: status stays active", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const body = signedRequest({ identifier: "pc-webhook-1", userProvidedId: USER_PROVIDED_ID, voided: true });

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
    expect(row?.voided_at).toBeNull();
  });

  it("caches the public key across deliveries for the same event", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    // Own event id, untouched by any other test in this file - the first delivery here is
    // guaranteed to be a cold cache, so the second call proves reuse rather than coincidence.
    const body = signedRequest({ identifier: "pc-cache-test", voided: false });

    await app.request(`/api/wallet/webhook/passcreator/${CACHE_TEST_EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await app.request(`/api/wallet/webhook/passcreator/${CACHE_TEST_EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(provider.getWebhookPublicKey).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid signature with 401 and does not touch the row", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const tampered = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const body = signedRequest(
      { identifier: "pc-webhook-1", userProvidedId: USER_PROVIDED_ID, voided: true },
      tampered.privateKey,
    );

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(401);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
  });

  it("acks with 200 but does not apply an update whose userProvidedId names a different event", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const body = signedRequest({
      identifier: "pc-webhook-1",
      userProvidedId: `admitto:${OTHER_EVENT_ID}:${ATTENDEE_ID}`,
      voided: true,
    });

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
  });

  it("returns 404 for an unknown event id", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const body = signedRequest({ identifier: "pc-webhook-1", voided: true });

    const res = await app.request(`/api/wallet/webhook/passcreator/nonexistent-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 when the event has no wallet provider configured", async () => {
    const app = makeApp(undefined);
    const body = signedRequest({ identifier: "pc-webhook-1", voided: true });

    const res = await app.request(`/api/wallet/webhook/passcreator/${UNCONFIGURED_EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-JSON body", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when the envelope is missing signedData or signature", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedData: "{}" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when validly signed signedData parses to something other than a JSON object", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    // Envelope-level parsing (parseWebhookEnvelope) only requires signedData/signature to be
    // strings - it doesn't look inside signedData. Signature verification passes here (it's a
    // real signature over this exact string), so this exercises parseWebhookData's own
    // `typeof raw !== "object"` rejection, distinct from the malformed-envelope case above.
    const signedData = JSON.stringify("not an object");
    const body = { signedData, signature: signP256(signedData, keyPair.privateKey) };

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(400);
  });

  it("returns 502 when the public key fetch fails", async () => {
    const provider = stubProvider(keyPair.publicKey);
    provider.getWebhookPublicKey.mockRejectedValueOnce(new Error("upstream down"));
    const app = makeApp(provider);
    const body = signedRequest({ identifier: "pc-webhook-1", voided: true });

    // Own event id (KEY_FETCH_FAILURE_EVENT_ID), not reused anywhere else in this file -
    // publicKeyCache is module-scoped and never cleared between tests, so a shared id would let
    // an earlier delivery's cached key silently skip the fetch this test depends on failing.
    const res = await app.request(`/api/wallet/webhook/passcreator/${KEY_FETCH_FAILURE_EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(502);
  });
});

describe("POST /api/wallet/webhook/passcreator/:eventId/voided", () => {
  // The real pass_voided payload has no `voided` field (developer.passcreator.com/en/webhooks/pass-hooks,
  // 2026-08-19): arriving on this route is only a signal that the pass MAY have changed, so every
  // case below decides from what the provider says on a fresh read.
  const voidedDelivery = () => signedRequest({ identifier: "pc-webhook-1", userProvidedId: USER_PROVIDED_ID });

  function postVoided(app: ReturnType<typeof makeApp>, body: object, eventId = EVENT_ID) {
    return app.request(`/api/wallet/webhook/passcreator/${eventId}/voided`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("records the void when the provider, asked again, reports the pass voided", async () => {
    const provider = stubProvider(keyPair.publicKey);
    vi.mocked(provider.getPassSnapshot).mockResolvedValue(
      walletSnapshot({ appleActive: 1 }, { validity: { voided: true, expirationRaw: null, expiresAt: null } }),
    );
    const app = makeApp(provider);

    const res = await postVoided(app, voidedDelivery());

    expect(res.status).toBe(200);
    expect(provider.getPassSnapshot).toHaveBeenCalledWith({
      providerPassId: "pc-webhook-1",
      userProvidedId: USER_PROVIDED_ID,
    });
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("voided");
    expect(row?.voided_at).not.toBeNull();
    // The counts of that same read are kept: nothing polls a voided pass afterwards.
    expect(row?.apple_active_registrations).toBe(1);
    expect(querySystemLogs({ search: "wallet_webhook_applied" })).toHaveLength(1);
    expect(querySystemLogs({ search: "wallet_pass_lifecycle_observed" })).toHaveLength(1);
  });

  it("changes nothing for a late redelivery: the provider now says the pass is not voided (it was restored since)", async () => {
    const provider = stubProvider(keyPair.publicKey);
    vi.mocked(provider.getPassSnapshot).mockResolvedValue(walletSnapshot());
    const app = makeApp(provider);

    const res = await postVoided(app, voidedDelivery());

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
    expect(row?.voided_at).toBeNull();
  });

  it("does not let a stale 'voided' read undo Admitto's own Restore made a minute ago", async () => {
    await prisma.walletPass.update({
      where: { attendee_id: ATTENDEE_ID },
      data: { provider_commanded_at: new Date(Date.now() - 60_000) },
    });
    const provider = stubProvider(keyPair.publicKey);
    vi.mocked(provider.getPassSnapshot).mockResolvedValue(
      walletSnapshot({}, { observedAt: new Date(), validity: { voided: true, expirationRaw: null, expiresAt: null } }),
    );
    const app = makeApp(provider);

    const res = await postVoided(app, voidedDelivery());

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
  });

  it("answers 503, so PassCreator redelivers, when the provider cannot be reached", async () => {
    const provider = stubProvider(keyPair.publicKey);
    vi.mocked(provider.getPassSnapshot).mockRejectedValue(new Error("provider down"));
    const app = makeApp(provider);

    const res = await postVoided(app, voidedDelivery());

    expect(res.status).toBe(503);
    expect(await res.text()).toBe("");
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
    expect(querySystemLogs({ search: "wallet_webhook_reconcile_failed" })).toHaveLength(1);
  });

  it("answers 503 when the provider has no match for the pass even after the retry - a no-match is not proof of anything", async () => {
    const provider = stubProvider(keyPair.publicKey);
    vi.mocked(provider.getPassSnapshot).mockResolvedValue(null);
    const app = makeApp(provider);

    const res = await postVoided(app, voidedDelivery());

    expect(res.status).toBe(503);
    expect(provider.getPassSnapshot).toHaveBeenCalledTimes(2);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
  });

  it("acks 200 without asking the provider when the pass is already voided in Admitto", async () => {
    await prisma.walletPass.update({
      where: { attendee_id: ATTENDEE_ID },
      data: { status: "voided", voided_at: new Date("2026-09-20T10:00:00.000Z") },
    });
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);

    const res = await postVoided(app, voidedDelivery());

    expect(res.status).toBe(200);
    expect(provider.getPassSnapshot).not.toHaveBeenCalled();
  });

  it("acks 200 without asking the provider when the delivery names no pass of this event", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);

    const unknown = await postVoided(app, signedRequest({ identifier: "pc-does-not-exist" }));
    // The same pass id delivered to a different event's URL is not this event's pass either.
    const otherEvent = await postVoided(app, signedRequest({ identifier: "pc-webhook-1" }), OTHER_EVENT_ID);

    expect(unknown.status).toBe(200);
    expect(otherEvent.status).toBe(200);
    expect(provider.getPassSnapshot).not.toHaveBeenCalled();
    expect(querySystemLogs({ search: "wallet_webhook_unmatched" })).toHaveLength(2);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
  });

  it("still 401s a delivery with a bad signature - the /voided route isn't a verification shortcut", async () => {
    const otherPair = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const body = signedRequest({ identifier: "pc-webhook-1", userProvidedId: USER_PROVIDED_ID }, otherPair.privateKey);

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}/voided`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(401);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
  });
});

describe("POST /api/wallet/webhook/passcreator/:eventId/first-confirmed", () => {
  it("stamps first_confirmed_at and still applies the delivery's own registration counts", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const body = signedRequest({
      identifier: "pc-webhook-1",
      userProvidedId: USER_PROVIDED_ID,
      operatingSystem: "iOS",
      noOfActivePasses: 1,
    });

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}/first-confirmed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.first_confirmed_at).not.toBeNull();
    expect(row?.apple_active_registrations).toBe(1);
    expect(querySystemLogs({ search: "wallet_webhook_applied" })).toHaveLength(1);
  });

  it("never overwrites an already-set first_confirmed_at with a later delivery's timestamp", async () => {
    const originalConfirmedAt = new Date("2026-01-01T00:00:00.000Z");
    await prisma.walletPass.update({
      where: { attendee_id: ATTENDEE_ID },
      data: { first_confirmed_at: originalConfirmedAt },
    });
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const body = signedRequest({ identifier: "pc-webhook-1", userProvidedId: USER_PROVIDED_ID, operatingSystem: "iOS", noOfActivePasses: 1 });

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}/first-confirmed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.first_confirmed_at).toEqual(originalConfirmedAt);
  });

  it("still 401s a delivery with a bad signature - the /first-confirmed route isn't a verification shortcut", async () => {
    const otherPair = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const body = signedRequest({ identifier: "pc-webhook-1", userProvidedId: USER_PROVIDED_ID }, otherPair.privateKey);

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}/first-confirmed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(401);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.first_confirmed_at).toBeNull();
  });
});
