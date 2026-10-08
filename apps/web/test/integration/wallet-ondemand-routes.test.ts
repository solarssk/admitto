import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import type { WalletPassInput, WalletPassProvider } from "@admitto/wallet";
import { PASSCREATOR_CAPABILITIES, PASSCREATOR_CONSISTENCY_POLICY, WalletProviderError } from "@admitto/wallet";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
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
const EVENT_ID_NO_LOCATION = "evt-wallet-no-location";
const ATTENDEE_NO_LOCATION_ID = "attendee-wallet-no-location";
const NO_LOCATION_TOKEN = generateToken();

// Only used by the "lock race" test below, which drives the admin PATCH route on the same app.
const SUPER_EMAIL = "wallet-race-super@example.com";
const SUPER_PASSWORD = "wallet-race-super-pass-123";
const sameOrigin = { Origin: "http://localhost" };

let prisma: PrismaClient;
let superCookie = "";

function stubProvider(): WalletPassProvider & {
  createPass: ReturnType<typeof vi.fn>;
  updatePass: ReturnType<typeof vi.fn>;
  findByUserProvidedId: ReturnType<typeof vi.fn>;
} {
  return {
    provider: "stub",
    capabilities: PASSCREATOR_CAPABILITIES,
    consistencyPolicy: PASSCREATOR_CONSISTENCY_POLICY,
    createPass: vi.fn(async (input: WalletPassInput) => ({
      providerPassId: `pc-${input.userProvidedId}`,
      downloadUrl: "https://pc.test/p/x",
      appleUrl: "https://pc.test/apple/x",
      androidUrl: "https://pc.test/android/x",
    })),
    // Default mirrors createPass's own shape (used by createOrRecoverPass's duplicate-recovery
    // reconcile push, plan v4.2 step 6/CodeRabbit review) - a test asserting specific recovered
    // URLs overrides this per-call.
    updatePass: vi.fn(async (providerPassId: string) => ({
      providerPassId,
      downloadUrl: "https://pc.test/p/x",
      appleUrl: "https://pc.test/apple/x",
      androidUrl: "https://pc.test/android/x",
    })),
    sendPushMessage: vi.fn(),
    voidPass: vi.fn(),
    restorePass: vi.fn(),
    deletePass: vi.fn(),
    findByUserProvidedId: vi.fn(async () => null),
    getPassSnapshot: vi.fn(async () => null),
  };
}

