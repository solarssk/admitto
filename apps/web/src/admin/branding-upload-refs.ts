import type { PrismaClient } from "@admitto/db";
import { getBrandingTheme } from "@admitto/auth";

/**
 * Whether a managed `/uploads/…` URL is still referenced by any persisted branding surface
 * (organisation, any event, image-asset library, or theme fonts).
 * Used by DELETE /uploads guards and post-save replacement GC so one scope cannot unlink a
 * file still live in another (validateBrandingUrl allows cross-scope URL reuse).
 */
export async function findManagedUploadReference(
  db: PrismaClient,
  url: string,
): Promise<"image_asset" | "branding" | null> {
  const asset = await db.eventImageAsset.findFirst({
    where: { url },
    select: { id: true },
  });
  if (asset) return "image_asset";

  const orgHit = await db.organization.findFirst({
    where: {
      OR: [{ logo_url: url }, { logo_original_url: url }, { header_image_url: url }],
    },
    select: { id: true },
  });
  if (orgHit) return "branding";

  const eventHit = await db.event.findFirst({
    where: {
      OR: [{ logo_url: url }, { logo_original_url: url }, { header_image_url: url }],
    },
    select: { id: true },
  });
  if (eventHit) return "branding";

  const theme = await getBrandingTheme(db);
  for (const family of theme.custom_font_families ?? []) {
    for (const variant of family.variants ?? []) {
      if (variant.url === url) return "branding";
    }
  }
  return null;
}

/** True when any branding surface still points at `url`. */
export async function isManagedUploadUrlReferenced(db: PrismaClient, url: string): Promise<boolean> {
  return (await findManagedUploadReference(db, url)) !== null;
}
