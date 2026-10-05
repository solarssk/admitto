import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { encryptToString } from "@admitto/crypto";
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
// Own id for the credential-rotation test, same reason as the cache test above (module-level key cache).
const ROTATION_EVENT_ID = "evt-wallet-webhook-rotation";
// Own event id for the public-key-fetch-failure test below, never reused elsewhere in this
// file - publicKeyCache is module-scoped and never cleared between tests, so reusing an id
// another test has already delivered to would silently skip the fetch this test needs to fail.
const KEY_FETCH_FAILURE_EVENT_ID = "evt-wallet-webhook-key-failure";
// Credentials configured, Wallet master switch OFF - resolved through the real provider path, not
// an injected stub (own id for the same publicKeyCache reason as above).
const SWITCH_OFF_EVENT_ID = "evt-wallet-webhook-switch-off";
const SWITCH_OFF_ATTENDEE_ID = "attendee-wallet-webhook-switch-off";
const SWITCH_OFF_USER_PROVIDED_ID = `admitto:${SWITCH_OFF_EVENT_ID}:${SWITCH_OFF_ATTENDEE_ID}`;
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
  const eventIds = [
    EVENT_ID,
    OTHER_EVENT_ID,
    UNCONFIGURED_EVENT_ID,
    CACHE_TEST_EVENT_ID,
    ROTATION_EVENT_ID,
    KEY_FETCH_FAILURE_EVENT_ID,
    SWITCH_OFF_EVENT_ID,
  ];
  await client.walletPass.deleteMany({ where: { attendee: { event_id: { in: eventIds } } } });
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
      id: ROTATION_EVENT_ID,
      title: "Rotation Gala",
      slug: "rotation-gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      wallet_template_id: "tmpl-rotation-gala",
      wallet_api_key_enc: encryptToString("first-api-key"),
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
  await client.event.create({
    data: {
      id: SWITCH_OFF_EVENT_ID,
      title: "Switch Off Gala",
      slug: "switch-off-gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      wallet_enabled: false,
      wallet_template_id: "tmpl-switch-off-gala",
      wallet_api_key_enc: encryptToString("test-api-key"),
    },
  });
  await client.attendee.create({
    data: {
      id: SWITCH_OFF_ATTENDEE_ID,
      event_id: SWITCH_OFF_EVENT_ID,
      email: "switch-off@example.com",
      name: "Switch Off Guest",
      status: "registered",
    },
  });
  await client.walletPass.create({
    data: {
      attendee_id: SWITCH_OFF_ATTENDEE_ID,
      provider: "passcreator",
      provider_pass_id: "pc-switch-off-1",
      user_provided_id: SWITCH_OFF_USER_PROVIDED_ID,
      status: "active",
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
      registration_sync_attempted_at: null,
      // The ordering guard applyProviderSnapshotToWalletPass reads (lifecycle_observed_at) must
      // also be reset - a value left over from an earlier test would otherwise block a later
      // test's own (older, deliberately backdated) observedAt as "stale".
      lifecycle_observed_at: null,
      first_confirmed_at: null,
    },
  });
});

