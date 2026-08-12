import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { backfillAgencyPublicRefs } from "@admitto/db";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import * as tickets from "@admitto/tickets";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";
import * as weatherOrgSettings from "../../src/weather/weather-org-settings.js";

const ORG_ID = "org-pubref";
const EVENT_ID = "evt-pubref";
const EVENT_SLUG = "summer-gala";
const PUBLIC_REF = generateToken();
const MODE_A_TOKEN = generateToken();
const ATTENDEE_ID = "attendee-cuid-legacy-id";
const MODE_A_ATTENDEE_ID = "attendee-mode-a-token";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;

async function seedPublicRefFixture(client: PrismaClient): Promise<void> {
  await client.checkIn.deleteMany({ where: { event_id: EVENT_ID } });
  await client.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await client.roleAssignment.deleteMany({ where: { scope_id: EVENT_ID } });
  await client.event.deleteMany({ where: { id: EVENT_ID } });
  await client.organization.deleteMany({ where: { id: ORG_ID } });

  await client.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "pubref-org" },
  });
  await client.event.create({
    data: {
      id: EVENT_ID,
      title: "Summer Gala",
      slug: EVENT_SLUG,
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
    },
  });
  await client.ticketType.createMany({
    data: [{ event_id: EVENT_ID, key: "vip", label: "VIP Guest", color: "purple" }],
  });
  await client.attendee.create({
    data: {
      id: ATTENDEE_ID,
      event_id: EVENT_ID,
      email: "guest@example.com",
      name: "Agency Guest",
      qr_payload: "AGENCY-QR-PAYLOAD-001",
      public_ref: PUBLIC_REF,
      ticket_type: "vip",
    },
  });
  await client.attendee.create({
    data: {
      id: MODE_A_ATTENDEE_ID,
      event_id: EVENT_ID,
      email: "modea@example.com",
      name: "Mode A Guest",
      token_hash: hashToken(MODE_A_TOKEN),
      token_enc: encryptToString(MODE_A_TOKEN),
      status: "registered",
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seedPublicRefFixture(prisma);

  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
  });
});

