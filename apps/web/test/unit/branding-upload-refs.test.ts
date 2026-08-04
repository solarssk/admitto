import type { PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    getBrandingTheme: vi.fn(),
  };
});

import { getBrandingTheme } from "@admitto/auth";
import {
  findManagedUploadReference,
  isManagedUploadUrlReferenced,
} from "../../src/admin/branding-upload-refs.js";

const URL = "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png";
const THEME_URL = "/uploads/default/theme/a1b2c3d4-e5f6-7890-abcd-ef1234567890.woff2";

function dbStub(overrides: {
  asset?: { id: string } | null;
  org?: { id: string } | null;
  event?: { id: string } | null;
}): PrismaClient {
  return {
    eventImageAsset: { findFirst: vi.fn().mockResolvedValue(overrides.asset ?? null) },
    organization: { findFirst: vi.fn().mockResolvedValue(overrides.org ?? null) },
    event: { findFirst: vi.fn().mockResolvedValue(overrides.event ?? null) },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  vi.mocked(getBrandingTheme).mockResolvedValue({});
});

describe("findManagedUploadReference", () => {
  it("returns image_asset when any eventImageAsset row holds the URL", async () => {
    const db = dbStub({ asset: { id: "a1" } });
    expect(await findManagedUploadReference(db, URL)).toBe("image_asset");
  });

  it("returns branding when an organization field holds the URL", async () => {
    const db = dbStub({ org: { id: "org-1" } });
    expect(await findManagedUploadReference(db, URL)).toBe("branding");
  });

  it("returns branding when any event field holds the URL", async () => {
    const db = dbStub({ event: { id: "evt-other" } });
    expect(await findManagedUploadReference(db, URL)).toBe("branding");
  });

  it("returns branding when a theme font variant holds the URL", async () => {
    vi.mocked(getBrandingTheme).mockResolvedValueOnce({
      custom_font_families: [
        { name: "Acme", variants: [{ weight: 400, style: "normal", url: THEME_URL }] },
      ],
    });
    const db = dbStub({});
    expect(await findManagedUploadReference(db, THEME_URL)).toBe("branding");
  });

  it("ignores empty variant lists and non-matching theme font URLs", async () => {
    vi.mocked(getBrandingTheme).mockResolvedValueOnce({
      custom_font_families: [
        { name: "Empty", variants: [] },
        {
          name: "Other",
          variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/other.woff2" }],
        },
      ],
    });
    const db = dbStub({});
    expect(await findManagedUploadReference(db, THEME_URL)).toBeNull();
  });

  it("treats a family with undefined variants as empty via nullish coalesce", async () => {
    vi.mocked(getBrandingTheme).mockResolvedValueOnce({
      custom_font_families: [
        { name: "Broken", variants: undefined as unknown as [] },
      ],
    });
    const db = dbStub({});
    expect(await findManagedUploadReference(db, THEME_URL)).toBeNull();
  });

  it("returns null when nothing references the URL", async () => {
    const db = dbStub({});
    expect(await findManagedUploadReference(db, URL)).toBeNull();
    expect(await isManagedUploadUrlReferenced(db, URL)).toBe(false);
  });
});