async function seedWalletFixture(client: PrismaClient): Promise<void> {
  await client.walletPass.deleteMany({ where: { attendee: { event_id: EVENT_ID } } });
  await client.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await client.event.deleteMany({ where: { id: EVENT_ID } });
  // Must run before the organization delete below - both events share ORG_ID via a foreign key.
  await client.walletPass.deleteMany({ where: { attendee: { event_id: EVENT_ID_NO_LOCATION } } });
  await client.attendee.deleteMany({ where: { event_id: EVENT_ID_NO_LOCATION } });
  await client.event.deleteMany({ where: { id: EVENT_ID_NO_LOCATION } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  await client.organization.create({ data: { id: ORG_ID, name: "Org", slug: "wallet-org" } });
  await client.event.create({
    data: {
      id: EVENT_ID,
      title: "Wallet Gala",
      slug: EVENT_SLUG,
      date: new Date("2099-09-01"), // far ahead: Add to Wallet closes once the event is over
      organization_id: ORG_ID,
      event_hours_start: "18:00",
      event_hours_end: "22:00",
      wallet_template_id: "tmpl-wallet-gala",
      location_details: {
        create: {
          venue_name: "Grand Hall",
          latitude: 52.2297,
          longitude: 21.0122,
          address_components: {
            object_name: "Grand Hall",
            street: "Main 1",
            postcode: "00-001",
            city: "Warsaw",
            region: "Mazovia",
            country: "Poland",
          },
        },
      },
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
      first_name: "Mode",
      last_name: "Guest",
      company: "Acme",
      department: "Engineering",
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

  await client.event.create({
    data: {
      id: EVENT_ID_NO_LOCATION,
      title: "Wallet Gala (no venue)",
      slug: "wallet-gala-no-location",
      date: new Date("2099-09-01"), // far ahead: Add to Wallet closes once the event is over
      organization_id: ORG_ID,
      wallet_template_id: "tmpl-wallet-gala",
    },
  });
  await client.attendee.create({
    data: {
      id: ATTENDEE_NO_LOCATION_ID,
      event_id: EVENT_ID_NO_LOCATION,
      email: "noloc@example.com",
      name: "No Location Guest",
      token_hash: hashToken(NO_LOCATION_TOKEN),
      token_enc: encryptToString(NO_LOCATION_TOKEN),
      status: "registered",
    },
  });
}

async function seedSuperadmin(client: PrismaClient): Promise<string> {
  await client.session.deleteMany({ where: { user: { email: SUPER_EMAIL } } });
  await client.roleAssignment.deleteMany({ where: { user: { email: SUPER_EMAIL } } });
  await client.user.deleteMany({ where: { email: SUPER_EMAIL } });
  const superUser = await client.user.create({
    data: { email: SUPER_EMAIL, password_hash: await hashPassword(SUPER_PASSWORD) },
  });
  await client.roleAssignment.create({
    data: { user_id: superUser.id, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  // Superadmin is an MFA-required role - a FULL-stage session for a user with no confirmed
  // method gets silently downgraded (createSession) / rejected (validateSession), so the PATCH
  // below would 401 without this.
  await client.userMfaMethod.create({
    data: {
      user_id: superUser.id,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
  return superUser.id;
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seedWalletFixture(prisma);
  const superId = await seedSuperadmin(prisma);
  const superSession = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${superSession.rawToken}`;
});

beforeEach(() => {
  resetSystemLogBufferForTest();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await prisma.walletPass.deleteMany({ where: { attendee: { event_id: EVENT_ID } } });
  await prisma.walletPass.deleteMany({ where: { attendee: { event_id: EVENT_ID_NO_LOCATION } } });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

/** Makes the n-th `prisma.$transaction` of the test reject; every other call is the real one. */
function failNthTransaction(n: number) {
  const real = prisma.$transaction.bind(prisma) as unknown as (...args: unknown[]) => Promise<unknown>;
  let calls = 0;
  return vi.spyOn(prisma, "$transaction").mockImplementation(((...args: unknown[]) =>
    ++calls === n ? Promise.reject(new Error("db down")) : real(...args)) as never);
}

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
        attendeeFirstNameLabel: "Mode",
        attendeeLastNameLabel: "Guest",
        attendeeEmailLabel: "modea@example.com",
        attendeeCompanyLabel: "Acme",
        attendeeDepartmentLabel: "Engineering",
        eventNameLabel: "Wallet Gala",
        eventHoursLabel: "18:00 - 22:00 UTC",
        directionsTextLabel: undefined,
        googleMapsUrlLabel: expect.stringContaining("google.com"),
        appleMapsUrlLabel: expect.stringContaining("apple.com"),
        addressObjectNameLabel: "Grand Hall",
        addressStreetLabel: "Main 1",
        addressPostcodeLabel: "00-001",
        addressCityLabel: "Warsaw",
        addressRegionLabel: "Mazovia",
        addressCountryLabel: "Poland",
        userProvidedId: `admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}`,
        barcodeValue: MODE_A_TOKEN,
      }),
    );

    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.status).toBe("active");
    expect(saved?.apple_url).toBe("https://pc.test/apple/x");
  });

  it("Mode A apple, attendee with no email on file: omits attendeeEmailLabel", async () => {
    await prisma.attendee.update({ where: { id: ATTENDEE_MODE_A_ID }, data: { email: "" } });
    try {
      const provider = stubProvider();
      const app = makeApp(provider);

      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

      expect(res.status).toBe(302);
      expect(provider.createPass).toHaveBeenCalledWith(
        expect.objectContaining({ attendeeEmailLabel: undefined }),
      );
    } finally {
      await prisma.attendee.update({
        where: { id: ATTENDEE_MODE_A_ID },
        data: { email: "modea@example.com" },
      });
    }
  });

  it("Mode A apple, event with no venue: omits Maps links and address fields", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    const res = await app.request(`/t/${NO_LOCATION_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(provider.createPass).toHaveBeenCalledWith(
      expect.objectContaining({
        googleMapsUrlLabel: undefined,
        appleMapsUrlLabel: undefined,
        addressObjectNameLabel: undefined,
        addressStreetLabel: undefined,
        eventLocationLabel: undefined,
        userProvidedId: `admitto:${EVENT_ID_NO_LOCATION}:${ATTENDEE_NO_LOCATION_ID}`,
        barcodeValue: NO_LOCATION_TOKEN,
      }),
    );
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
    // Agency mode: barcodeValue is the raw agency payload verbatim, not an internal ticket URL.
    expect(provider.createPass).toHaveBeenCalledWith(
      expect.objectContaining({ barcodeValue: "WALLET-AGENCY-PAYLOAD" }),
    );

    const googleRes = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}/wallet/google`, {
      redirect: "manual",
    });
    expect(googleRes.status).toBe(302);
    expect(googleRes.headers.get("location")).toBe("https://pc.test/android/x");
    // Idempotent: second click (different platform) reuses the saved pass, no second API call.
    expect(provider.createPass).toHaveBeenCalledTimes(1);
  });

  it("captures the request User-Agent on the redirect, even for an already-active pass (repeat clicks refresh it)", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15" },
    });
    const first = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(first?.user_agent).toBe("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15");
    expect(first?.user_agent_captured_at).not.toBeNull();

    // Same pass, already active - resolvePassUrls takes the early-return branch with no upsert,
    // but the capture below it must still run and overwrite the earlier value.
    await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/128.0" },
    });
    const second = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(second?.user_agent).toBe("Mozilla/5.0 (Linux; Android 14) Chrome/128.0");
    expect(provider.createPass).toHaveBeenCalledTimes(1);
  });

  it("freezes the captured User-Agent once first_confirmed_at is set - a later click (e.g. a mail security scanner re-fetching the link) does not overwrite it", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15" },
    });
    // Simulates PassCreator's first_pushnotification_registered webhook confirming a real device
    // actually added the pass (applyFirstConfirmedAt) - only ever set from a real wallet app, never
    // from a redirect click itself.
    await prisma.walletPass.update({
      where: { attendee_id: ATTENDEE_MODE_A_ID },
      data: { first_confirmed_at: new Date() },
    });

    await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, {
      redirect: "manual",
      headers: { "user-agent": "curl/8.0 (compatible; MailScannerBot/1.0)" },
    });

    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.user_agent).toBe("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15");
  });

  it("never captures a device for a pass that was already confirmed before this column existed (bot review) - no unconfirmed window left to safely tell a real click from a mail scanner's", async () => {
    await prisma.walletPass.create({
      data: {
        attendee_id: ATTENDEE_MODE_A_ID,
        provider: "passcreator",
        provider_pass_id: "pc-legacy-confirmed",
        user_provided_id: `admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}`,
        status: "active",
        apple_url: "https://pc.test/apple/x",
        android_url: "https://pc.test/android/x",
        // Confirmed long before user_agent capture shipped - first_confirmed_at set, user_agent
        // still null, exactly the state every real pre-existing row is in on migration day.
        first_confirmed_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const provider = stubProvider();
    const app = makeApp(provider);

    await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15" },
    });

    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.user_agent).toBeNull();
    expect(provider.createPass).not.toHaveBeenCalled();
  });

  it("does not fail the redirect when the device-capture write itself throws", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);
    // The device capture runs in its own transaction, after the one that saves the new pass.
    const transactionSpy = failNthTransaction(2);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://pc.test/apple/x");
    expect(transactionSpy).toHaveBeenCalledTimes(2);
    transactionSpy.mockRestore();
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

  describe.each([
    ["voided", { status: "voided", voided_at: new Date() }],
    ["expired", { status: "expired" }],
    ["removed at the provider", { status: "voided", voided_at: new Date(), provider_removed_at: new Date("2026-09-20T10:00:00.000Z") }],
  ] as const)("a pass that is %s", (_label, passState) => {
    it("is never restored, re-created or handed out by a tap: back to the ticket page, no error, no provider call", async () => {
      await prisma.walletPass.create({
        data: {
          attendee_id: ATTENDEE_MODE_A_ID,
          provider: "passcreator",
          provider_pass_id: "pc-inactive-tap",
          user_provided_id: `admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}`,
          apple_url: "https://pc.test/apple/dead",
          android_url: "https://pc.test/android/dead",
          ...passState,
        },
      });
      const provider = stubProvider();
      const app = makeApp(provider);

      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}`);
      expect(provider.restorePass).not.toHaveBeenCalled();
      expect(provider.createPass).not.toHaveBeenCalled();
      expect(provider.findByUserProvidedId).not.toHaveBeenCalled();
      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(saved?.status).toBe(passState.status);
    });

    it("also hides the wallet buttons on the ticket page", async () => {
      await prisma.walletPass.create({
        data: {
          attendee_id: ATTENDEE_MODE_A_ID,
          provider: "passcreator",
          provider_pass_id: "pc-inactive-page",
          user_provided_id: `admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}`,
          ...passState,
        },
      });
      const app = makeApp(stubProvider());

      const res = await app.request(`/t/${MODE_A_TOKEN}`);

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain("Add to Apple Wallet");
      expect(html).not.toContain("Add to Google Wallet");
      expect(html).not.toContain("Add to Samsung Wallet");
    });
  });

  it("keeps the wallet buttons on the ticket page for an active pass", async () => {
    await prisma.walletPass.create({
      data: {
        attendee_id: ATTENDEE_MODE_A_ID,
        provider: "passcreator",
        provider_pass_id: "pc-active-page",
        user_provided_id: `admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}`,
        status: "active",
      },
    });
    const app = makeApp(stubProvider());

    const html = await (await app.request(`/t/${MODE_A_TOKEN}`)).text();

    expect(html).toContain("Add to Apple Wallet");
    expect(html).toContain("Add to Google Wallet");
  });

  it("keeps the wallet buttons on the ticket page when the pass lookup itself fails (the route re-checks)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const lookup = vi.spyOn(prisma.walletPass, "findUnique").mockRejectedValueOnce(new Error("db down"));
    const app = makeApp(stubProvider());

    const html = await (await app.request(`/t/${MODE_A_TOKEN}`)).text();

    expect(lookup).toHaveBeenCalled();
    expect(html).toContain("Add to Apple Wallet");
    expect(html).toContain("Add to Google Wallet");
    errSpy.mockRestore();
  });

  describe("expires_at (plan v4.2 step 6 canonical expiry)", () => {
    it("is null when the event's wallet_expiration_mode is 'none' (the default)", async () => {
      const provider = stubProvider();
      const app = makeApp(provider);

      await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(saved?.expires_at).toBeNull();
    });

    it("is set to the event's own end time (UTC) when wallet_expiration_mode is 'event_end'", async () => {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "event_end" } });
      try {
        const provider = stubProvider();
        const app = makeApp(provider);

        await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

        const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
        // event_hours_end "22:00", timezone "UTC" (fixture default) - same day, no rollover.
        expect(saved?.expires_at).toEqual(new Date("2099-09-01T22:00:00.000Z"));
      } finally {
        await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "none" } });
      }
    });
  });

  describe("once the event is over or archived", () => {
    async function withEventPatch(data: { date?: Date; archived_at?: Date | null }, run: () => Promise<void>) {
      const before = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_ID } });
      await prisma.event.update({ where: { id: EVENT_ID }, data });
      try {
        await run();
      } finally {
        await prisma.event.update({ where: { id: EVENT_ID }, data: { date: before.date, archived_at: before.archived_at } });
      }
    }

    it("a tap hands out nothing and creates nothing, without an error: an old mail link just returns to the ticket", async () => {
      await withEventPatch({ date: new Date("2020-01-01") }, async () => {
        const provider = stubProvider();
        const app = makeApp(provider);

        const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}`);
        expect(provider.createPass).not.toHaveBeenCalled();
        expect(await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } })).toBeNull();
      });
    });

    it("an already active pass is not handed out again after the event", async () => {
      await prisma.walletPass.create({
        data: {
          attendee_id: ATTENDEE_MODE_A_ID,
          provider: "passcreator",
          provider_pass_id: "pc-active-late",
          user_provided_id: `admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}`,
          status: "active",
          apple_url: "https://pc.test/apple/active",
          android_url: "https://pc.test/android/active",
        },
      });
      await withEventPatch({ date: new Date("2020-01-01") }, async () => {
        const res = await makeApp(stubProvider()).request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

        expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}`);
      });
    });

    it("an archived event closes it too, even before its date", async () => {
      await withEventPatch({ archived_at: new Date() }, async () => {
        const provider = stubProvider();
        const res = await makeApp(provider).request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

        expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}`);
        expect(provider.createPass).not.toHaveBeenCalled();
      });
    });

    it("an event that ends while the tap waits for its turn creates nothing", async () => {
      const originalFindUnique = prisma.walletPass.findUnique.bind(prisma.walletPass);
      let lookups = 0;
      vi.spyOn(prisma.walletPass, "findUnique").mockImplementation(((args: Parameters<typeof originalFindUnique>[0]) => {
        // The first lookup is the admission read, the second is the re-read under the creation
        // lock: the clock jumps past the event's end in between.
        if (args.where?.attendee_id === ATTENDEE_MODE_A_ID && ++lookups === 2) {
          vi.useFakeTimers({ toFake: ["Date"] });
          vi.setSystemTime(new Date("2099-09-03T12:00:00.000Z"));
        }
        return originalFindUnique(args);
      }) as unknown as typeof prisma.walletPass.findUnique);
      const provider = stubProvider();
      try {
        const res = await makeApp(provider).request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

        expect(lookups).toBe(2);
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}`);
        expect(provider.createPass).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
      expect(await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } })).toBeNull();
    });

    it("the ticket page drops the wallet buttons", async () => {
      await withEventPatch({ date: new Date("2020-01-01") }, async () => {
        const res = await makeApp(stubProvider()).request(`/t/${MODE_A_TOKEN}`);

        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).not.toContain("Add to Apple Wallet");
        expect(html).not.toContain("Add to Samsung Wallet");
      });
    });
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

  it("falls back to wallet_provider_rejected when createPass throws something other than a WalletProviderError", async () => {
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(new Error("unexpected network failure"));
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

  it("calls createPass only once for two near-simultaneous requests for the same attendee (e.g. a work computer and a phone both clicking before either has a WalletPass row yet)", async () => {
    const provider = stubProvider();
    let releaseCreate: (() => void) | undefined;
    let releaseSecondLookup: (() => void) | undefined;
    let secondLookupStarted: (() => void) | undefined;
    const originalFindUnique = prisma.walletPass.findUnique.bind(prisma.walletPass);
    let walletLookups = 0;
    vi.spyOn(prisma.walletPass, "findUnique").mockImplementation((args) => {
      const pending = (async () => {
        const pass = await originalFindUnique(args);
        if (args.where?.attendee_id === ATTENDEE_MODE_A_ID && ++walletLookups === 3) {
          secondLookupStarted?.();
          await new Promise<void>((resolve) => {
            releaseSecondLookup = resolve;
          });
        }
        return pass;
      })();
      return pending as unknown as ReturnType<typeof prisma.walletPass.findUnique>;
    });
    const createStarted = new Promise<void>((resolveStarted) => {
      provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
        resolveStarted();
        await new Promise<void>((resolve) => {
          releaseCreate = resolve;
        });
        return {
          providerPassId: `pc-${input.userProvidedId}`,
          downloadUrl: "https://pc.test/p/single-flight",
          appleUrl: "https://pc.test/apple/single-flight",
          androidUrl: "https://pc.test/android/single-flight",
        };
      });
    });
    const app = makeApp(provider);

    const first = app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
    // Only start the second request once createPass has genuinely been entered by the first, so
    // this deterministically exercises the same-tick race the lock exists for, rather than
    // depending on timing luck.
    await createStarted;
    const secondLookup = new Promise<void>((resolve) => {
      secondLookupStarted = resolve;
    });
    const second = app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
    await secondLookup;
    releaseCreate?.();
    const firstRes = await first;
    releaseSecondLookup?.();
    const secondRes = await second;

    expect(firstRes.status).toBe(302);
    expect(secondRes.status).toBe(302);
    expect(firstRes.headers.get("location")).toBe("https://pc.test/apple/single-flight");
    expect(secondRes.headers.get("location")).toBe("https://pc.test/apple/single-flight");
    expect(provider.createPass).toHaveBeenCalledTimes(1);
    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.provider_pass_id).toBe(`pc-admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}`);
  });

  it("redirects safely when the post-lock wallet-pass recheck fails", async () => {
    const provider = stubProvider();
    const originalFindUnique = prisma.walletPass.findUnique.bind(prisma.walletPass);
    vi.spyOn(prisma.walletPass, "findUnique")
      .mockImplementationOnce((args) => originalFindUnique(args))
      .mockRejectedValueOnce(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    expect(provider.createPass).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("hands out nothing, without an error, when the post-lock recheck finds the pass voided since the first read", async () => {
    await prisma.walletPass.create({
      data: {
        attendee_id: ATTENDEE_MODE_A_ID,
        provider: "passcreator",
        provider_pass_id: "pc-stale-voided",
        user_provided_id: `admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}`,
        download_url: "https://pc.test/p/stale",
        apple_url: "https://pc.test/apple/stale",
        android_url: "https://pc.test/android/stale",
        status: "voided",
        issued_at: new Date(),
        voided_at: new Date(),
      },
    });
    const provider = stubProvider();
    vi.spyOn(prisma.walletPass, "findUnique").mockResolvedValueOnce(null);
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}`);
    expect(provider.restorePass).not.toHaveBeenCalled();
    expect(provider.createPass).not.toHaveBeenCalled();
  });

  // recoverDuplicatePass is a lookup (findByUserProvidedId), not a push - createOrRecoverPass now
  // reconciles the recovered pass with this request's own fresh input via updatePass before
  // markActive ever sees it (plan v4.2 step 6/CodeRabbit review: otherwise a retry recovering an
  // earlier attempt's own now-orphaned pass could activate it with an expirationDate nobody can
  // confirm still matches the current wallet_expiration_mode). The final URLs are updatePass's
  // own result, not the raw lookup's.
  it("recovers a pass a concurrent request already created, reconciles it with a fresh updatePass push, and marks it active", async () => {
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(
      new WalletProviderError("wallet_provider_duplicate", "userProvidedId already exists"),
    );
    provider.findByUserProvidedId.mockResolvedValueOnce({
      providerPassId: "pc-winner",
      downloadUrl: "https://pc.test/p/winner",
      appleUrl: "https://pc.test/apple/winner",
      androidUrl: "https://pc.test/android/winner",
    });
    provider.updatePass.mockResolvedValueOnce({
      providerPassId: "pc-winner",
      downloadUrl: "https://pc.test/p/winner-reconciled",
      appleUrl: "https://pc.test/apple/winner-reconciled",
      androidUrl: "https://pc.test/android/winner-reconciled",
    });
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(provider.updatePass).toHaveBeenCalledWith("pc-winner", expect.objectContaining({ userProvidedId: expect.any(String) }));
    expect(res.headers.get("location")).toBe("https://pc.test/apple/winner-reconciled");
    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.status).toBe("active");
    expect(saved?.provider_pass_id).toBe("pc-winner");
    expect(saved?.last_error_code).toBeNull();
  });

  it("marks failed, not active, when the duplicate-recovery reconcile push itself fails", async () => {
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(
      new WalletProviderError("wallet_provider_duplicate", "userProvidedId already exists"),
    );
    provider.findByUserProvidedId.mockResolvedValueOnce({
      providerPassId: "pc-winner",
      downloadUrl: "https://pc.test/p/winner",
      appleUrl: "https://pc.test/apple/winner",
      androidUrl: "https://pc.test/android/winner",
    });
    provider.updatePass.mockRejectedValueOnce(new WalletProviderError("wallet_provider_timeout", "timed out"));
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.status).toBe("failed");
  });

  it("retries the duplicate-recovery lookup once when the first attempt finds nothing yet (search-index lag)", async () => {
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(
      new WalletProviderError("wallet_provider_duplicate", "userProvidedId already exists"),
    );
    provider.findByUserProvidedId.mockResolvedValueOnce(null).mockResolvedValueOnce({
      providerPassId: "pc-winner-delayed",
      downloadUrl: "https://pc.test/p/winner-delayed",
      appleUrl: "https://pc.test/apple/winner-delayed",
      androidUrl: "https://pc.test/android/winner-delayed",
    });
    provider.updatePass.mockResolvedValueOnce({
      providerPassId: "pc-winner-delayed",
      downloadUrl: "https://pc.test/p/winner-delayed",
      appleUrl: "https://pc.test/apple/winner-delayed",
      androidUrl: "https://pc.test/android/winner-delayed",
    });
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://pc.test/apple/winner-delayed");
    expect(provider.findByUserProvidedId).toHaveBeenCalledTimes(2);
    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.status).toBe("active");
    expect(saved?.provider_pass_id).toBe("pc-winner-delayed");
  });

  // Regression (CodeRabbit review, P1): Event Settings' wallet-credential guard
  // (event-settings-routes.ts's guardWalletCredentialChange) checks "has any pass been issued
  // yet" before letting an admin change the event's Template ID - but this handler resolves its
  // wallet provider from a snapshot taken at the top of the request, so an admin's Template ID
  // change landing in the window between that snapshot and this pass actually persisting would
  // otherwise let it save as "active" under a template the event no longer points at, permanently
  // orphaning it (sync, void/restore, push would all target the wrong template from then on).
  it("marks failed, not active, when the event's Template ID changes while this request's own createPass call is in flight", async () => {
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      // Simulates an admin's Event Settings save landing in the exact window between this
      // request resolving its wallet provider and its own createPass call returning.
      await prisma.event.update({
        where: { id: EVENT_ID },
        data: { wallet_template_id: "tmpl-changed-mid-request" },
      });
      return {
        providerPassId: `pc-${input.userProvidedId}`,
        downloadUrl: "https://pc.test/p/x",
        appleUrl: "https://pc.test/apple/x",
        androidUrl: "https://pc.test/android/x",
      };
    });
    const app = makeApp(provider);

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(saved?.status).toBe("failed");
      expect(saved?.last_error_code).toBe("wallet_credential_changed");
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_template_id: "tmpl-wallet-gala" } });
    }
  });

  // Regression (self-review + CodeRabbit review, plan v4.2 step 6): the provider's own
  // createPass call happens before markActive's lock/recheck, with whatever expirationDate the
  // *stale* pre-request snapshot computed - there is no way to un-send that call. markActive
  // detects a mismatch between what was actually sent and what the event's fresh
  // wallet_expiration_mode now says, and marks the pass failed rather than silently persisting a
  // local record inconsistent with what the provider was just told (mirrors the existing
  // Template ID mid-issuance race guard immediately above). The attendee's next tap re-resolves
  // the event fresh and creates a new pass with a createPass call consistent with current
  // settings, instead of a pass whose provider-side expiration (or lack of one) Admitto can no
  // longer see or fix.
  it("marks failed, not active, when the event's wallet_expiration_mode is enabled while this request's own createPass call is in flight", async () => {
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "event_end" } });
      return {
        providerPassId: `pc-${input.userProvidedId}`,
        downloadUrl: "https://pc.test/p/x",
        appleUrl: "https://pc.test/apple/x",
        androidUrl: "https://pc.test/android/x",
      };
    });
    const app = makeApp(provider);

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(saved?.status).toBe("failed");
      expect(saved?.last_error_code).toBe("wallet_expiration_changed");
      expect(saved?.expires_at).toBeNull();
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "none" } });
    }
  });

  // The dangerous direction: expirationDate was already sent to the provider (computed from the
  // stale "event_end" snapshot) when the settings save disables the mode mid-request - the
  // provider now has a real expiration date Admitto has no confirmed way to clear later. Refusing
  // to persist "active" here (same guard as above) stops that stale date from ever being recorded
  // as if nothing had been sent, which the automatic-push self-heal this event_end -> none
  // disable relies on elsewhere cannot detect on its own.
  it("marks failed, not active, when the event's wallet_expiration_mode is disabled while this request's own createPass call is in flight", async () => {
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "event_end" } });
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "none" } });
      return {
        providerPassId: `pc-${input.userProvidedId}`,
        downloadUrl: "https://pc.test/p/x",
        appleUrl: "https://pc.test/apple/x",
        androidUrl: "https://pc.test/android/x",
      };
    });
    const app = makeApp(provider);

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(saved?.status).toBe("failed");
      expect(saved?.last_error_code).toBe("wallet_expiration_changed");
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "none" } });
    }
  });

  // Regression (CodeRabbit follow-up review): the mode-only checks above miss a reschedule that
  // happens *without* touching wallet_expiration_mode at all - the event's own date/hours/
  // timezone all feed eventEndsAtLocal/eventEndsAtUtc's computation just as much as the mode
  // itself, but markActive used to only re-read wallet_template_id/wallet_expiration_mode fresh,
  // still computing expires_at from the outer, stale event snapshot.
  it("marks failed, not active, when the event's own end time changes (mode unchanged, still event_end) while this request's own createPass call is in flight", async () => {
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "event_end" } });
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      // Same mode throughout - only the event's own end time moves.
      await prisma.event.update({ where: { id: EVENT_ID }, data: { event_hours_end: "23:00" } });
      return {
        providerPassId: `pc-${input.userProvidedId}`,
        downloadUrl: "https://pc.test/p/x",
        appleUrl: "https://pc.test/apple/x",
        androidUrl: "https://pc.test/android/x",
      };
    });
    const app = makeApp(provider);

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(saved?.status).toBe("failed");
      expect(saved?.last_error_code).toBe("wallet_expiration_changed");
      expect(saved?.expires_at).toBeNull();
    } finally {
      await prisma.event.update({
        where: { id: EVENT_ID },
        data: { wallet_expiration_mode: "none", event_hours_end: "22:00" },
      });
    }
  });

  // Regression (CodeRabbit follow-up review): the first request above leaves a real pass at the
  // provider (its own createPass call succeeded before markActive's mismatch check ran) even
  // though it's marked failed locally - PassCreator's enforceUniqueUserProvidedId then rejects the
  // attendee's next tap as a duplicate, routing it through recoverDuplicatePass. Proves that path
  // reconciles the recovered pass with a fresh updatePass push (matching the retry's own current
  // wallet_expiration_mode) rather than just activating whatever content the first, now-orphaned
  // attempt happened to leave behind.
  it("reconciles a retry's recovered duplicate pass with the current wallet_expiration_mode, after the first attempt's own race left it behind", async () => {
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "event_end" } });
    const provider = stubProvider();
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "none" } });
      return {
        providerPassId: `pc-${input.userProvidedId}`,
        downloadUrl: "https://pc.test/p/x",
        appleUrl: "https://pc.test/apple/x",
        androidUrl: "https://pc.test/android/x",
      };
    });
    const app = makeApp(provider);

    try {
      // First tap: fails locally (previous test's own scenario), but its createPass call already
      // succeeded at the provider - pc-<userProvidedId> now exists there for real.
      const first = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
      expect(first.status).toBe(302);
      const afterFirst = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(afterFirst?.status).toBe("failed");

      // Second tap (the attendee trying again): this request's own fresh input reflects mode
      // "none" (no expirationDate at all). Its own createPass is rejected as a duplicate of the
      // first attempt's already-real pass, so it recovers - and must reconcile.
      provider.createPass.mockRejectedValueOnce(
        new WalletProviderError("wallet_provider_duplicate", "userProvidedId already exists"),
      );
      provider.findByUserProvidedId.mockResolvedValueOnce({
        providerPassId: `pc-${ATTENDEE_MODE_A_ID}`,
        downloadUrl: "https://pc.test/p/stale",
        appleUrl: "https://pc.test/apple/stale",
        androidUrl: "https://pc.test/android/stale",
      });
      provider.updatePass.mockResolvedValueOnce({
        providerPassId: `pc-${ATTENDEE_MODE_A_ID}`,
        downloadUrl: "https://pc.test/p/reconciled",
        appleUrl: "https://pc.test/apple/reconciled",
        androidUrl: "https://pc.test/android/reconciled",
      });

      const second = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

      expect(second.status).toBe(302);
      // Reconciled with THIS request's own fresh input (mode "none"), not the first attempt's -
      // proof the recovered pass isn't trusted as-is.
      expect(provider.updatePass).toHaveBeenCalledWith(
        `pc-${ATTENDEE_MODE_A_ID}`,
        expect.objectContaining({ expirationDate: undefined }),
      );
      expect(second.headers.get("location")).toBe("https://pc.test/apple/reconciled");
      const afterSecond = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(afterSecond?.status).toBe("active");
      expect(afterSecond?.expires_at).toBeNull();
      expect(afterSecond?.last_error_code).toBeNull();
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "none" } });
    }
  });

  // Genuinely concurrent requests (no mocking of one side's timing) - issuance's own recheck+
  // persist and the admin PATCH's own recheck+update each acquire the same per-event
  // pg_advisory_xact_lock (acquireWalletTemplateLock) before doing either, so whichever request's
  // transaction reaches Postgres first fully commits before the other's own recheck can run
  // (mirrors event-custom-fields-routes.test.ts's identical advisory-lock race tests). Whichever
  // side wins, the pass must never end up "active" while still bound to a template the event no
  // longer records using anywhere - the exact orphaning this lock exists to prevent (CodeRabbit
  // review, PR #1207).
  it("never leaves an active wallet pass under a stale template when issuance races an admin's Template ID change (advisory lock)", async () => {
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_template_id: "tmpl-race-a" } });
    const provider = stubProvider();
    const app = makeApp(provider);

    try {
      const [walletRes, patchRes] = await Promise.all([
        app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" }),
        app.request(`/api/admin/events/${EVENT_ID}`, {
          method: "PATCH",
          headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ wallet_template_id: "tmpl-race-b" }),
        }),
      ]);

      expect(walletRes.status).toBe(302);
      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      const row = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_ID } });

      if (patchRes.status === 200) {
        // The admin's change won the lock race and committed - issuance's own recheck (inside its
        // own, separately-locked transaction) must then have seen the new template and refused to
        // persist the pass as active under the old one.
        expect(row.wallet_template_id).toBe("tmpl-race-b");
        expect(saved?.status).toBe("failed");
        expect(saved?.last_error_code).toBe("wallet_credential_changed");
      } else {
        // Issuance won the lock race and committed first - the admin's own recheck must then have
        // seen the freshly-issued pass and refused the Template ID change outright.
        expect(patchRes.status).toBe(409);
        expect(row.wallet_template_id).toBe("tmpl-race-a");
        expect(saved?.status).toBe("active");
      }
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_template_id: "tmpl-wallet-gala" } });
    }
  });

  // Regression (CodeRabbit review, P2): the disable-direction guard's own issued-pass-count check
  // used to run before any transaction/lock - genuinely concurrent with issuance, no mocked
  // timing, same pattern as the Template ID race test above (mirrors event-custom-fields-
  // routes.test.ts's identical advisory-lock race tests). Whichever side wins the lock race, the
  // event must never end up with wallet_expiration_mode disabled while an active pass carries a
  // real, now-orphaned expirationDate the disable can't confirm was ever cleared.
  it("never disables wallet_expiration_mode while an issuance racing it commits a pass with a real expirationDate (advisory lock)", async () => {
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "event_end" } });
    const provider = stubProvider();
    const app = makeApp(provider);

    try {
      const [walletRes, patchRes] = await Promise.all([
        app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" }),
        app.request(`/api/admin/events/${EVENT_ID}`, {
          method: "PATCH",
          headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ wallet_expiration_mode: "none" }),
        }),
      ]);

      expect(walletRes.status).toBe(302);
      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      const row = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_ID } });

      if (patchRes.status === 200) {
        // The admin's disable won the lock race and committed - issuance's own recheck (inside
        // its own, separately-locked transaction) must then have seen the fresh "none" mode and
        // refused to persist a pass whose own createPass call already carried an expirationDate
        // computed from the stale "event_end" snapshot.
        expect(row.wallet_expiration_mode).toBe("none");
        expect(saved?.status).toBe("failed");
        expect(saved?.last_error_code).toBe("wallet_expiration_changed");
      } else {
        // Issuance won the lock race and committed first - the admin's own recheck must then
        // have seen the freshly-issued pass and refused the disable outright.
        expect(patchRes.status).toBe(409);
        expect(row.wallet_expiration_mode).toBe("event_end");
        expect(saved?.status).toBe("active");
        expect(saved?.expires_at).not.toBeNull();
      }
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "none" } });
    }
  });

  // The two racy tests above accept either winner, so the "admin wins" branch only runs when the
  // scheduler happens to order the requests that way. These pin that ordering: createPass is held
  // open, the admin's change commits while the tap is mid-issuance (after it read the event, before
  // its locked recheck), and only then is the provider call released. The recheck must refuse to
  // persist the pass as active under state the event no longer has.
  async function holdCreatePass(provider: ReturnType<typeof stubProvider>): Promise<{ entered: Promise<void>; release: () => void }> {
    let release!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => (markEntered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = provider.createPass.getMockImplementation() as
      | ((input: WalletPassInput) => Promise<unknown>)
      | undefined;
    if (!original) throw new Error("stubProvider().createPass has no default implementation to delegate to");
    provider.createPass.mockImplementationOnce(async (input: WalletPassInput) => {
      markEntered();
      await gate;
      return original(input);
    });
    return { entered, release };
  }

  it("refuses to persist a pass as active when the Template ID changed while its issuance was in flight", async () => {
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_template_id: "tmpl-gate-a" } });
    const provider = stubProvider();
    const app = makeApp(provider);
    const { entered, release } = await holdCreatePass(provider);

    try {
      const tap = app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
      await entered;
      const patchRes = await app.request(`/api/admin/events/${EVENT_ID}`, {
        method: "PATCH",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_template_id: "tmpl-gate-b" }),
      });
      release();
      const walletRes = await tap;

      expect(patchRes.status).toBe(200);
      expect(walletRes.status).toBe(302);
      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(saved?.status).toBe("failed");
      expect(saved?.last_error_code).toBe("wallet_credential_changed");
      const row = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_ID } });
      expect(row.wallet_template_id).toBe("tmpl-gate-b");
    } finally {
      release();
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_template_id: "tmpl-wallet-gala" } });
    }
  });

  it("refuses to persist a pass as active when the expiration mode changed while its issuance was in flight", async () => {
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "event_end" } });
    const provider = stubProvider();
    const app = makeApp(provider);
    const { entered, release } = await holdCreatePass(provider);

    try {
      const tap = app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
      await entered;
      const patchRes = await app.request(`/api/admin/events/${EVENT_ID}`, {
        method: "PATCH",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_expiration_mode: "none" }),
      });
      release();
      const walletRes = await tap;

      expect(patchRes.status).toBe(200);
      expect(walletRes.status).toBe(302);
      const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
      expect(saved?.status).toBe("failed");
      expect(saved?.last_error_code).toBe("wallet_expiration_changed");
      const row = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_ID } });
      expect(row.wallet_expiration_mode).toBe("none");
    } finally {
      release();
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_expiration_mode: "none" } });
    }
  });

  it("marks failed when a duplicate error can't be recovered (findByUserProvidedId finds nothing)", async () => {
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(
      new WalletProviderError("wallet_provider_duplicate", "userProvidedId already exists"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.status).toBe("failed");
    expect(saved?.last_error_code).toBe("wallet_provider_duplicate");
    errSpy.mockRestore();
  });

  it("marks failed when the duplicate-recovery lookup itself throws, without wasting a retry on it (bot review)", async () => {
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(
      new WalletProviderError("wallet_provider_duplicate", "userProvidedId already exists"),
    );
    provider.findByUserProvidedId.mockRejectedValueOnce(new Error("provider timeout"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    // A thrown lookup (auth failure, or its own HTTP timeout) is a real failure a second
    // identical call a moment later won't fix - only a resolved "no match yet" is worth
    // retrying, so this must not have doubled the attendee's wait for no benefit.
    expect(provider.findByUserProvidedId).toHaveBeenCalledTimes(1);
    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved?.status).toBe("failed");
    expect(saved?.last_error_code).toBe("wallet_provider_duplicate");
    errSpy.mockRestore();
  });

  // Regression (bot review, PR #1478): walletCreateLocks only serializes calls within one
  // running `app` instance (its own doc comment) - it does nothing for a horizontally-scaled
  // deployment, where a second instance can race the same attendee past PassCreator's own
  // eventually-consistent duplicate check. If that second instance's duplicate-recovery lookup
  // misses on both attempts (the real search-index-lag case recoverDuplicatePass's own doc
  // comment describes), it falls through to markFailed - which must not be allowed to overwrite a
  // winning instance's already-"active" row, leaving a WalletPass with status "failed" and
  // issued_at still set: a combination no other write path in this codebase ever produces.
  it("does not let a losing instance's markFailed clobber a winning instance's already-active row", async () => {
    const winnerProvider = stubProvider();
    const loserProvider = stubProvider();
    loserProvider.createPass.mockRejectedValueOnce(
      new WalletProviderError("wallet_provider_duplicate", "userProvidedId already exists"),
    );
    let releaseFirstLookup: (() => void) | undefined;
    let firstLookupStarted: (() => void) | undefined;
    const firstLookupStartedPromise = new Promise<void>((resolve) => {
      firstLookupStarted = resolve;
    });
    // Both duplicate-recovery attempts miss - recoverDuplicatePass's real 1s delay between them is
    // left unmocked (same as "retries the duplicate-recovery lookup once" above), so the winner
    // below gets a full, undisturbed window to create and commit its own pass in the meantime.
    loserProvider.findByUserProvidedId.mockImplementationOnce(async () => {
      firstLookupStarted?.();
      await new Promise<void>((resolve) => {
        releaseFirstLookup = resolve;
      });
      return null;
    });
    loserProvider.findByUserProvidedId.mockResolvedValueOnce(null);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Two separate app instances - each gets its own walletCreateLocks Map, reproducing the exact
    // gap that per-instance lock cannot close.
    const winnerApp = makeApp(winnerProvider);
    const loserApp = makeApp(loserProvider);

    const loserRequest = loserApp.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
    // Parked mid-recovery, after its own "no row yet" read - the same starting point the real race
    // begins from - and before it knows the duplicate is unrecoverable.
    await firstLookupStartedPromise;

    const winnerRes = await winnerApp.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
    expect(winnerRes.status).toBe(302);
    const afterWinner = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(afterWinner?.status).toBe("active");
    expect(afterWinner?.issued_at).not.toBeNull();

    // Let the loser's stalled first lookup resolve (still null) and its real delayed retry run -
    // both miss, so it now falls through to markFailed against a row that is already "active".
    releaseFirstLookup?.();
    const loserRes = await loserRequest;

    expect(loserRes.status).toBe(302);
    expect(loserRes.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    const final = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(final?.status).toBe("active");
    expect(final?.issued_at?.getTime()).toBe(afterWinner?.issued_at?.getTime());
    expect(final?.provider_pass_id).toBe(afterWinner?.provider_pass_id);
    expect(final?.last_error_code).toBeNull();
    errSpy.mockRestore();
  });

  it("redirects with walletError=1 and logs when the walletPass lookup itself throws", async () => {
    const provider = stubProvider();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.walletPass, "findUnique").mockRejectedValueOnce(new Error("db down"));
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    expect(provider.createPass).not.toHaveBeenCalled();
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "wallet_pass_lookup_failed",
        fields: { eventId: EVENT_ID, attendeeId: ATTENDEE_MODE_A_ID },
      }),
    );
    errSpy.mockRestore();
  });

  it("redirects with walletError=1 and logs when saving the newly-active pass throws", async () => {
    const provider = stubProvider();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // markActive's recheck + upsert now run inside one transaction (the Template ID lock race
    // fix above) - mocking the transaction itself covers a failure anywhere inside it, same as
    // mocking the upsert directly did before that recheck and this save were made atomic.
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("db down"));
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "wallet_pass_upsert_failed",
        fields: { eventId: EVENT_ID, attendeeId: ATTENDEE_MODE_A_ID, providerPassId: `pc-admitto:${EVENT_ID}:${ATTENDEE_MODE_A_ID}` },
      }),
    );
    errSpy.mockRestore();
  });

  it("still redirects with walletError=1 when the failure-path save also throws", async () => {
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(
      new WalletProviderError("wallet_provider_rejected", "boom"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // markFailed's DB write runs in one transaction (it locks the attendee row first - see its doc
    // comment), so failing that transaction is the way to make the failure-path save throw.
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("db down"));
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "wallet_pass_create_failed",
        fields: { eventId: EVENT_ID, attendeeId: ATTENDEE_MODE_A_ID, errorCode: "wallet_provider_rejected" },
      }),
    );
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "wallet_pass_upsert_failed",
        fields: { eventId: EVENT_ID, attendeeId: ATTENDEE_MODE_A_ID },
      }),
    );
    errSpy.mockRestore();
  });

  it("updates an existing failed row's error code in place on a repeat failed attempt (no extra row created)", async () => {
    // markFailed's guarded updateMany (where status is not "active") matches this row directly -
    // the create-and-catch-P2002 fallback below it only runs when nothing matched, which must not
    // happen here.
    await prisma.walletPass.create({
      data: { attendee_id: ATTENDEE_MODE_A_ID, status: "failed", last_error_code: "wallet_provider_duplicate" },
    });
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(new WalletProviderError("wallet_provider_rejected", "boom again"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    const rows = await prisma.walletPass.findMany({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(before.id);
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.last_error_code).toBe("wallet_provider_rejected");
    errSpy.mockRestore();
  });

  it("logs and redirects when the fallback create throws something other than a unique-constraint conflict", async () => {
    // Distinguishes this from the P2002-is-ignored race-recovery path above: any other error out
    // of that same create() call must still surface through the same catch-and-log every other
    // write failure in this function goes through, not be swallowed alongside P2002.
    const provider = stubProvider();
    provider.createPass.mockRejectedValueOnce(new WalletProviderError("wallet_provider_rejected", "boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The create runs inside markFailed's transaction: fail that one call on the transaction's own client.
    const realTransaction = prisma.$transaction.bind(prisma) as unknown as (
      fn: (tx: PrismaClient) => Promise<unknown>,
    ) => Promise<unknown>;
    vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (fn: (tx: PrismaClient) => Promise<unknown>) =>
      realTransaction(async (tx) => {
        vi.spyOn(tx.walletPass, "create").mockRejectedValueOnce(new Error("db down"));
        return fn(tx);
      })) as never);
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "wallet_pass_upsert_failed",
        fields: { eventId: EVENT_ID, attendeeId: ATTENDEE_MODE_A_ID },
      }),
    );
    const saved = await prisma.walletPass.findUnique({ where: { attendee_id: ATTENDEE_MODE_A_ID } });
    expect(saved).toBeNull();
    errSpy.mockRestore();
  });

  it("returns 500 (not the not-found page) when the Mode A ticket lookup fails", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);
    vi.spyOn(prisma.attendee, "findUnique").mockRejectedValueOnce(new Error("db down"));

    const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "ticket_resolution_failed",
        fields: { route: "/t/:token/wallet/:platform", errorKind: "unexpected" },
      }),
    );
    expect(provider.createPass).not.toHaveBeenCalled();
  });

  it("returns 500 (not the not-found page) when the Mode B ticket lookup fails", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);
    vi.spyOn(prisma.event, "findUnique").mockRejectedValueOnce(new Error("db down"));

    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}/wallet/apple`, {
      redirect: "manual",
    });

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "ticket_agency_lookup_failed",
        fields: { route: "/t/:eventSlug/a/:ref/wallet/:platform" },
      }),
    );
    expect(provider.createPass).not.toHaveBeenCalled();
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

  it("real wallet links render on the ticket page, alongside an inert Samsung Wallet badge (no PassCreator API support yet)", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);

    const res = await app.request(`/t/${MODE_A_TOKEN}`);
    const html = await res.text();
    expect(html).toContain(`href="/t/${MODE_A_TOKEN}/wallet/apple"`);
    expect(html).toContain(`href="/t/${MODE_A_TOKEN}/wallet/google"`);
    // Never wrapped in a clickable <a href> - see ticket-page.ts's walletSamsungBadge doc comment.
    expect(html).not.toContain(`href="/t/${MODE_A_TOKEN}/wallet/samsung"`);
    expect(html).toContain("Add to Samsung Wallet");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('title="Unavailable"');
    expect(html).toContain("The Samsung Wallet button is for Samsung Galaxy phones.");
  });

  it("hides the wallet badges on the ticket page when no API key is saved (real provider resolution, not injected)", async () => {
    // makeApp()'s stubProvider injection (options.walletPassProvider) bypasses the real
    // wallet_api_key_enc check entirely - every other test in this file uses it, so this is the
    // only one that exercises walletConfigured's actual DB-driven API-key branch.
    const app = createApp({
      prisma,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
    });
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_api_key_enc: null } });

    const res = await app.request(`/t/${MODE_A_TOKEN}`);
    const html = await res.text();
    expect(html).not.toContain(`href="/t/${MODE_A_TOKEN}/wallet/apple"`);
    expect(html).not.toContain(`href="/t/${MODE_A_TOKEN}/wallet/google"`);
  });

  it("hides the wallet badges on the ticket page when the event has no template configured", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_template_id: null } });

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}`);
      const html = await res.text();
      // .wallet-badge-frame is also a CSS rule name in the unconditional stylesheet - check the
      // actual link markup instead.
      expect(html).not.toContain(`href="/t/${MODE_A_TOKEN}/wallet/apple"`);
      expect(html).not.toContain(`href="/t/${MODE_A_TOKEN}/wallet/google"`);
    } finally {
      await prisma.event.update({
        where: { id: EVENT_ID },
        data: { wallet_template_id: "tmpl-wallet-gala" },
      });
    }
  });

  it("hides both badges and both routes redirect without walletError when wallet_enabled is off", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_enabled: false } });

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}`);
      const html = await res.text();
      expect(html).not.toContain(`href="/t/${MODE_A_TOKEN}/wallet/apple"`);
      expect(html).not.toContain(`href="/t/${MODE_A_TOKEN}/wallet/google"`);

      const appleRes = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
      expect(appleRes.status).toBe(302);
      expect(appleRes.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}`);
      expect(provider.createPass).not.toHaveBeenCalled();
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_enabled: true } });
    }
  });

  it("hides only the Apple badge when wallet_apple_enabled is off", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_apple_enabled: false } });

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}`);
      const html = await res.text();
      expect(html).not.toContain(`href="/t/${MODE_A_TOKEN}/wallet/apple"`);
      expect(html).toContain(`href="/t/${MODE_A_TOKEN}/wallet/google"`);
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_apple_enabled: true } });
    }
  });

  it("hides only the Google badge when wallet_google_enabled is off", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_google_enabled: false } });

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}`);
      const html = await res.text();
      expect(html).toContain(`href="/t/${MODE_A_TOKEN}/wallet/apple"`);
      expect(html).not.toContain(`href="/t/${MODE_A_TOKEN}/wallet/google"`);
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_google_enabled: true } });
    }
  });

  it("redirects without walletError when the requested platform is disabled", async () => {
    const provider = stubProvider();
    const app = makeApp(provider);
    await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_apple_enabled: false } });

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}`);
      expect(provider.createPass).not.toHaveBeenCalled();
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_apple_enabled: true } });
    }
  });

  it("resolves the event's own encrypted API key without a live provider stub", async () => {
    const app = createApp({
      prisma,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
    });
    await prisma.event.update({
      where: { id: EVENT_ID },
      data: { wallet_api_key_enc: "not-valid-ciphertext" },
    });

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/t/${MODE_A_TOKEN}?walletError=1`);
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_api_key_enc: null } });
    }
  });

  it("builds a real PassCreatorClient and creates a pass when no provider is injected", async () => {
    const app = createApp({
      prisma,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
    });
    await prisma.event.update({
      where: { id: EVENT_ID },
      data: { wallet_api_key_enc: encryptToString("real-test-key") },
    });

    let sentUrl: string | URL | null = null;
    let sentAuth: string | undefined;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      sentUrl = url;
      sentAuth = (init?.headers as Record<string, string>).Authorization;
      return new Response(
        JSON.stringify({
          success: true,
          data: { identifier: "real-1", iPhoneUri: "https://pc.test/real/apple", androidUri: "https://pc.test/real/android" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://pc.test/real/apple");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(sentUrl)).toContain("/api/v3/pass");
      expect(sentAuth).toBe("real-test-key");
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { wallet_api_key_enc: null } });
    }
  });

  it("passes the event's saved field mapping through to the real PassCreatorClient", async () => {
    const app = createApp({
      prisma,
      baseUrl: "https://tickets.example.com",
      rateLimitStore: createRateLimitStore(),
      skipCheckinBootValidation: true,
    });
    await prisma.event.update({
      where: { id: EVENT_ID },
      data: {
        wallet_api_key_enc: encryptToString("real-test-key"),
        wallet_field_mapping: { attendeeFullName: "full_name" },
      },
    });

    const sentBodies: Array<{ data: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sentBodies.push(JSON.parse(String(init?.body)) as { data: Record<string, unknown> });
      return new Response(
        JSON.stringify({
          success: true,
          data: { identifier: "real-2", iPhoneUri: "https://pc.test/real2/apple", androidUri: "https://pc.test/real2/android" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const res = await app.request(`/t/${MODE_A_TOKEN}/wallet/apple`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://pc.test/real2/apple");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // wallet_field_mapping's key is the PassCreator field name ("attendeeFullName"), not the
      // Admitto placeholder it maps from ("full_name") - this assertion silently checked the
      // wrong key while it lived inside the mock (any failure there was swallowed into a generic
      // provider-error redirect the outer status/location assertions couldn't tell apart from
      // success), and only surfaced once moved out here.
      expect(sentBodies[0]?.data.attendeeFullName).toBe("Mode A Guest");
    } finally {
      await prisma.event.update({
        where: { id: EVENT_ID },
        data: { wallet_api_key_enc: null, wallet_field_mapping: Prisma.JsonNull },
      });
    }
  });
});