beforeEach(() => {
  resetSystemLogBufferForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("Mode B public routes — public_ref", () => {
  it("GET /t/:slug/a/:public_ref returns ticket page", async () => {
    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agency Guest");
    expect(html).toContain("Summer Gala");
  });

  it("renders event-day weather when summarize succeeds", async () => {
    const summarize = vi.fn(async () => ({
      status: "ok" as const,
      temp_c: 18,
      temp_min_c: 12,
      weather_code: 1,
      attribution: "Weather data by MET Norway",
      attribution_url: "https://www.met.no/en",
    }));
    vi.spyOn(weatherOrgSettings, "createWeatherServiceFromDb").mockResolvedValue({
      summarize,
    } as never);

    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Weather on the day");
    expect(html).toContain("12-18°C");
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: "UTC",
      }),
    );
  });

  it("fail-opens the ticket page when weather summarize throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(weatherOrgSettings, "createWeatherServiceFromDb").mockResolvedValue({
      summarize: vi.fn(async () => {
        throw new Error("provider down");
      }),
    } as never);

    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agency Guest");
    expect(html).not.toContain("Weather on the day");
    expect(errSpy).toHaveBeenCalledWith(
      "weather summarize failed for ticket page:",
      expect.any(Error),
    );
  });

  it("renders the catalog label, not the raw key, for ticket_type (Codex review, batch 04 / #351)", async () => {
    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("VIP Guest");
    expect(html).not.toMatch(/>vip</);
  });

  it("GET /q/:slug/a/:public_ref.png returns PNG with short private cache", async () => {
    const res = await app.request(`/q/${EVENT_SLUG}/a/${PUBLIC_REF}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("GET /q/:token.png returns PNG with short private cache (Mode A)", async () => {
    const res = await app.request(`/q/${MODE_A_TOKEN}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("records QR generation failures without copying the ticket token or error text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(tickets, "generateQrPng").mockRejectedValueOnce(
      new Error("attendee@example.com and secret payload must stay out of System logs"),
    );

    const res = await app.request(`/q/${MODE_A_TOKEN}.png`);

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "qr_png_generation_failed",
        fields: { route: "/q/:filename" },
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"qr_png_generation_failed"'),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain(MODE_A_TOKEN);
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee@example.com");
  });

  it("records ticket-page QR failures for an agency route", async () => {
    vi.spyOn(tickets, "generateQrPng").mockRejectedValueOnce(
      new Error("attendee@example.com and agency payload must stay out of System logs"),
    );

    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);

    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain("Something went wrong");
    expect(html).toContain('class="at-public-error__code">500<');
    expect(html).not.toContain("Event ticket");
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "qr_png_generation_failed",
        fields: { route: "/t/:eventSlug/a/:ref" },
      }),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain(PUBLIC_REF);
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee@example.com");
  });

  it("records hosted agency QR generation failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(tickets, "generateQrPng").mockRejectedValueOnce(
      new Error("attendee@example.com and agency payload must stay out of System logs"),
    );

    const res = await app.request(`/q/${EVENT_SLUG}/a/${PUBLIC_REF}.png`);

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "qr_png_generation_failed",
        fields: { route: "/q/:eventSlug/a/:filename" },
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"qr_png_generation_failed"'),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain(PUBLIC_REF);
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee@example.com");
  });

  it("records ticket-resolution failures with a static route label", async () => {
    vi.spyOn(tickets, "resolveTicket").mockRejectedValueOnce(
      new Error("private-token and attendee@example.com must stay out of System logs"),
    );

    const res = await app.request("/t/private-token");

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "ticket_resolution_failed",
        fields: { route: "/t/:token", errorKind: "unexpected" },
      }),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain("private-token");
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee@example.com");
  });

  it("records database ticket-resolution failures with a safe category", async () => {
    vi.spyOn(tickets, "resolveTicket").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("attendee@example.com must stay out of System logs", {
        code: "P2025",
        clientVersion: "test",
      }),
    );

    const res = await app.request("/t/private-token");

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "ticket_resolution_failed",
        fields: { route: "/t/:token", errorKind: "database" },
      }),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain("private-token");
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee@example.com");
  });

  it("records agency ticket lookup failures without the public reference", async () => {
    vi.spyOn(prisma.event, "findUnique").mockRejectedValueOnce(
      new Error("attendee@example.com and public reference must stay out of System logs"),
    );

    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "ticket_agency_lookup_failed",
        fields: { route: "/t/:eventSlug/a/:ref" },
      }),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain(PUBLIC_REF);
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee@example.com");
  });

  it("records hosted agency QR lookup failures without the public reference", async () => {
    vi.spyOn(prisma.event, "findUnique").mockRejectedValueOnce(
      new Error("attendee@example.com and public reference must stay out of System logs"),
    );

    const res = await app.request(`/q/${EVENT_SLUG}/a/${PUBLIC_REF}.png`);

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "ticket_agency_lookup_failed",
        fields: { route: "/q/:eventSlug/a/:filename" },
      }),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain(PUBLIC_REF);
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee@example.com");
  });

  it("records internal QR attendee lookup failures without the ticket token", async () => {
    vi.spyOn(prisma.attendee, "findUnique").mockRejectedValueOnce(
      new Error("attendee@example.com and ticket token must stay out of System logs"),
    );

    const res = await app.request(`/q/${MODE_A_TOKEN}.png`);

    expect(res.status).toBe(500);
    expect(querySystemLogs({ source: "api" })).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "ticket_qr_attendee_lookup_failed",
        fields: { route: "/q/:filename" },
      }),
    );
    expect(JSON.stringify(querySystemLogs())).not.toContain(MODE_A_TOKEN);
    expect(JSON.stringify(querySystemLogs())).not.toContain("attendee@example.com");
  });

  it("legacy Attendee.id in URL returns 404", async () => {
    const res = await app.request(`/t/${EVENT_SLUG}/a/${ATTENDEE_ID}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Not found");
    expect(html).toContain('class="at-public-error__code">404<');
    expect(html).toContain("This link is invalid or the page no longer exists.");
    expect(html).not.toContain("Event ticket");
    expect(html).not.toContain("Ticket not found");
  });

  it("unknown public_ref returns 404", async () => {
    const res = await app.request(`/t/${EVENT_SLUG}/a/${generateToken()}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Not found");
    expect(html).toContain('class="at-public-error__code">404<');
  });

  it("does not serve an internal attendee through Mode B ticket or QR routes", async () => {
    const publicRef = generateToken();
    const attendee = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "internal-public-ref@example.com",
        name: "Internal public ref",
        public_ref: publicRef,
      },
    });

    try {
      expect((await app.request(`/t/${EVENT_SLUG}/a/${publicRef}`)).status).toBe(404);
      expect((await app.request(`/q/${EVENT_SLUG}/a/${publicRef}.png`)).status).toBe(404);
    } finally {
      await prisma.attendee.delete({ where: { id: attendee.id } });
    }
  });

  it("renders the event's configured logo and widens the CSP img-src to match (#419)", async () => {
    const logoUrl = "https://cdn.example.com/summer-gala-logo.png";
    await prisma.event.update({ where: { id: EVENT_ID }, data: { logo_url: logoUrl } });
    try {
      const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<img class="ticket__brand-logo" src="${logoUrl}"`);
      expect(res.headers.get("Content-Security-Policy")).toContain(`img-src 'self' data: https://cdn.example.com`);
    } finally {
      await prisma.event.update({ where: { id: EVENT_ID }, data: { logo_url: null } });
    }
  });

  it("agency row without public_ref returns 404 after lookup switch", async () => {
    const noRef = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "norefb@example.com",
        name: "No Ref",
        external_uuid: "agency-uuid-noref",
      },
    });
    expect(noRef.public_ref).toBeNull();
    const res = await app.request(`/t/${EVENT_SLUG}/a/${noRef.id}`);
    expect(res.status).toBe(404);
  });
});

