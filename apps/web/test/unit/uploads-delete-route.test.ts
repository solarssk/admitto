import type { PrismaClient } from "@admitto/db";
import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    canManageInstance: vi.fn(),
    getBrandingTheme: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("../../src/admin/admin-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/admin-helpers.js")>();
  return {
    ...actual,
    assertEventManageAccess: vi.fn(),
  };
});

vi.mock("../../src/admin/branding-upload.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/branding-upload.js")>();
  return {
    ...actual,
    parseUploadsUrl: vi.fn(actual.parseUploadsUrl),
    deleteBrandingUploadByUrl: vi.fn(actual.deleteBrandingUploadByUrl),
  };
});

import { canManageInstance } from "@admitto/auth";
import { assertEventManageAccess } from "../../src/admin/admin-helpers.js";
import {
  BrandingUploadError,
  deleteBrandingUploadByUrl,
  parseUploadsUrl,
} from "../../src/admin/branding-upload.js";
import { handleDeleteUpload } from "../../src/admin/uploads-api-routes.js";

const UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890.png";
const ORG_URL = `/uploads/default/${UUID}`;

function fakeContext(opts: {
  body?: unknown;
  jsonThrows?: boolean;
  userId?: string;
}): Context {
  return {
    req: {
      json: async () => {
        if (opts.jsonThrows) throw new SyntaxError("bad json");
        return opts.body;
      },
    },
    get: (key: string) => (key === "auth" ? { userId: opts.userId ?? "user-1" } : undefined),
    json: (payload: unknown, status?: number) => Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

/** Minimal Prisma stub so persistence guards resolve as "not referenced". */
function emptyDb(): PrismaClient {
  return {
    eventImageAsset: { findFirst: vi.fn().mockResolvedValue(null) },
    event: { findFirst: vi.fn().mockResolvedValue(null) },
    organization: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleDeleteUpload", () => {
  it("returns 400 invalid_json when the body cannot be parsed", async () => {
    const res = await handleDeleteUpload(fakeContext({ jsonThrows: true }), emptyDb());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("returns 400 invalid_body for a non-object body", async () => {
    const res = await handleDeleteUpload(fakeContext({ body: "nope" }), emptyDb());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("returns 400 url_required when url is missing or blank", async () => {
    for (const body of [{}, { url: "" }, { url: "   " }, { url: 1 }]) {
      const res = await handleDeleteUpload(fakeContext({ body }), emptyDb());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "url_required" });
    }
  });

  it("returns 500 when parseUploadsUrl throws an unexpected error", async () => {
    vi.mocked(parseUploadsUrl).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = await handleDeleteUpload(fakeContext({ body: { url: ORG_URL } }), emptyDb());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server error" });
  });

  it("maps BrandingUploadError from deleteBrandingUploadByUrl", async () => {
    vi.mocked(canManageInstance).mockResolvedValueOnce(true);
    vi.mocked(deleteBrandingUploadByUrl).mockRejectedValueOnce(
      new BrandingUploadError("invalid_upload_url", 400),
    );
    const res = await handleDeleteUpload(fakeContext({ body: { url: ORG_URL } }), emptyDb());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_upload_url" });
  });

  it("returns 500 when deleteBrandingUploadByUrl throws a non-validation error", async () => {
    vi.mocked(canManageInstance).mockResolvedValueOnce(true);
    vi.mocked(deleteBrandingUploadByUrl).mockRejectedValueOnce(new Error("EIO"));
    const res = await handleDeleteUpload(fakeContext({ body: { url: ORG_URL } }), emptyDb());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server error" });
  });

  it("delegates event-path auth to assertEventManageAccess", async () => {
    const eventUrl = `/uploads/default/events/evt-1/${UUID}`;
    vi.mocked(assertEventManageAccess).mockResolvedValueOnce(
      Response.json({ error: "forbidden" }, { status: 403 }),
    );
    const res = await handleDeleteUpload(fakeContext({ body: { url: eventUrl } }), emptyDb());
    expect(res.status).toBe(403);
    expect(deleteBrandingUploadByUrl).not.toHaveBeenCalled();
  });

  it("rejects DELETE when the URL is still on Organization branding", async () => {
    vi.mocked(canManageInstance).mockResolvedValueOnce(true);
    const db = {
      eventImageAsset: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: "org-1" }) },
      event: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const res = await handleDeleteUpload(fakeContext({ body: { url: ORG_URL } }), db);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "persisted_branding_url" });
    expect(deleteBrandingUploadByUrl).not.toHaveBeenCalled();
  });

  it("rejects DELETE when the URL is still on Event branding fields", async () => {
    const eventUrl = `/uploads/default/events/evt-1/${UUID}`;
    vi.mocked(assertEventManageAccess).mockResolvedValueOnce(null);
    const db = {
      eventImageAsset: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: vi.fn().mockResolvedValue(null) },
      event: { findFirst: vi.fn().mockResolvedValue({ id: "evt-1" }) },
    } as unknown as PrismaClient;
    const res = await handleDeleteUpload(fakeContext({ body: { url: eventUrl } }), db);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "persisted_branding_url" });
    expect(deleteBrandingUploadByUrl).not.toHaveBeenCalled();
  });

  it("rejects event-path DELETE when the same URL is live on organisation branding", async () => {
    const eventUrl = `/uploads/default/events/evt-1/${UUID}`;
    vi.mocked(assertEventManageAccess).mockResolvedValueOnce(null);
    const db = {
      eventImageAsset: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: "org-1" }) },
      event: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const res = await handleDeleteUpload(fakeContext({ body: { url: eventUrl } }), db);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "persisted_branding_url" });
    expect(deleteBrandingUploadByUrl).not.toHaveBeenCalled();
  });

  it("rejects DELETE when a theme font still references the URL", async () => {
    const themeUrl = `/uploads/default/theme/${UUID.replace(/\.png$/, ".woff2")}`;
    vi.mocked(canManageInstance).mockResolvedValueOnce(true);
    const { getBrandingTheme } = await import("@admitto/auth");
    vi.mocked(getBrandingTheme).mockResolvedValueOnce({
      custom_font_families: [
        {
          name: "Acme",
          variants: [{ weight: 400, style: "normal", url: themeUrl }],
        },
      ],
    });
    const res = await handleDeleteUpload(fakeContext({ body: { url: themeUrl } }), emptyDb());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "persisted_branding_url" });
    expect(deleteBrandingUploadByUrl).not.toHaveBeenCalled();
  });

  it("rejects DELETE of a persisted image asset URL with persisted_image_asset", async () => {
    const eventUrl = `/uploads/default/events/evt-1/${UUID}`;
    vi.mocked(assertEventManageAccess).mockResolvedValueOnce(null);
    const db = {
      eventImageAsset: { findFirst: vi.fn().mockResolvedValue({ id: "asset-1" }) },
      organization: { findFirst: vi.fn().mockResolvedValue(null) },
      event: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const res = await handleDeleteUpload(fakeContext({ body: { url: eventUrl } }), db);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "persisted_image_asset" });
    expect(deleteBrandingUploadByUrl).not.toHaveBeenCalled();
  });
});
