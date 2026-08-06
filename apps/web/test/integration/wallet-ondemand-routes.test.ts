import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import type { WalletPassProvider } from "@admitto/wallet";
import { WalletProviderError } from "@admitto/wallet";
import { resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const ORG_ID = "org-wallet";
const EVENT_ID = "evt-wallet";
const EVENT_SLUG = "wallet-gala";
const PUBLIC_REF = generateToken();
const MODE_A_TOKEN = generateToken();
const ATTENDEE_AGENCY_ID = "attendee-wallet-agency";
const ATTENDEE_MODE_A_ID = "attendee-wallet-mode-a";
const ATTENDEE_REVOKED_ID = "attendee-wallet-revoked";
const REVOKED_TOKEN = generateToken();

let prisma: PrismaClient;

function stubProvider(): WalletPassProvider & {
  createPass: ReturnType<typeof vi.fn>;
} {
  return {
    provider: "stub",
    createPass: vi.fn(async (input) => ({
      providerPassId: `pc-${input.userProvidedId}`,
      downloadUrl: "https://pc.test/p/x",
      appleUrl: "https://pc.test/apple/x",
      androidUrl: "https://pc.test/android/x",
    })),
    updatePass: vi.fn(),
    voidPass: vi.fn(),
    restorePass: vi.fn(),
    findByUserProvidedId: vi.fn(async () => null),
  };
}

async function seedWalletFixture(client: PrismaClient): Promise<void> {
  await client.walletPass.deleteMany({ where: { attendee: { event_id: EVENT_ID } } });
  await client.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await client.event.deleteMany({ where: { id: EVENT_ID } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  await client.organization.create({ data: { id: ORG_ID, name: "Org", slug: "wallet-org" } });
  await client.event.create({
    data: {
      id: EVENT_ID,
      title: "Wallet Gala",
      slug: EVENT_SLUG,
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      event_hours_start: "18:00",
      event_hours_end: "22:00",
    },
  });
  await client.attendee.create({
    data: {
      id: ATTENDEE_AGENCY_ID,
      event_id: EVENT_ID,
      email: "agency@example.com",
      name: "Agency Guest",
      qr_payload: "WALLET-AGENCY-PAYLOAD",
      public_ref: PUBLIC_REF,
    },
  });
  await client.attendee.create({
    data: {
      id: ATTENDEE_MODE_A_ID,
      event_id: EVENT_ID,
      email: "modea@example.com",
      name: "Mode A Guest",
      token_hash: hashToken(MODE_A_TOKEN),
      token_enc: encryptToString(MODE_A_TOKEN),
      status: "registered",
    },
  });
  await client.attendee.create({
    data: {
      id: ATTENDEE_REVOKED_ID,
      event_id: EVENT_ID,
      email: "revoked@example.com",
      name: "Revoked Guest",
      token_hash: hashToken(REVOKED_TOKEN),
      token_enc: encryptToString(REVOKED_TOKEN),
      status: "revoked",
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seedWalletFixture(prisma);
});

beforeEach(() => {
  resetSystemLogBufferForTest();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.walletPass.deleteMany({ where: { attendee: { event_id: EVENT_ID } } });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

function makeApp(walletPassProvider: WalletPassProvider) {
  return createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    walletPassProvider,
  });
}

describe("On-demand wallet routes", () => {
  it("Mode A apple: creates a pass and redirects to appleUrl", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://pc.test/apple/x");
    expect(provider.createPass).toHaveBeenCalledTimes(1);
    expect(provider.createPass).toHaveBeenCalledWith(
      expect.objectContaining({
        attendeeName: "Mode A Guest",
        eventHoursLabel: "18:00-22:00",
        userProvidedId: `admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}`,
      }),
    );

    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.status).toBe("active");
    expect(saved?.apple_url).toBe("https://pc.test/apple/x");
  });

  it("Mode A google: redirects to androidUrl", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/google`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://pc.test/android/x");
  });

  it("Mode B apple/google: resolves via public_ref and redirects", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    const appleRes = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}/wallet/apple`, {
      redirect: "manual",
    });
    expect(appleRes.status).toBe(302);
    expect(appleRes.headers.get("location")).toBe("https://pc.test/apple/x");
    expect(provider.createPass).toHaveBeenCalledTimes(1);

    const googleRes = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}/wallet/google`, {
      redirect: "manual",
    });
    expect(googleRes.status).toBe(302);
    expect(googleRes.headers.get("location")).toBe("https://pc.test/android/x");
    // Idempotent: second click (different platform) reuses the saved pass, no second API call.
    expect(provider.createPass).toHaveBeenCalledTimes(1);
  });

  it("is idempotent on repeat clicks — does not call createPass twice", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
    const second = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe("https://pc.test/apple/x");
    expect(provider.createPass).toHaveBeenCalledTimes(1);
  });

  it("redirects back with walletError=1 and records status=failed on provider error", async () => {
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(
      new WalletProviderError("wallet_provider_rejected", "boom"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);

    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.status).toBe("failed");
    expect(saved?.last_error_code).toBe("wallet_provider_rejected");
    errSpy.mockRestore();
  });

  it("shows the retry notice on the ticket page after walletError=1", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}?walletError=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Could not add this ticket to your wallet");
  });

  it("does not call the provider for a revoked attendee", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    const res = await app.request(`/t/${REVOKED_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(provider.createPass).not.toHaveBeenCalled();
  });

  it("fails soft (no bare 500) when no wallet provider is configured", async () => {
    const app = createApp({
      prisma,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
    });

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
  });

  it("real wallet links render on the ticket page", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}`);
    const html = await res.text();
    expect(html).toContain(`href="/t/${MODE_A_TOKEN}/wallet/apple"`);
    expect(html).toContain(`href="/t/${MODE_A_TOKEN}/wallet/google"`);
    expect(html).not.toContain("coming soon");
    expect(html).not.toContain("aria-disabled");
  });
});