describe("revoked and cancelled public ticket pages", () => {
  afterEach(async () => {
    await prisma.attendee.update({
      where: { id: MODE_A_ATTENDEE_ID },
      data: { status: "registered" },
    });
    await prisma.attendee.update({
      where: { id: ATTENDEE_ID },
      data: { status: "registered" },
    });
  });

  it("GET /t/:token returns 410 branded revoked card for a revoked Mode A pass", async () => {
    await prisma.attendee.update({
      where: { id: MODE_A_ATTENDEE_ID },
      data: { status: "revoked" },
    });

    const res = await app.request(`/t/${MODE_A_TOKEN}`);
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain("ticket-page");
    expect(html).toContain("Ticket revoked");
    expect(html).toContain("ticket__status-notice");
    expect(html).toContain("Mode A Guest");
    expect(html).toContain("Summer Gala");
    expect(html).not.toContain('class="ticket__qr"');
    expect(html).not.toContain("Present this QR code");
  });

  it("GET /t/:slug/a/:ref returns 410 cancelled card when the agency pass is cancelled", async () => {
    await prisma.attendee.update({
      where: { id: ATTENDEE_ID },
      data: { status: "cancelled" },
    });

    const res = await app.request(`/t/${EVENT_SLUG}/a/${PUBLIC_REF}`);
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain("Ticket cancelled");
    expect(html).toContain("Agency Guest");
    expect(html).toContain("no longer valid for entry");
    expect(html).not.toContain("apple-wallet-badge.svg");
  });

  it("still renders the revoked card when branding theme lookup fails", async () => {
    const auth = await import("@admitto/auth");
    vi.spyOn(auth, "getBrandingTheme").mockRejectedValueOnce(new Error("theme unavailable"));

    await prisma.attendee.update({
      where: { id: MODE_A_ATTENDEE_ID },
      data: { status: "revoked" },
    });

    const res = await app.request(`/t/${MODE_A_TOKEN}`);
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain("Ticket revoked");
    expect(html).toContain("ticket__status-notice");
  });
});

describe("global public HTML 404", () => {
  it("serves the branded Admitto card for an unknown browser path", async () => {
    const res = await app.request("/this-path-does-not-exist");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("ticket-page");
    expect(html).toContain('class="at-public-error__code">404<');
    expect(html).toContain("Not found");
    expect(html).toContain("This link is invalid or the page no longer exists.");
    expect(html).not.toContain("Event ticket");
  });

  it("does not query branding theme for global HTML 404", async () => {
    const auth = await import("@admitto/auth");
    const spy = vi.spyOn(auth, "getBrandingTheme");

    const res = await app.request("/another-missing-path");
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    const html = await res.text();
    expect(html).toContain("Not found");
    expect(html).toContain('class="at-public-error__code">404<');
  });

  it("still renders a ticket-route 404 when branding theme lookup fails", async () => {
    const auth = await import("@admitto/auth");
    vi.spyOn(auth, "getBrandingTheme").mockRejectedValueOnce(new Error("theme unavailable"));

    const res = await app.request(`/t/${generateToken()}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Not found");
    expect(html).toContain('class="at-public-error__code">404<');
  });

  it("keeps API misses as JSON", async () => {
    const exact = await app.request("/api");
    expect(exact.status).toBe(404);
    expect(await exact.json()).toEqual({ error: "not_found" });

    const nested = await app.request("/api/no-such-endpoint");
    expect(nested.status).toBe(404);
    expect(await nested.json()).toEqual({ error: "not_found" });
  });

  it("keeps static map and QR misses as empty bodies", async () => {
    const mapRes = await app.request("/m/no-such-event.png");
    expect(mapRes.status).toBe(404);
    expect(await mapRes.text()).toBe("");

    const qrRes = await app.request(`/q/${generateToken()}.png`);
    expect(qrRes.status).toBe(404);
    expect(await qrRes.text()).toBe("");
  });

  it("keeps bare resource namespace paths as empty bodies", async () => {
    for (const path of ["/m", "/q", "/uploads", "/assets", "/vendor"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe("");
    }
  });

  it("keeps upload and vendor asset misses as empty bodies", async () => {
    const uploadRes = await app.request("/uploads/org-missing/logo.png");
    expect(uploadRes.status).toBe(404);
    expect(await uploadRes.text()).toBe("");

    const vendorRes = await app.request("/vendor/tabler-icons/no-such-icon.svg");
    expect(vendorRes.status).toBe(404);
    expect(await vendorRes.text()).toBe("");

    const assetRes = await app.request("/assets/no-such-bundle.js");
    expect(assetRes.status).toBe(404);
    expect(await assetRes.text()).toBe("");
  });
});

describe("backfill before deploy", () => {
  it("backfill assigns ref so routes work", async () => {
    const row = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "backfill@example.com",
        name: "Backfill Guest",
        qr_payload: "AGENCY-BACKFILL",
      },
    });
    const before = await app.request(`/t/${EVENT_SLUG}/a/${generateToken()}`);
    expect(before.status).toBe(404);

    await backfillAgencyPublicRefs(prisma);
    const updated = await prisma.attendee.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.public_ref).toBeTruthy();

    const after = await app.request(`/t/${EVENT_SLUG}/a/${updated.public_ref}`);
    expect(after.status).toBe(200);
  });
});