afterAll(async () => {
  const eventIds = [
    EVENT_ID,
    OTHER_EVENT_ID,
    UNCONFIGURED_EVENT_ID,
    CACHE_TEST_EVENT_ID,
    ROTATION_EVENT_ID,
    KEY_FETCH_FAILURE_EVENT_ID,
    SWITCH_OFF_EVENT_ID,
  ];
  await prisma.walletPass.deleteMany({ where: { attendee: { event_id: { in: eventIds } } } });
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

  it("acks 200 without touching the frozen snapshot when the pass has been removed from the provider (PR 3)", async () => {
    await prisma.walletPass.update({
      where: { attendee_id: ATTENDEE_ID },
      data: {
        status: "voided",
        provider_removed_at: new Date("2026-09-20T10:00:00.000Z"),
        apple_active_registrations: 5,
      },
    });
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    // A late redelivery carrying different counts than the frozen snapshot - must not overwrite it.
    const body = signedRequest({
      identifier: "pc-webhook-1",
      userProvidedId: USER_PROVIDED_ID,
      operatingSystem: "iOS",
      noOfActivePasses: 99,
    });

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.apple_active_registrations).toBe(5);
    expect(row?.status).toBe("voided");
    expect(querySystemLogs({ search: "wallet_webhook_removed_skipped" })).toHaveLength(1);
    expect(querySystemLogs({ search: "wallet_webhook_applied" })).toHaveLength(0);
  });

  it("also freezes a removed pass that has no user_provided_id, when the delivery names it by identifier only", async () => {
    await prisma.walletPass.update({
      where: { attendee_id: ATTENDEE_ID },
      data: {
        status: "voided",
        user_provided_id: null,
        provider_removed_at: new Date("2026-09-20T10:00:00.000Z"),
        apple_active_registrations: 5,
      },
    });
    try {
      const app = makeApp(stubProvider(keyPair.publicKey));
      const body = signedRequest({ identifier: "pc-webhook-1", operatingSystem: "iOS", noOfActivePasses: 99 });

      const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(200);
      const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
      expect(row?.apple_active_registrations).toBe(5);
      expect(querySystemLogs({ search: "wallet_webhook_removed_skipped" })).toHaveLength(1);
    } finally {
      await prisma.walletPass.update({
        where: { attendee_id: ATTENDEE_ID },
        data: { user_provided_id: USER_PROVIDED_ID },
      });
    }
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

  it("fetches the signing key again after the event's API key is replaced, instead of verifying against the old account's key", async () => {
    const oldKey = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const post = (app: ReturnType<typeof makeApp>, privateKeyPem: string) =>
      app.request(`/api/wallet/webhook/passcreator/${ROTATION_EVENT_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedRequest({ identifier: "pc-rotation" }, privateKeyPem)),
      });

    // First account: its key is fetched and cached.
    const firstProvider = stubProvider(oldKey.publicKey);
    expect((await post(makeApp(firstProvider), oldKey.privateKey)).status).toBe(200);

    // The event is switched to another PassCreator account.
    await prisma.event.update({
      where: { id: ROTATION_EVENT_ID },
      data: { wallet_api_key_enc: encryptToString("second-api-key") },
    });
    const secondProvider = stubProvider(keyPair.publicKey);
    const secondApp = makeApp(secondProvider);

    // The new account's genuine delivery verifies, and the old account's key no longer does.
    expect((await post(secondApp, keyPair.privateKey)).status).toBe(200);
    expect(secondProvider.getWebhookPublicKey).toHaveBeenCalledTimes(1);
    expect((await post(secondApp, oldKey.privateKey)).status).toBe(401);
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

  it.each(["", "/first-confirmed"])(
    "does not let a delivery on one event's route%s change another event's pass it names by identifier alone",
    async (suffix) => {
      const provider = stubProvider(keyPair.publicKey);
      const app = makeApp(provider);
      // No userProvidedId, so payloadNamesADifferentEvent has nothing to compare - only the
      // event-scoped write keeps this from landing on SWITCH_OFF_EVENT_ID's pass.
      const body = signedRequest({ identifier: "pc-switch-off-1", operatingSystem: "iOS", noOfActivePasses: 7 });

      const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}${suffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(200);
      const row = await prisma.walletPass.findUnique({ where: { attendee_id: SWITCH_OFF_ATTENDEE_ID } });
      expect(row?.apple_active_registrations).toBeNull();
      expect(row?.registration_checked_at).toBeNull();
      expect(row?.first_confirmed_at).toBeNull();
      expect(querySystemLogs({ search: "wallet_webhook_unmatched" })).toHaveLength(1);
    },
  );

  it("does not let unsigned requests burn an event's per-event allowance: a real delivery still gets through afterwards", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const post = (body: object) =>
      app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    // Signed with another key, so every one is rejected as 401 - none may count toward the event's bucket.
    const stranger = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const forged = signedRequest({ identifier: "pc-webhook-1" }, stranger.privateKey);
    for (let i = 0; i < 125; i++) {
      expect((await post(forged)).status).toBe(401);
    }

    const real = await post(signedRequest({ identifier: "pc-webhook-1", userProvidedId: USER_PROVIDED_ID }));
    expect(real.status).toBe(200);
  });

  it("does not let a signed payload replayed from another event spend this event's allowance", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const post = (body: object) =>
      app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    // Accounts share a signing key across events, so a payload genuinely signed for the other event
    // verifies here too; it names another event and must be acked without charging this one's budget.
    const foreign = signedRequest({
      identifier: "pc-webhook-1",
      userProvidedId: `admitto:${OTHER_EVENT_ID}:${ATTENDEE_ID}`,
    });
    for (let i = 0; i < 125; i++) {
      expect((await post(foreign)).status).toBe(200);
    }

    const real = await post(signedRequest({ identifier: "pc-webhook-1", userProvidedId: USER_PROVIDED_ID }));
    expect(real.status).toBe(200);
  });

  it("answers 429 to signature-verified deliveries beyond the per-event ceiling, and keeps other events unaffected", async () => {
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);
    const deliver = (eventId: string) =>
      app.request(`/api/wallet/webhook/passcreator/${eventId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedRequest({ identifier: "pc-webhook-1" })),
      });

    for (let i = 0; i < 120; i++) {
      expect((await deliver(EVENT_ID)).status).toBe(200);
    }
    expect((await deliver(EVENT_ID)).status).toBe(429);
    // Another event with its own credentials is still served.
    expect((await deliver(OTHER_EVENT_ID)).status).not.toBe(429);
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

describe("webhooks for an event whose Wallet master switch is off but whose credentials are configured", () => {
  // Switching Wallet off stops new passes; it does not unsubscribe the PassCreator hooks, so the
  // deliveries for passes that already exist keep arriving. No injected provider here: this goes
  // through the real resolution from the event's stored credentials, with PassCreator's HTTP API
  // stubbed at the global fetch.
  function stubPassCreatorApi(searchStatus = 500) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        if (String(input).includes("/api/hook/publickey")) {
          return new Response(JSON.stringify({ publicKey: keyPair.publicKey }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: false, errors: ["stubbed"] }), {
          status: searchStatus,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("still applies a registration delivery", async () => {
    stubPassCreatorApi();
    const app = makeApp(undefined);
    const body = signedRequest({
      identifier: "pc-switch-off-1",
      userProvidedId: SWITCH_OFF_USER_PROVIDED_ID,
      operatingSystem: "iOS",
      noOfActivePasses: 1,
    });

    const res = await app.request(`/api/wallet/webhook/passcreator/${SWITCH_OFF_EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: SWITCH_OFF_ATTENDEE_ID } });
    expect(row?.apple_active_registrations).toBe(1);
  });

  it("records a real void even though a no-data write (a periodic sync attempt that found no provider, or a per-pass failure) advanced registration_sync_attempted_at for this same pass in between - that column is not the ordering guard", async () => {
    // Simulates the exact race the sync's own "wallet not configured" bucket-skip (or a per-pass
    // no-match/failure attempt) can cause: a write that bumps registration_sync_attempted_at with
    // no observation attached, landing between the webhook's re-read starting and its own write.
    await prisma.walletPass.update({
      where: { attendee_id: SWITCH_OFF_ATTENDEE_ID },
      data: { registration_sync_attempted_at: new Date() },
    });
    const provider = stubProvider(keyPair.publicKey);
    vi.mocked(provider.getPassSnapshot).mockResolvedValue(
      walletSnapshot(
        { appleActive: 1 },
        { observedAt: new Date(Date.now() - 10_000), validity: { voided: true, expirationRaw: null, expiresAt: null } },
      ),
    );
    const app = makeApp(provider);

    const res = await app.request(`/api/wallet/webhook/passcreator/${SWITCH_OFF_EVENT_ID}/voided`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedRequest({ identifier: "pc-switch-off-1", userProvidedId: SWITCH_OFF_USER_PROVIDED_ID })),
    });

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: SWITCH_OFF_ATTENDEE_ID } });
    expect(row?.status).toBe("voided");
    expect(row?.apple_active_registrations).toBe(1);

    await prisma.walletPass.update({
      where: { attendee_id: SWITCH_OFF_ATTENDEE_ID },
      data: { status: "active", voided_at: null, apple_active_registrations: null, lifecycle_observed_at: null },
    });
  });

  it("still reaches the pass_voided reconciliation instead of dropping the delivery with a 404", async () => {
    stubPassCreatorApi(500);
    const app = makeApp(undefined);
    const body = signedRequest({ identifier: "pc-switch-off-1", userProvidedId: SWITCH_OFF_USER_PROVIDED_ID });

    const res = await app.request(`/api/wallet/webhook/passcreator/${SWITCH_OFF_EVENT_ID}/voided`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // 503, not 404: the provider was resolved from the stored credentials and the re-read of the
    // pass was attempted (and failed against the stubbed API), so PassCreator redelivers.
    expect(res.status).toBe(503);
    expect(querySystemLogs({ search: "wallet_webhook_reconcile_failed" })).toHaveLength(1);
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

  it("does not let a stale 'voided' read undo Admitto's own Restore made a minute ago - and answers 503, since a real re-void landing in the same window would look identical", async () => {
    await prisma.walletPass.update({
      where: { attendee_id: ATTENDEE_ID },
      data: { provider_commanded_at: new Date(Date.now() - 60_000) },
    });
    const provider = stubProvider(keyPair.publicKey);
    vi.mocked(provider.getPassSnapshot).mockResolvedValue(
      walletSnapshot({ appleActive: 1 }, { observedAt: new Date(), validity: { voided: true, expirationRaw: null, expiresAt: null } }),
    );
    const app = makeApp(provider);

    const res = await postVoided(app, voidedDelivery());

    expect(res.status).toBe(503);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    // Not undone, and not recorded as voided either - genuinely undecided, so PassCreator must
    // redeliver rather than being told this delivery is fully handled. The registration counts of
    // that same read are still kept.
    expect(row?.status).toBe("active");
    expect(row?.apple_active_registrations).toBe(1);
    expect(querySystemLogs({ search: "wallet_webhook_reconcile_suppressed" })).toHaveLength(1);
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

  it("acks 200 without asking the provider when the pass has already been removed from the provider (PR 3) - a late redelivery racing Remove", async () => {
    await prisma.walletPass.update({
      where: { attendee_id: ATTENDEE_ID },
      data: { status: "voided", provider_removed_at: new Date("2026-09-20T10:00:00.000Z") },
    });
    const provider = stubProvider(keyPair.publicKey);
    const app = makeApp(provider);

    const res = await postVoided(app, voidedDelivery());

    expect(res.status).toBe(200);
    expect(provider.getPassSnapshot).not.toHaveBeenCalled();
    expect(querySystemLogs({ search: "wallet_webhook_removed_skipped" })).toHaveLength(1);
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

  it("does not let a second write at the exact same millisecond-resolution observedAt overwrite the first, against real Postgres comparison semantics (strict <, not <=)", async () => {
    const tiedAt = new Date();
    await prisma.walletPass.update({
      where: { attendee_id: ATTENDEE_ID },
      // Simulates a first read that already landed at exactly this instant, reporting the pass
      // NOT voided (a clean read) with its own registration counts.
      data: { lifecycle_observed_at: tiedAt, apple_active_registrations: 5 },
    });
    const provider = stubProvider(keyPair.publicKey);
    vi.mocked(provider.getPassSnapshot).mockResolvedValue(
      // A second, independent read tied at the exact same instant - Date/TIMESTAMP(3) both
      // truncate to milliseconds, so this is a genuine collision, not a contrived one. With a
      // non-strict `<=` guard this write would still match and could overwrite the first read's
      // data with its own, whichever one the database happens to apply last (the bug reported).
      walletSnapshot({ appleActive: 1 }, { observedAt: tiedAt, validity: { voided: true, expirationRaw: null, expiresAt: null } }),
    );
    const app = makeApp(provider);

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}/voided`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(voidedDelivery()),
    });

    // A conflict, same as any other pass whose identity changed mid-flight - answered 200, like
    // every other conflict in this design (something else already recorded a valid answer for this
    // exact instant). The important part is what did NOT happen: the losing write's own data (voided,
    // apple_active_registrations: 1) never lands on top of the first read's.
    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("active");
    expect(row?.apple_active_registrations).toBe(5);
  });

  it("records the void even though a plain registration webhook advanced registration_checked_at while the re-read was in flight (a count-only delivery carries no lifecycle observation)", async () => {
    // Simulates: a pass_voided delivery starts its re-read (observedAt stamped at request time,
    // see PassCreatorClient.getPassSnapshot), a plain registration webhook for the SAME pass lands
    // and is applied before the re-read's own answer comes back, then the re-read resolves as
    // voided. Only registration_checked_at is bumped by the registration webhook - the ordering
    // guard is keyed on registration_sync_attempted_at, which that delivery never touches - so the
    // voided write must still land.
    const registrationOnlyProvider = stubProvider(keyPair.publicKey);
    const registrationApp = makeApp(registrationOnlyProvider);
    await registrationApp.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        signedRequest({
          identifier: "pc-webhook-1",
          userProvidedId: USER_PROVIDED_ID,
          operatingSystem: "iOS",
          noOfActivePasses: 1,
        }),
      ),
    });
    const afterRegistration = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(afterRegistration?.apple_active_registrations).toBe(1);

    const provider = stubProvider(keyPair.publicKey);
    vi.mocked(provider.getPassSnapshot).mockResolvedValue(
      // Observed before the registration webhook above was even applied.
      walletSnapshot({}, { observedAt: new Date(Date.now() - 10_000), validity: { voided: true, expirationRaw: null, expiresAt: null } }),
    );
    const app2 = makeApp(provider);

    const res = await app2.request(`/api/wallet/webhook/passcreator/${EVENT_ID}/voided`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(voidedDelivery()),
    });

    expect(res.status).toBe(200);
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_ID } });
    expect(row?.status).toBe("voided");
    expect(row?.voided_at).not.toBeNull();
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
