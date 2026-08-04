import type { PrismaClient } from "@admitto/db";
import { getBrandingTheme } from "@admitto/auth";
import { extractUploadKeysFromText, tryParseUploadKey } from "../keys.js";

/** Add a URL to `keys` when it parses as a managed `/uploads/…` key. */
function addUrl(keys: Set<string>, url: string | null | undefined): void {
  if (!url) return;
  const key = tryParseUploadKey(url);
  if (key) keys.add(key);
}

/**
 * Union of storage keys still referenced by branding surfaces and mail templates.
 * Diff this set against `storage.list()` to find orphaned uploads.
 */
export async function collectReferencedUploadKeys(db: PrismaClient): Promise<Set<string>> {
  const keys = new Set<string>();

  const orgs = await db.organization.findMany({
    select: { logo_url: true, logo_original_url: true, header_image_url: true },
  });
  for (const row of orgs) {
    addUrl(keys, row.logo_url);
    addUrl(keys, row.logo_original_url);
    addUrl(keys, row.header_image_url);
  }

  const events = await db.event.findMany({
    select: { logo_url: true, logo_original_url: true, header_image_url: true },
  });
  for (const row of events) {
    addUrl(keys, row.logo_url);
    addUrl(keys, row.logo_original_url);
    addUrl(keys, row.header_image_url);
  }

  const assets = await db.eventImageAsset.findMany({ select: { url: true } });
  for (const row of assets) {
    addUrl(keys, row.url);
  }

  const theme = await getBrandingTheme(db);
  for (const family of theme.custom_font_families ?? []) {
    for (const variant of family.variants) {
      addUrl(keys, variant.url);
    }
  }

  const templates = await db.mailTemplate.findMany({
    select: { subject_template: true, body_template: true },
  });
  for (const row of templates) {
    for (const key of extractUploadKeysFromText(row.subject_template)) {
      keys.add(key);
    }
    for (const key of extractUploadKeysFromText(row.body_template)) {
      keys.add(key);
    }
  }

  return keys;
}
