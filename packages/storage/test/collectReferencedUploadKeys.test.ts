import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";

vi.mock("@admitto/auth", () => ({
  getBrandingTheme: vi.fn(),
}));

import { getBrandingTheme } from "@admitto/auth";
import { collectReferencedUploadKeys } from "../src/index.js";

const mockGetBrandingTheme = vi.mocked(getBrandingTheme);

const ORG_KEY = "default/11111111-1111-1111-1111-111111111111.png";
const ORG_ORIGINAL = "default/22222222-2222-2222-2222-222222222222.png";
const ORG_HEADER = "default/33333333-3333-3333-3333-333333333333.png";
const EVENT_KEY = "default/events/evt-1/44444444-4444-4444-4444-444444444444.png";
const ASSET_KEY = "default/events/evt-1/55555555-5555-5555-5555-555555555555.webp";
const FONT_KEY = "default/theme/66666666-6666-6666-6666-666666666666.woff2";
const MAIL_KEY = "default/77777777-7777-7777-7777-777777777777.jpg";

function url(key: string): string {
  return `/uploads/${key}`;
}

describe("collectReferencedUploadKeys", () => {
  beforeEach(() => {
    mockGetBrandingTheme.mockReset();
    mockGetBrandingTheme.mockResolvedValue({});
  });

  it("collects organisation branding URLs", async () => {
    const db = {
      organization: {
        findMany: vi.fn().mockResolvedValue([
          {
            logo_url: url(ORG_KEY),
            logo_original_url: url(ORG_ORIGINAL),
            header_image_url: url(ORG_HEADER),
          },
        ]),
      },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      eventImageAsset: { findMany: vi.fn().mockResolvedValue([]) },
      mailTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const keys = await collectReferencedUploadKeys(db);
    expect(keys).toEqual(new Set([ORG_KEY, ORG_ORIGINAL, ORG_HEADER]));
  });

  it("collects event branding URLs", async () => {
    const db = {
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      event: {
        findMany: vi.fn().mockResolvedValue([
          {
            logo_url: url(EVENT_KEY),
            logo_original_url: null,
            header_image_url: null,
          },
        ]),
      },
      eventImageAsset: { findMany: vi.fn().mockResolvedValue([]) },
      mailTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const keys = await collectReferencedUploadKeys(db);
    expect(keys).toEqual(new Set([EVENT_KEY]));
  });

  it("collects event image asset URLs", async () => {
    const db = {
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      eventImageAsset: { findMany: vi.fn().mockResolvedValue([{ url: url(ASSET_KEY) }]) },
      mailTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const keys = await collectReferencedUploadKeys(db);
    expect(keys).toEqual(new Set([ASSET_KEY]));
  });

  it("collects theme font variant URLs via getBrandingTheme", async () => {
    mockGetBrandingTheme.mockResolvedValue({
      custom_font_families: [
        {
          name: "Custom",
          variants: [{ weight: 400, style: "normal", url: url(FONT_KEY) }],
        },
      ],
    });
    const db = {
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      eventImageAsset: { findMany: vi.fn().mockResolvedValue([]) },
      mailTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const keys = await collectReferencedUploadKeys(db);
    expect(keys).toEqual(new Set([FONT_KEY]));
    expect(mockGetBrandingTheme).toHaveBeenCalledWith(db);
  });

  it("collects keys pasted into mail template subject/body", async () => {
    const db = {
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      eventImageAsset: { findMany: vi.fn().mockResolvedValue([]) },
      mailTemplate: {
        findMany: vi.fn().mockResolvedValue([
          {
            subject_template: "Hello",
            body_template: `<img src="${url(MAIL_KEY)}">`,
          },
        ]),
      },
    } as unknown as PrismaClient;

    const keys = await collectReferencedUploadKeys(db);
    expect(keys).toEqual(new Set([MAIL_KEY]));
  });
});
