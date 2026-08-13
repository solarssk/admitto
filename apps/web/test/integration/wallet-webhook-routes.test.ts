import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import type { WalletPassInput, WalletPassProvider } from "@admitto/wallet";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

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
  const signer = createSign("SHA256");
  signer.update(data, "utf8");
  signer.end();
  return signer.sign(privateKeyPem, "hex");
}

function stubProvider(publicKey: string): WalletPassProvider & {
  getWebhookPublicKey: ReturnType<typeof vi.fn>;
} {
  return {
    provider: "stub",
    createPass: vi.fn(async (input: WalletPassInput) => ({
      providerPassId: `pc-${input.userProvidedId}`,
      appleUrl: "https://pc.test/apple/x",
      androidUrl: "https://pc.test/android/x",
    })),
    updatePass: vi.fn(),
    voidPass: vi.fn(),
    restorePass: vi.fn(),
    deletePass: vi.fn(),
    findByUserProvidedId: vi.fn(async () => null),
    getRegistrationStatus: vi.fn(async () => null),
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
      apple_active_registrations: null,
      apple_inactive_registrations: null,
      first_downloaded_at: null,
      registration_checked_at: null,
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
      noOfActiveRegistrationsAppleWallet: 1,
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
    const body = signedRequest({ identifier: "pc-does-not-exist", voided: true });

    const res = await app.request(`/api/wallet/webhook/passcreator/${EVENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    expect(querySystemLogs({ search: "wallet_webhook_unmatched" })).toHaveLength(1);
    expect(querySystemLogs({ search: "wallet_webhook_applied" })).toHaveLength(0);
  });

  it("applies a voided:true payload as a status transition", async () => {
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
    expect(row?.status).toBe("voided");
    expect(row?.voided_at).not.toBeNull();
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
